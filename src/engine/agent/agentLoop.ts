import type { ManifestAsset, ManifestScene } from '../schema/manifestTypes'
import type { ValidationReport } from '../schema/validationTypes'
import { manifestAssetSchema } from '../schema/manifestSchema'
import type { SceneStore } from '../scene/sceneStore'
import { withCommitStep } from '../validation/reportBuilder'
import {
  validateManifestAssetCandidate,
  type ManifestValidationResult,
} from '../validation/validateManifest'
import {
  createCandidateHistory,
  type CandidateAttempt,
  type CandidateHistory,
  type CandidateHistorySnapshot,
} from './candidateHistory'
import {
  compileManifestPrompt,
  type PromptCompilerMode,
  type PromptImageAttachment,
  type PromptUserInputHistoryEntry,
} from './promptCompiler'
import type {
  AgentImageAttachment,
  AgentRequest,
  ManifestProviderClient,
} from './providerClient'
import { renderValidationSignals } from './repairFeedback'
import { applyJsonPatch } from './jsonPatch'

export type AgentLoopState =
  | 'idle'
  | 'compiling_prompt'
  | 'requesting_model'
  | 'parsing_candidate'
  | 'validating_candidate'
  | 'repairing'
  | 'committing'
  | 'ready'
  | 'failed'
  | 'cancelled'

export type AgentLoopStatus = 'running' | 'passed' | 'failed' | 'skipped'

export type AgentLoopEvent = {
  detail: string | null
  id: string
  label: string
  state: AgentLoopState
  status: AgentLoopStatus
}

export type AgentLoopRunMode = 'create' | 'edit'

export type AgentUserInputHistoryEntry = {
  imageAttachments?: readonly AgentImageAttachment[]
  text: string
  turn: number
}

export type RunManifestAgentLoopInput = {
  imageAttachments?: readonly AgentImageAttachment[]
  maxRepairTurns?: number
  mode: AgentLoopRunMode
  runId?: string
  scene: ManifestScene
  selectedAsset?: ManifestAsset | null
  selectedAssetAttemptContext?: string | null
  signal?: AbortSignal
  userInputHistory?: readonly AgentUserInputHistoryEntry[]
  userPrompt: string
}

export type RunManifestAgentLoopDependencies = {
  client: ManifestProviderClient
  history?: CandidateHistory
  now?: () => string
  onEvent?: (event: AgentLoopEvent) => void
  sceneStore: SceneStore
  validateCandidate?: (candidate: unknown) => ManifestValidationResult
}

export type AgentLoopResult =
  | {
      asset: ManifestAsset
      history: CandidateHistorySnapshot
      report: ValidationReport
      status: 'ready'
    }
  | {
      history: CandidateHistorySnapshot
      message: string
      status: 'failed' | 'cancelled' | 'unavailable'
    }

export const defaultRepairTurnCap = 10

export async function runManifestAgentLoop(
  input: RunManifestAgentLoopInput,
  dependencies: RunManifestAgentLoopDependencies,
): Promise<AgentLoopResult> {
  const history = dependencies.history ?? createCandidateHistory()
  const validateCandidate =
    dependencies.validateCandidate ?? validateManifestAssetCandidate
  const runId = input.runId ?? createRunId(dependencies.now)
  const maxRepairTurns = input.maxRepairTurns ?? defaultRepairTurnCap
  let scene = input.scene
  let mode: PromptCompilerMode = input.mode
  let candidateJson: unknown
  let validationFeedback: string | null = null
  let eventIndex = 0
  let repairTurns = 0
  let patchApplicationErrorSignature: string | null = null
  let patchApplicationErrorStreak = 0
  const userInputHistory = input.userInputHistory ?? []
  const requestImageAttachments = collectRequestImageAttachments(
    userInputHistory,
    input.imageAttachments ?? [],
  )

  history.beginRun(runId)
  emit(
    dependencies.onEvent,
    runId,
    nextEventIndex,
    'idle',
    'Agent run started',
    null,
    'passed',
  )

  while (true) {
    if (input.signal?.aborted) {
      emit(
        dependencies.onEvent,
        runId,
        nextEventIndex,
        'cancelled',
        'Agent run cancelled',
        null,
        'skipped',
      )

      return {
        history: history.getSnapshot(),
        message: 'The agent run was cancelled.',
        status: 'cancelled',
      }
    }

    const finishCompilePrompt = beginStep(
      'compiling_prompt',
      'Compile prompt',
      mode === 'repair' ? `repairTurn=${repairTurns}` : `mode=${mode}`,
    )

    const prompt = compileManifestPrompt({
      candidateJson,
      imageAttachments: imageAttachmentMetadata(input.imageAttachments ?? []),
      mode,
      scene,
      selectedAsset: input.selectedAsset ?? null,
      selectedAssetAttemptContext: input.selectedAssetAttemptContext ?? null,
      userInputHistory: userInputHistoryMetadata(userInputHistory),
      userPrompt: input.userPrompt,
      validationFeedback,
    })
    const agentRequest: AgentRequest = {
      imageAttachments: requestImageAttachments,
      prompt,
      signal: input.signal,
    }
    finishCompilePrompt('passed')

    const finishModelRequest = beginStep(
      'requesting_model',
      'Request candidate',
      `modelPromptMode=${prompt.metadata.mode}`,
    )

    const agentResponse = await dependencies.client.generateAsset(agentRequest)

    if (input.signal?.aborted) {
      finishModelRequest('skipped')
      emit(
        dependencies.onEvent,
        runId,
        nextEventIndex,
        'cancelled',
        'Agent run cancelled',
        null,
        'skipped',
      )

      return {
        history: history.getSnapshot(),
        message: 'The agent run was cancelled.',
        status: 'cancelled',
      }
    }

    if (agentResponse.status === 'unavailable') {
      finishModelRequest('failed')
      emit(
        dependencies.onEvent,
        runId,
        nextEventIndex,
        'failed',
        'Generation unavailable',
        agentResponse.message,
        'failed',
      )

      return {
        history: history.getSnapshot(),
        message: agentResponse.message,
        status: 'unavailable',
      }
    }

    if (agentResponse.status === 'refused' || agentResponse.status === 'error') {
      finishModelRequest('failed')
      emit(
        dependencies.onEvent,
        runId,
        nextEventIndex,
        'failed',
        'Model request failed',
        agentResponse.message,
        'failed',
      )

      return {
        history: history.getSnapshot(),
        message: agentResponse.message,
        status: 'failed',
      }
    }

    finishModelRequest('passed')

    const finishParseCandidate = beginStep(
      'parsing_candidate',
      'Parse candidate JSON',
      agentResponse.responseId
        ? `responseId=${agentResponse.responseId}`
        : null,
    )

    const candidate =
      mode === 'repair'
        ? applyRepairPatch(candidateJson, agentResponse.candidate)
        : { status: 'ok' as const, value: agentResponse.candidate }

    if (candidate.status === 'error') {
      finishParseCandidate('failed', candidate.message)

      if (repairTurns >= maxRepairTurns) {
        emit(
          dependencies.onEvent,
          runId,
          nextEventIndex,
          'failed',
          'Repair turn cap reached',
          `attempts=${history.getSnapshot().attempts.length}`,
          'failed',
        )

        return {
          history: history.getSnapshot(),
          message:
            'The agent could not produce a valid repair patch before the repair turn cap.',
          status: 'failed',
        }
      }

      const patchErrorSignature = createPatchApplicationErrorSignature(
        candidate.message,
        candidate.rejectedPatchSummary,
      )

      if (patchErrorSignature === patchApplicationErrorSignature) {
        patchApplicationErrorStreak += 1
      } else {
        patchApplicationErrorSignature = patchErrorSignature
        patchApplicationErrorStreak = 1
      }

      repairTurns += 1
      mode = 'repair'
      validationFeedback = renderPatchApplicationFeedback({
        failureStreak: patchApplicationErrorStreak,
        message: candidate.message,
        rejectedPatchSummary: candidate.rejectedPatchSummary,
      })
      scene = dependencies.sceneStore.getSnapshot().scene

      const finishRepairFeedback = beginStep(
        'repairing',
        'Prepare repair feedback',
        `repairTurn=${repairTurns}`,
      )
      finishRepairFeedback('passed')
      continue
    }

    finishParseCandidate('passed')
    patchApplicationErrorSignature = null
    patchApplicationErrorStreak = 0

    const finishValidateCandidate = beginStep(
      'validating_candidate',
      'Validate candidate',
      null,
    )

    const validationResult = validateCandidate(candidate.value)
    const attempt = history.recordValidationAttempt(
      candidate.value,
      validationResult.report,
      validationResult.probeReport,
    )
    finishValidateCandidate(
      validationResult.report.valid ? 'passed' : 'failed',
    )

    if (validationResult.asset && validationResult.report.valid) {
      if (!history.canReportReady(candidate.value)) {
        emit(
          dependencies.onEvent,
          runId,
          nextEventIndex,
          'failed',
          'Candidate freshness check failed',
          'The latest candidate no longer matches the successful validation report.',
          'failed',
        )

        return {
          history: history.getSnapshot(),
          message:
            'The latest candidate no longer matches the successful validation report.',
          status: 'failed',
        }
      }

      const finishCommit = beginStep(
        'committing',
        'Commit validated asset',
        `assetId=${validationResult.asset.id}`,
      )

      dependencies.sceneStore.upsertAsset(validationResult.asset)

      const committedReport = withCommitStep(validationResult.report, true)
      finishCommit('passed')

      emit(
        dependencies.onEvent,
        runId,
        nextEventIndex,
        'ready',
        'Asset ready',
        `assetId=${validationResult.asset.id}`,
        'passed',
      )

      return {
        asset: validationResult.asset,
        history: history.getSnapshot(),
        report: committedReport,
        status: 'ready',
      }
    }

    if (repairTurns >= maxRepairTurns) {
      emit(
        dependencies.onEvent,
        runId,
        nextEventIndex,
        'failed',
        'Repair turn cap reached',
        `attempts=${history.getSnapshot().attempts.length}`,
        'failed',
      )

      return {
        history: history.getSnapshot(),
        message: 'The agent could not produce a valid asset before the repair turn cap.',
        status: 'failed',
      }
    }

    repairTurns += 1
    mode = 'repair'
    candidateJson = candidate.value
    validationFeedback = renderRepairFeedback(attempt)
    scene = dependencies.sceneStore.getSnapshot().scene

    const finishRepairFeedback = beginStep(
      'repairing',
      'Prepare repair feedback',
      `repairTurn=${repairTurns}`,
    )
    finishRepairFeedback('passed')
  }

  function nextEventIndex() {
    eventIndex += 1

    return eventIndex
  }

  function beginStep(
    state: AgentLoopState,
    label: string,
    detail: string | null,
  ) {
    return beginAgentLoopStep(
      dependencies.onEvent,
      runId,
      nextEventIndex,
      state,
      label,
      detail,
    )
  }
}

function renderRepairFeedback(attempt: CandidateAttempt) {
  return renderValidationSignals(attempt.report.bundle, {
    candidateFingerprint: attempt.candidateFingerprint,
    failureClusters: attempt.failureClusters,
    failureStreak: attempt.failureStreak,
    probeReport: attempt.probeReport,
    repeated: attempt.repeatedFailure,
    revision: attempt.revision,
  })
}

function applyRepairPatch(currentCandidate: unknown, patchCandidate: unknown) {
  if (currentCandidate === undefined) {
    return {
      message: 'No current candidate JSON exists for the repair patch.',
      rejectedPatchSummary: summarizePatchCandidate(patchCandidate),
      status: 'error' as const,
    }
  }

  const result = applyJsonPatch(currentCandidate, patchCandidate, {
    validateResult: validatePatchedManifestAsset,
  })

  if (result.status === 'error') {
    return {
      ...result,
      rejectedPatchSummary: summarizePatchCandidate(patchCandidate),
    }
  }

  return result
}

function validatePatchedManifestAsset(value: unknown) {
  const parsed = manifestAssetSchema.safeParse(value)

  if (parsed.success) {
    return null
  }

  const issueSummary = parsed.error.issues
    .slice(0, 8)
    .map((issue) => `${formatSchemaPath(issue.path)}: ${issue.message}`)
    .join('\n')
  const remainingCount = parsed.error.issues.length - 8
  const remainingSuffix =
    remainingCount > 0 ? `\n...and ${remainingCount} more schema issue(s).` : ''

  return [
    'Patched candidate does not satisfy the Manifest3D asset schema.',
    issueSummary,
    remainingSuffix,
  ].filter(Boolean).join('\n')
}

function renderPatchApplicationFeedback({
  failureStreak,
  message,
  rejectedPatchSummary,
}: {
  failureStreak: number
  message: string
  rejectedPatchSummary: string
}) {
  const repeatedMessage =
    failureStreak > 1
      ? `This patch-application error has repeated ${failureStreak} times. Do not send the same rejected operation or value again.`
      : 'The rejected patch was not applied.'

  return [
    '<patch_application_error>',
    message,
    '',
    repeatedMessage,
    'The next patch is still applied to the same previous candidate JSON.',
    '',
    '<rejected_patch_summary>',
    rejectedPatchSummary,
    '</rejected_patch_summary>',
    '',
    'Return a valid JSON object with a top-level `patch` array.',
    'Use only `add`, `replace`, and `remove` operations with RFC 6901 JSON Pointer paths into the current candidate JSON.',
    'For transform vectors, geometry sizes, connector endpoint positions, and point arrays, use concrete numeric arrays with the required length; never use an empty array.',
    'Preserve unrelated stable ids and geometry.',
    '</patch_application_error>',
  ].join('\n')
}

function createPatchApplicationErrorSignature(
  message: string,
  rejectedPatchSummary: string,
) {
  return `${message}\n${rejectedPatchSummary}`
}

function summarizePatchCandidate(patchCandidate: unknown) {
  if (!isRecord(patchCandidate) || !Array.isArray(patchCandidate.patch)) {
    return `response=${summarizePatchValue(patchCandidate)}`
  }

  if (patchCandidate.patch.length === 0) {
    return 'patch array is empty'
  }

  const maxOperations = 6
  const operationLines = patchCandidate.patch
    .slice(0, maxOperations)
    .map((operation, index) => summarizePatchOperation(operation, index))
  const remainingCount = patchCandidate.patch.length - maxOperations

  if (remainingCount > 0) {
    operationLines.push(`...and ${remainingCount} more operation(s).`)
  }

  return operationLines.join('\n')
}

function summarizePatchOperation(operation: unknown, index: number) {
  if (!isRecord(operation)) {
    return `${index + 1}. invalid operation=${summarizePatchValue(operation)}`
  }

  const op = typeof operation.op === 'string' ? operation.op : '<missing op>'
  const path =
    typeof operation.path === 'string' ? operation.path : '<missing path>'
  const valueSummary =
    'value' in operation ? ` value=${summarizePatchValue(operation.value)}` : ''

  return `${index + 1}. ${op} ${path}${valueSummary}`
}

function summarizePatchValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `array(length=${value.length})`
  }

  if (isRecord(value)) {
    const keys = Object.keys(value)
    const keySummary = keys.slice(0, 5).join(', ')
    const remainingCount = keys.length - 5
    const suffix = remainingCount > 0 ? `, ...+${remainingCount}` : ''

    return `object(keys=${keySummary}${suffix})`
  }

  if (typeof value === 'string') {
    const truncated = value.length > 80 ? `${value.slice(0, 77)}...` : value

    return JSON.stringify(truncated)
  }

  return String(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function formatSchemaPath(path: readonly (PropertyKey | symbol)[]) {
  if (path.length === 0) {
    return '/'
  }

  return `/${path.map(String).join('/')}`
}

function imageAttachmentMetadata(
  attachments: readonly AgentImageAttachment[],
): PromptImageAttachment[] {
  return attachments.map(({ height, id, mediaType, name, width }) => ({
    height,
    id,
    mediaType,
    name,
    width,
  }))
}

function userInputHistoryMetadata(
  history: readonly AgentUserInputHistoryEntry[],
): PromptUserInputHistoryEntry[] {
  return history.map((entry) => ({
    imageAttachments: imageAttachmentMetadata(entry.imageAttachments ?? []),
    text: entry.text,
    turn: entry.turn,
  }))
}

function collectRequestImageAttachments(
  history: readonly AgentUserInputHistoryEntry[],
  currentAttachments: readonly AgentImageAttachment[],
) {
  const attachmentsByKey = new Map<string, AgentImageAttachment>()

  for (const attachment of [
    ...history.flatMap((entry) => entry.imageAttachments ?? []),
    ...currentAttachments,
  ]) {
    attachmentsByKey.set(`${attachment.id}\n${attachment.imageUrl}`, attachment)
  }

  return [...attachmentsByKey.values()]
}

function emit(
  onEvent: RunManifestAgentLoopDependencies['onEvent'],
  runId: string,
  nextEventIndex: () => number,
  state: AgentLoopState,
  label: string,
  detail: string | null,
  status: AgentLoopStatus,
) {
  onEvent?.({
    detail,
    id: `${runId}:${nextEventIndex()}:${state}`,
    label,
    state,
    status,
  })
}

function beginAgentLoopStep(
  onEvent: RunManifestAgentLoopDependencies['onEvent'],
  runId: string,
  nextEventIndex: () => number,
  state: AgentLoopState,
  label: string,
  detail: string | null,
) {
  const id = `${runId}:${nextEventIndex()}:${state}`

  onEvent?.({
    detail,
    id,
    label,
    state,
    status: 'running',
  })

  return (status: Exclude<AgentLoopStatus, 'running'>, nextDetail = detail) => {
    onEvent?.({
      detail: nextDetail,
      id,
      label,
      state,
      status,
    })
  }
}

function createRunId(now?: () => string) {
  const timestamp = now ? now() : new Date().toISOString()

  return `agent:${timestamp}`
}
