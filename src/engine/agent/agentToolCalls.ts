export type ManifestAgentToolName =
  | 'apply_manifest_patch'
  | 'submit_manifest_asset'

export type ManifestAgentToolEnvelope = {
  argumentsJson: string
  tool: ManifestAgentToolName
}

export type ParsedManifestAgentToolCall =
  | {
      candidate: unknown
      kind: 'asset'
      status: 'ok'
      tool: 'submit_manifest_asset'
    }
  | {
      candidate: {
        patch: unknown[]
      }
      kind: 'patch'
      status: 'ok'
      tool: 'apply_manifest_patch'
    }
  | {
      message: string
      rejectedToolSummary: string
      status: 'error'
    }

export function parseManifestAgentToolCall(
  candidate: unknown,
  expectedTool: ManifestAgentToolName,
): ParsedManifestAgentToolCall {
  const legacyCandidate = parseLegacyCandidate(candidate, expectedTool)

  if (legacyCandidate) {
    return legacyCandidate
  }

  if (!isRecord(candidate)) {
    return createToolParseError(
      'The model response was not a tool-call object.',
      candidate,
    )
  }

  const tool = candidate.tool
  const argumentsJson = candidate.argumentsJson

  if (tool !== 'submit_manifest_asset' && tool !== 'apply_manifest_patch') {
    return createToolParseError(
      'The model response did not name a supported Manifest3D tool.',
      candidate,
    )
  }

  if (tool !== expectedTool) {
    return createToolParseError(
      `The model called "${tool}" but this turn requires "${expectedTool}".`,
      candidate,
    )
  }

  if (typeof argumentsJson !== 'string' || argumentsJson.trim().length === 0) {
    return createToolParseError(
      'The model tool call did not include non-empty argumentsJson.',
      candidate,
    )
  }

  const parsedArguments = parseJson(argumentsJson)

  if (parsedArguments.status === 'error') {
    return {
      message: `Tool argumentsJson is not valid JSON: ${parsedArguments.message}`,
      rejectedToolSummary: summarizeToolCandidate(candidate),
      status: 'error',
    }
  }

  if (tool === 'submit_manifest_asset') {
    if (!isRecord(parsedArguments.value) || !('asset' in parsedArguments.value)) {
      return {
        message:
          'submit_manifest_asset argumentsJson must be a JSON object with an asset field.',
        rejectedToolSummary: summarizeToolCandidate(candidate),
        status: 'error',
      }
    }

    return {
      candidate: parsedArguments.value.asset,
      kind: 'asset',
      status: 'ok',
      tool,
    }
  }

  if (!isRecord(parsedArguments.value) || !Array.isArray(parsedArguments.value.operations)) {
    return {
      message:
        'apply_manifest_patch argumentsJson must be a JSON object with an operations array.',
      rejectedToolSummary: summarizeToolCandidate(candidate),
      status: 'error',
    }
  }

  const normalizedOperations: unknown[] = []

  for (let index = 0; index < parsedArguments.value.operations.length; index += 1) {
    const operation = normalizePatchToolOperation(
      parsedArguments.value.operations[index],
      index,
    )

    if (operation.status === 'error') {
      return {
        message: operation.message,
        rejectedToolSummary: summarizeToolCandidate(candidate),
        status: 'error',
      }
    }

    normalizedOperations.push(operation.value)
  }

  return {
    candidate: {
      patch: normalizedOperations,
    },
    kind: 'patch',
    status: 'ok',
    tool,
  }
}

function parseLegacyCandidate(
  candidate: unknown,
  expectedTool: ManifestAgentToolName,
): ParsedManifestAgentToolCall | null {
  if (!isRecord(candidate)) {
    return null
  }

  if (expectedTool === 'submit_manifest_asset' && candidate.schemaVersion === 2) {
    return {
      candidate,
      kind: 'asset',
      status: 'ok',
      tool: 'submit_manifest_asset',
    }
  }

  if (expectedTool === 'apply_manifest_patch' && Array.isArray(candidate.patch)) {
    return {
      candidate: {
        patch: candidate.patch,
      },
      kind: 'patch',
      status: 'ok',
      tool: 'apply_manifest_patch',
    }
  }

  return null
}

function normalizePatchToolOperation(operation: unknown, index: number) {
  if (!isRecord(operation)) {
    return {
      message: `Patch operation ${index + 1} is not an object.`,
      status: 'error' as const,
    }
  }

  const op = operation.op
  const path = operation.path

  if (op !== 'add' && op !== 'replace' && op !== 'remove') {
    return {
      message: `Patch operation ${index + 1} has unsupported op "${String(op)}".`,
      status: 'error' as const,
    }
  }

  if (path === '') {
    return {
      message: `Patch operation ${index + 1} targets the root path ""; repair and edit patches must use focused nested paths such as /parts/byId/<partId>/visuals/byId/<visualId>/transform/position. Do not replace the whole asset.`,
      status: 'error' as const,
    }
  }

  if (typeof path !== 'string' || !path.startsWith('/')) {
    return {
      message: `Patch operation ${index + 1} must include a nested RFC 6901 path starting with "/".`,
      status: 'error' as const,
    }
  }

  if (op === 'remove') {
    return {
      status: 'ok' as const,
      value: {
        op,
        path,
      },
    }
  }

  if (typeof operation.valueJson !== 'string') {
    return {
      message: `Patch operation ${index + 1} must include valueJson for ${op}.`,
      status: 'error' as const,
    }
  }

  const parsedValue = parseJson(operation.valueJson)

  if (parsedValue.status === 'error') {
    return {
      message: `Patch operation ${index + 1} valueJson is not valid JSON: ${parsedValue.message}`,
      status: 'error' as const,
    }
  }

  return {
    status: 'ok' as const,
    value: {
      op,
      path,
      value: parsedValue.value,
    },
  }
}

function parseJson(value: string) {
  try {
    return {
      status: 'ok' as const,
      value: JSON.parse(value) as unknown,
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : 'Unknown JSON parse error.',
      status: 'error' as const,
    }
  }
}

function createToolParseError(
  message: string,
  candidate: unknown,
): ParsedManifestAgentToolCall {
  return {
    message,
    rejectedToolSummary: summarizeToolCandidate(candidate),
    status: 'error',
  }
}

export function summarizeToolCandidate(candidate: unknown) {
  if (!isRecord(candidate)) {
    return `response=${summarizeValue(candidate)}`
  }

  const tool = typeof candidate.tool === 'string' ? candidate.tool : '<missing>'
  const argumentsJson =
    typeof candidate.argumentsJson === 'string'
      ? candidate.argumentsJson
      : '<missing>'

  return [
    `tool=${tool}`,
    `argumentsJson=${summarizeText(argumentsJson, 1_200)}`,
  ].join('\n')
}

function summarizeValue(value: unknown) {
  try {
    return summarizeText(JSON.stringify(value), 1_200)
  } catch {
    return String(value)
  }
}

function summarizeText(value: string, maxLength: number) {
  return value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 3))}...`
    : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
