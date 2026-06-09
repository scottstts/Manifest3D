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
  type CandidateHistory,
  type CandidateHistorySnapshot,
} from './session/candidateHistory'
import {
  createAgentSessionTracker,
  type AgentSessionProviderContext,
  type PersistedAgentSession,
} from './session/agentSession'
import {
  parseManifestAgentToolCall,
  type ManifestAgentToolName,
} from './protocol/agentToolCalls'
import {
  compileManifestPrompt,
  type PromptCompilerMode,
} from './prompt/promptCompiler'
import type {
  AgentImageAttachment,
  AgentRequest,
  ManifestProviderClient,
} from './provider/providerClient'
import {
  createAgentProgressSnapshot,
  type AgentProgressSnapshot,
} from './session/validationTimeline'
import {
  beginAgentLoopStep,
  createRunId,
  emit,
  upsertAgentLoopEvent,
} from './loop/agentLoopEvents'
import { renderRepairFeedback } from './loop/agentLoopFeedback'
import {
  applyRepairPatch,
  createPatchApplicationErrorSignature,
  renderPatchApplicationFeedback,
} from './loop/repairPatch'
import {
  collectRequestImageAttachments,
  imageAttachmentMetadata,
  userInputHistoryMetadata,
} from './loop/promptMetadata'

export { createRelationLoopHints } from './loop/relationLoopHints'

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
  parentAgentSessions?: readonly PersistedAgentSession[]
  providerContext?: AgentSessionProviderContext
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
  onProgress?: (progress: AgentProgressSnapshot) => void
  sceneStore: SceneStore
  validateCandidate?: (candidate: unknown) => ManifestValidationResult
}

export type AgentLoopResult =
  | {
      asset: ManifestAsset
      agentSessions: readonly PersistedAgentSession[]
      history: CandidateHistorySnapshot
      report: ValidationReport
      status: 'ready'
    }
  | {
      history: CandidateHistorySnapshot
      agentSessions: readonly PersistedAgentSession[]
      message: string
      status: 'failed' | 'cancelled' | 'unavailable'
    }

export const defaultRepairTurnCap = 10

function getExpectedToolName(mode: PromptCompilerMode): ManifestAgentToolName {
  return mode === 'create' ? 'submit_manifest_asset' : 'apply_manifest_patch'
}

export async function runManifestAgentLoop(
  input: RunManifestAgentLoopInput,
  dependencies: RunManifestAgentLoopDependencies,
): Promise<AgentLoopResult> {
  const history = dependencies.history ?? createCandidateHistory()
  const validateCandidate =
    dependencies.validateCandidate ?? validateManifestAssetCandidate
  const runId = input.runId ?? createRunId(dependencies.now)
  const maxRepairTurns = input.maxRepairTurns ?? Number.POSITIVE_INFINITY
  let scene = input.scene
  let mode: PromptCompilerMode = input.mode
  let candidateJson: unknown =
    input.mode === 'edit' ? input.selectedAsset ?? undefined : undefined
  let validationFeedback: string | null = null
  let eventIndex = 0
  let repairTurns = 0
  let runEvents: AgentLoopEvent[] = []
  let patchApplicationErrorSignature: string | null = null
  let patchApplicationErrorStreak = 0
  const userInputHistory = input.userInputHistory ?? []
  const requestImageAttachments = collectRequestImageAttachments(
    userInputHistory,
    input.imageAttachments ?? [],
  )
  const sessionTracker = createAgentSessionTracker({
    assetId: input.selectedAsset?.id ?? null,
    now: dependencies.now,
    parentSessions: input.parentAgentSessions ?? [],
    providerContext:
      input.providerContext ??
      {
        modelId: 'unknown',
        provider: 'openai',
        reasoningEffort: 'unknown',
      },
    runId,
  })

  history.beginRun(runId)
  emit(
    publishEvent,
    runId,
    nextEventIndex,
    'idle',
    'Agent run started',
    null,
    'passed',
  )

  while (true) {
    if (input.signal?.aborted) {
      sessionTracker.finish({ status: 'failed' })
      emit(
        publishEvent,
        runId,
        nextEventIndex,
        'cancelled',
        'Agent run cancelled',
        null,
        'skipped',
      )

      return {
        agentSessions: sessionTracker.getSnapshot().sessions,
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

    const replayContent =
      mode === 'repair'
        ? validationFeedback ?? 'Continue repairing the current canonical asset.'
        : input.userPrompt
    const previousProviderResponseId = sessionTracker.getPreviousProviderResponseId()
    let prompt = compileManifestPrompt({
      candidateJson,
      imageAttachments: imageAttachmentMetadata(input.imageAttachments ?? []),
      mode,
      omitCandidateJson:
        mode === 'repair' && previousProviderResponseId !== null,
      omitSelectedAssetJson:
        mode === 'edit' && previousProviderResponseId !== null,
      scene,
      selectedAsset: input.selectedAsset ?? null,
      selectedAssetAttemptContext: input.selectedAssetAttemptContext ?? null,
      userInputHistory: userInputHistoryMetadata(userInputHistory),
      userPrompt: input.userPrompt,
      validationFeedback,
    })

    if (
      sessionTracker.shouldStartContinuation({
        imageAttachments: requestImageAttachments,
        prompt,
      })
    ) {
      prompt = compileManifestPrompt({
        candidateJson,
        imageAttachments: imageAttachmentMetadata(input.imageAttachments ?? []),
        mode,
        omitCandidateJson: false,
        omitSelectedAssetJson: false,
        scene,
        selectedAsset: input.selectedAsset ?? null,
        selectedAssetAttemptContext: input.selectedAssetAttemptContext ?? null,
        userInputHistory: userInputHistoryMetadata(userInputHistory),
        userPrompt: input.userPrompt,
        validationFeedback,
      })
    }

    const preparedRequest = sessionTracker.prepareRequest({
      candidateJson,
      imageAttachments: requestImageAttachments,
      prompt,
      replayContent,
      validationFeedback,
    })

    if (preparedRequest.status === 'context_exceeded') {
      finishCompilePrompt('failed', preparedRequest.message)
      sessionTracker.finish({ status: 'failed' })
      emit(
        publishEvent,
        runId,
        nextEventIndex,
        'failed',
        'Context budget exceeded',
        preparedRequest.message,
        'failed',
      )

      return {
        agentSessions: sessionTracker.getSnapshot().sessions,
        history: history.getSnapshot(),
        message: preparedRequest.message,
        status: 'failed',
      }
    }

    const agentRequest: AgentRequest = {
      imageAttachments: requestImageAttachments,
      prompt,
      previousResponseId: preparedRequest.previousProviderResponseId,
      sessionId: preparedRequest.sessionId,
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
      sessionTracker.finish({ status: 'failed' })
      emit(
        publishEvent,
        runId,
        nextEventIndex,
        'cancelled',
        'Agent run cancelled',
        null,
        'skipped',
      )

      return {
        agentSessions: sessionTracker.getSnapshot().sessions,
        history: history.getSnapshot(),
        message: 'The agent run was cancelled.',
        status: 'cancelled',
      }
    }

    if (agentResponse.status === 'unavailable') {
      finishModelRequest('failed')
      sessionTracker.finish({ status: 'failed' })
      emit(
        publishEvent,
        runId,
        nextEventIndex,
        'failed',
        'Generation unavailable',
        agentResponse.message,
        'failed',
      )

      return {
        agentSessions: sessionTracker.getSnapshot().sessions,
        history: history.getSnapshot(),
        message: agentResponse.message,
        status: 'unavailable',
      }
    }

    if (agentResponse.status === 'refused' || agentResponse.status === 'error') {
      finishModelRequest('failed')
      sessionTracker.finish({ status: 'failed' })
      emit(
        publishEvent,
        runId,
        nextEventIndex,
        'failed',
        'Model request failed',
        agentResponse.message,
        'failed',
      )

      return {
        agentSessions: sessionTracker.getSnapshot().sessions,
        history: history.getSnapshot(),
        message: agentResponse.message,
        status: 'failed',
      }
    }

    finishModelRequest('passed')
    sessionTracker.recordModelResponse({
      candidate: agentResponse.candidate,
      providerResponseId: agentResponse.responseId,
      rawText: agentResponse.rawText,
    })

    const finishParseCandidate = beginStep(
      'parsing_candidate',
      'Parse candidate JSON',
      agentResponse.responseId
        ? `responseId=${agentResponse.responseId}`
        : null,
    )

    const parsedToolCall = parseManifestAgentToolCall(
      agentResponse.candidate,
      getExpectedToolName(mode),
    )
    const candidate =
      parsedToolCall.status === 'error'
        ? {
            message: parsedToolCall.message,
            rejectedPatchSummary: parsedToolCall.rejectedToolSummary,
            status: 'error' as const,
          }
        : parsedToolCall.kind === 'patch'
        ? applyRepairPatch(candidateJson, parsedToolCall.candidate)
        : { status: 'ok' as const, value: parsedToolCall.candidate }

    if (candidate.status === 'error') {
      sessionTracker.recordToolResult({
        status: 'failed',
        summary: candidate.message,
      })
      finishParseCandidate('failed', candidate.message)

      if (repairTurns >= maxRepairTurns) {
        sessionTracker.finish({ status: 'failed' })
        emit(
          publishEvent,
          runId,
          nextEventIndex,
          'failed',
          'Repair turn cap reached',
          `attempts=${history.getSnapshot().attempts.length}`,
          'failed',
        )

        return {
          agentSessions: sessionTracker.getSnapshot().sessions,
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
        repairTargetAttempt: history.getLatestAttempt(),
        rejectedPatchSummary: candidate.rejectedPatchSummary,
      })
      sessionTracker.recordHarnessFeedback({
        content: validationFeedback,
        mode,
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
    sessionTracker.recordToolResult({
      status: 'passed',
      summary:
        parsedToolCall.status === 'ok'
          ? `${parsedToolCall.tool} applied.`
          : 'Tool call applied.',
    })
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
        sessionTracker.finish({ candidate: candidate.value, status: 'failed' })
        emit(
          publishEvent,
          runId,
          nextEventIndex,
          'failed',
          'Candidate freshness check failed',
          'The latest candidate no longer matches the successful validation report.',
          'failed',
        )

        return {
          agentSessions: sessionTracker.getSnapshot().sessions,
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
      sessionTracker.finish({
        candidate: validationResult.asset,
        status: 'complete',
      })

      emit(
        publishEvent,
        runId,
        nextEventIndex,
        'ready',
        'Asset ready',
        `assetId=${validationResult.asset.id}`,
        'passed',
      )

      return {
        asset: validationResult.asset,
        agentSessions: sessionTracker.getSnapshot().sessions,
        history: history.getSnapshot(),
        report: committedReport,
        status: 'ready',
      }
    }

    if (repairTurns >= maxRepairTurns) {
      sessionTracker.finish({ candidate: candidate.value, status: 'failed' })
      emit(
        publishEvent,
        runId,
        nextEventIndex,
        'failed',
        'Repair turn cap reached',
        `attempts=${history.getSnapshot().attempts.length}`,
        'failed',
      )

      return {
        agentSessions: sessionTracker.getSnapshot().sessions,
        history: history.getSnapshot(),
        message: 'The agent could not produce a valid asset before the repair turn cap.',
        status: 'failed',
      }
    }

    repairTurns += 1
    mode = 'repair'
    candidateJson = candidate.value
    validationFeedback = renderRepairFeedback(
      attempt,
      history.getSnapshot().attempts,
    )
    sessionTracker.recordHarnessFeedback({
      content: validationFeedback,
      mode,
    })
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

  function publishEvent(event: AgentLoopEvent) {
    runEvents = upsertAgentLoopEvent(runEvents, event)
    dependencies.onEvent?.(event)
    dependencies.onProgress?.(
      createAgentProgressSnapshot(runEvents, history.getSnapshot()),
    )
  }

  function beginStep(
    state: AgentLoopState,
    label: string,
    detail: string | null,
  ) {
    return beginAgentLoopStep(
      publishEvent,
      runId,
      nextEventIndex,
      state,
      label,
      detail,
    )
  }
}
