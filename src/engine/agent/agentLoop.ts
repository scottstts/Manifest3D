import type { ManifestAsset, ManifestScene } from '../schema/manifestTypes'
import type { ValidationReport } from '../schema/validationTypes'
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
} from './promptCompiler'
import type {
  AgentImageAttachment,
  AgentRequest,
  OpenAIManifestClient,
} from './providerClient'
import { renderValidationSignals } from './repairFeedback'

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

export type RunManifestAgentLoopInput = {
  imageAttachments?: readonly AgentImageAttachment[]
  maxRepairTurns?: number
  mode: AgentLoopRunMode
  runId?: string
  scene: ManifestScene
  selectedAsset?: ManifestAsset | null
  selectedAssetAttemptContext?: string | null
  signal?: AbortSignal
  userPrompt: string
}

export type RunManifestAgentLoopDependencies = {
  client: OpenAIManifestClient
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

const defaultRepairTurnCap = 4

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
      userPrompt: input.userPrompt,
      validationFeedback,
    })
    const agentRequest: AgentRequest = {
      imageAttachments: input.imageAttachments,
      prompt,
      signal: input.signal,
    }
    finishCompilePrompt('passed')

    const finishModelRequest = beginStep(
      'requesting_model',
      'Request OpenAI candidate',
      `modelPromptMode=${prompt.metadata.mode}`,
    )

    const agentResponse = await dependencies.client.generateAsset(agentRequest)

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

    const candidate = agentResponse.candidate
    finishParseCandidate('passed')

    const finishValidateCandidate = beginStep(
      'validating_candidate',
      'Validate candidate',
      null,
    )

    const validationResult = validateCandidate(candidate)
    const attempt = history.recordValidationAttempt(
      candidate,
      validationResult.report,
    )
    finishValidateCandidate(
      validationResult.report.valid ? 'passed' : 'failed',
    )

    if (validationResult.asset && validationResult.report.valid) {
      if (!history.canReportReady(candidate)) {
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
    candidateJson = candidate
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
    failureStreak: attempt.failureStreak,
    repeated: attempt.repeatedFailure,
  })
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
