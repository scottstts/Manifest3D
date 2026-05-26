export type JsonPatchOperation =
  | {
      op: 'add' | 'replace'
      path: string
      value: unknown
    }
  | {
      op: 'remove'
      path: string
    }

export type JsonPatchEnvelope = {
  patch: JsonPatchOperation[]
}

export type ApplyJsonPatchResult =
  | {
      status: 'ok'
      value: unknown
    }
  | {
      message: string
      status: 'error'
    }

export type ApplyJsonPatchOptions = {
  validateResult?: (value: unknown) => string | null
}

export function applyJsonPatch(
  document: unknown,
  patchCandidate: unknown,
  options: ApplyJsonPatchOptions = {},
): ApplyJsonPatchResult {
  if (!isPatchEnvelope(patchCandidate)) {
    return {
      message: 'Repair response must be an object with a patch array.',
      status: 'error',
    }
  }

  let current = cloneJson(document)

  for (const [index, operation] of patchCandidate.patch.entries()) {
    const result = applyOperation(current, operation)

    if (result.status === 'error') {
      return {
        message: `Patch operation ${index + 1} failed: ${result.message}`,
        status: 'error',
      }
    }

    current = result.value
  }

  const validationMessage = options.validateResult?.(current)

  if (validationMessage) {
    return {
      message: validationMessage,
      status: 'error',
    }
  }

  return {
    status: 'ok',
    value: current,
  }
}

function isPatchEnvelope(value: unknown): value is JsonPatchEnvelope {
  if (!isRecord(value) || !Array.isArray(value.patch)) {
    return false
  }

  return value.patch.every(isPatchOperation)
}

function isPatchOperation(value: unknown): value is JsonPatchOperation {
  if (!isRecord(value) || typeof value.op !== 'string' || typeof value.path !== 'string') {
    return false
  }

  if (value.op === 'remove') {
    return true
  }

  return (value.op === 'add' || value.op === 'replace') && 'value' in value
}

function applyOperation(
  document: unknown,
  operation: JsonPatchOperation,
): ApplyJsonPatchResult {
  if (operation.path === '') {
    if (operation.op === 'remove') {
      return {
        message: 'Cannot remove the whole asset document.',
        status: 'error',
      }
    }

    return {
      status: 'ok',
      value: cloneJson(operation.value),
    }
  }

  const tokens = parseJsonPointer(operation.path)

  if (!tokens) {
    return {
      message: `Invalid JSON Pointer path "${operation.path}".`,
      status: 'error',
    }
  }

  const target = resolveParent(document, tokens)

  if (target.status === 'error') {
    return target
  }

  return mutateParent(target.parent, target.key, operation)
    ? {
        status: 'ok',
        value: document,
      }
    : {
        message: `Path "${operation.path}" does not exist.`,
        status: 'error',
      }
}

function mutateParent(
  parent: unknown,
  key: string,
  operation: JsonPatchOperation,
) {
  if (Array.isArray(parent)) {
    return mutateArray(parent, key, operation)
  }

  if (!isRecord(parent) || isUnsafeObjectKey(key)) {
    return false
  }

  if (operation.op !== 'add' && !(key in parent)) {
    return false
  }

  if (operation.op === 'remove') {
    delete parent[key]
  } else {
    parent[key] = cloneJson(operation.value)
  }

  return true
}

function mutateArray(
  parent: unknown[],
  key: string,
  operation: JsonPatchOperation,
) {
  if (key === '-') {
    if (operation.op === 'add') {
      parent.push(cloneJson(operation.value))
      return true
    }

    return false
  }

  const index = Number(key)

  if (!Number.isInteger(index) || index < 0 || index > parent.length) {
    return false
  }

  if (operation.op === 'add') {
    parent.splice(index, 0, cloneJson(operation.value))
    return true
  }

  if (index >= parent.length) {
    return false
  }

  if (operation.op === 'remove') {
    parent.splice(index, 1)
  } else {
    parent[index] = cloneJson(operation.value)
  }

  return true
}

function resolveParent(document: unknown, tokens: readonly string[]) {
  let current = document

  for (const token of tokens.slice(0, -1)) {
    if (Array.isArray(current)) {
      const index = Number(token)

      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return {
          message: `Array index "${token}" is out of range.`,
          status: 'error' as const,
        }
      }

      current = current[index]
      continue
    }

    if (!isRecord(current) || isUnsafeObjectKey(token) || !(token in current)) {
      return {
        message: `Path segment "${token}" does not exist.`,
        status: 'error' as const,
      }
    }

    current = current[token]
  }

  return {
    key: tokens[tokens.length - 1],
    parent: current,
    status: 'ok' as const,
  }
}

function parseJsonPointer(path: string) {
  if (!path.startsWith('/')) {
    return null
  }

  return path
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function isUnsafeObjectKey(key: string) {
  return key === '__proto__' || key === 'prototype' || key === 'constructor'
}

function cloneJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
