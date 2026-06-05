import type { ManifestAsset, ManifestScene } from '../schema/manifestTypes'
import type {
  ValidationReport,
  ValidationSignal,
} from '../schema/validationTypes'
import {
  manifestAssetSchema,
  manifestJointControlBindingSchema,
} from '../schema/manifestSchema'
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
  createAgentSessionTracker,
  type AgentSessionProviderContext,
  type PersistedAgentSession,
} from './agentSession'
import {
  parseManifestAgentToolCall,
  type ManifestAgentToolName,
} from './agentToolCalls'
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
import { orderFailureSignals, renderValidationSignals } from './repairFeedback'
import { applyJsonPatch } from './jsonPatch'
import {
  createAgentProgressSnapshot,
  type AgentProgressSnapshot,
} from './validationTimeline'

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
    const startsContinuation = sessionTracker.shouldStartContinuation(replayContent)
    const previousProviderResponseId = startsContinuation
      ? null
      : sessionTracker.getPreviousProviderResponseId()
    const prompt = compileManifestPrompt({
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
    const preparedRequest = sessionTracker.prepareRequest({
      candidateJson,
      prompt,
      replayContent,
      validationFeedback,
    })
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

function renderRepairFeedback(
  attempt: CandidateAttempt,
  attempts: readonly CandidateAttempt[] = [attempt],
) {
  return renderValidationSignals(attempt.report.bundle, {
    candidateFingerprint: attempt.candidateFingerprint,
    failureClusters: attempt.failureClusters,
    failureStreak: attempt.failureStreak,
    probeReport: attempt.probeReport,
    relationLoopHints: createRelationLoopHints(attempts),
    repeated: attempt.repeatedFailure,
    revision: attempt.revision,
  })
}

function getExpectedToolName(mode: PromptCompilerMode): ManifestAgentToolName {
  return mode === 'create' ? 'submit_manifest_asset' : 'apply_manifest_patch'
}

export function createRelationLoopHints(attempts: readonly CandidateAttempt[]) {
  const recentFailures = attempts
    .filter((candidateAttempt) => candidateAttempt.status === 'failure')
    .slice(-5)
  const relationStatesByPair = new Map<
    string,
    Map<RelationClusterState, Set<number>>
  >()

  for (const candidateAttempt of recentFailures) {
    for (const cluster of candidateAttempt.failureClusters) {
      const partPair = cluster.refs.partPair

      if (!partPair) {
        continue
      }

      const state = classifyRelationCluster(cluster.kind, cluster.code)

      if (!state) {
        continue
      }

      const states =
        relationStatesByPair.get(partPair) ??
        new Map<RelationClusterState, Set<number>>()
      const attemptRevisions = states.get(state) ?? new Set<number>()

      attemptRevisions.add(candidateAttempt.revision)
      states.set(state, attemptRevisions)
      relationStatesByPair.set(partPair, states)
    }
  }

  return [...relationStatesByPair.entries()]
    .filter(([, states]) => hasRelationStateAlternation(states))
    .slice(0, 4)
    .map(([partPair]) =>
      `Recent repairs alternated between overlap and gap/contact failures for ${partPair}. Treat this as one mounting relation problem: choose exact visual endpoints, add a bracket/saddle/hanger/support path, and use bounded contact or scoped allowance only when the physical fit is intentional.`,
    )
}

type RelationClusterState = 'too-close' | 'too-far'

function classifyRelationCluster(
  kind: string,
  code: string,
): RelationClusterState | null {
  if (
    kind === 'real_overlap' ||
    kind === 'sampled_pose_overlap' ||
    code.includes('overlap_current_pose') ||
    code.includes('overlap_sampled_pose')
  ) {
    return 'too-close'
  }

  if (
    kind === 'exact_contact_gap' ||
    kind === 'path_contact_fit' ||
    code === 'expect_contact_failed' ||
    code === 'expect_gap_failed' ||
    code === 'expect_path_contacts_failed'
  ) {
    return 'too-far'
  }

  return null
}

function hasRelationStateAlternation(
  states: ReadonlyMap<RelationClusterState, ReadonlySet<number>>,
) {
  const tooCloseAttempts = states.get('too-close')
  const tooFarAttempts = states.get('too-far')

  if (!tooCloseAttempts || !tooFarAttempts) {
    return false
  }

  for (const closeAttempt of tooCloseAttempts) {
    for (const farAttempt of tooFarAttempts) {
      if (closeAttempt !== farAttempt) {
        return true
      }
    }
  }

  return false
}

function applyRepairPatch(currentCandidate: unknown, patchCandidate: unknown) {
  if (currentCandidate === undefined) {
    return {
      message: 'No current candidate JSON exists for the repair patch.',
      rejectedPatchSummary: summarizePatchCandidate(patchCandidate),
      status: 'error' as const,
    }
  }

  const normalizedPatchCandidate = normalizeRepairPatchCandidate(patchCandidate)
  const result = applyJsonPatch(currentCandidate, normalizedPatchCandidate, {
    validateResult: validatePatchedManifestAsset,
  })

  if (result.status === 'error') {
    const failedOperationIndex = parsePatchOperationFailureIndex(result.message)

    return {
      ...result,
      rejectedPatchSummary: summarizePatchCandidate(normalizedPatchCandidate, {
        failedOperationIndex,
      }),
    }
  }

  return result
}

function normalizeRepairPatchCandidate(patchCandidate: unknown) {
  return normalizeControlObjectMisplacedInControlBinding(
    normalizeAppendReplaceOperations(patchCandidate),
  )
}

function normalizeAppendReplaceOperations(patchCandidate: unknown) {
  if (!isRecord(patchCandidate) || !Array.isArray(patchCandidate.patch)) {
    return patchCandidate
  }

  let changed = false
  const patch = patchCandidate.patch.map((operation) => {
    if (
      !isRecord(operation) ||
      operation.op !== 'replace' ||
      typeof operation.path !== 'string' ||
      !operation.path.endsWith('/-')
    ) {
      return operation
    }

    changed = true

    return {
      ...operation,
      op: 'add',
    }
  })

  if (!changed) {
    return patchCandidate
  }

  return {
    ...patchCandidate,
    patch,
  }
}

function normalizeControlObjectMisplacedInControlBinding(
  patchCandidate: unknown,
) {
  if (!isRecord(patchCandidate) || !Array.isArray(patchCandidate.patch)) {
    return patchCandidate
  }

  let changed = false
  const patch = patchCandidate.patch.map((operation) => {
    if (
      !isRecord(operation) ||
      (operation.op !== 'add' && operation.op !== 'replace') ||
      typeof operation.path !== 'string' ||
      !isControlJointBindingAppendPath(operation.path)
    ) {
      return operation
    }

    const binding = getSingleNestedControlBinding(operation.value)

    if (!binding) {
      return operation
    }

    changed = true

    return {
      ...operation,
      value: binding,
    }
  })

  if (!changed) {
    return patchCandidate
  }

  return {
    ...patchCandidate,
    patch,
  }
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
  repairTargetAttempt,
  rejectedPatchSummary,
}: {
  failureStreak: number
  message: string
  repairTargetAttempt?: CandidateAttempt | null
  rejectedPatchSummary: string
}) {
  const repeatedMessage =
    failureStreak > 1
      ? `This patch-application error has repeated ${failureStreak} times. Do not send the same rejected operation or value again.`
      : 'The rejected patch was not applied.'
  const pathHints = createPatchApplicationPathHints(message, rejectedPatchSummary)

  return [
    '<patch_application_error>',
    message,
    '',
    repeatedMessage,
    pathHints.length > 0 ? ['', '<path_hints>', ...pathHints, '</path_hints>'].join('\n') : '',
    '',
    'The next patch is still applied to the same previous candidate JSON; no operation from the rejected patch was partially applied.',
    'If the rejected patch contained useful valid operations, resend them in the corrected patch while fixing or removing the bad operation.',
    '',
    '<rejected_patch_summary>',
    rejectedPatchSummary,
    '</rejected_patch_summary>',
    repairTargetAttempt
      ? [
          '',
          '<repair_target_validation_context>',
          renderPatchRepairTargetContext(repairTargetAttempt),
          '</repair_target_validation_context>',
        ].join('\n')
      : '',
    '',
    'Return a valid JSON object with a top-level `patch` array.',
    'Use only `add`, `replace`, and `remove` operations with RFC 6901 JSON Pointer paths into the current candidate JSON. You may address existing array items by stable id with virtual path segments such as `/parts/byId/deck-truss/visuals/byId/deck-panel/transform/position`; the harness resolves those ids against the current candidate before applying the patch.',
    'For transform vectors, geometry sizes, connector endpoint positions, and point arrays, use concrete numeric arrays with the required length; never use an empty array.',
    'Preserve unrelated stable ids and geometry.',
    '</patch_application_error>',
  ].filter(Boolean).join('\n')
}

function renderPatchRepairTargetContext(attempt: CandidateAttempt) {
  const failures = orderFailureSignals(
    attempt.report.bundle.signals.filter(
      (signal) => signal.severity === 'failure',
    ),
  ).slice(0, 8)
  const lines = [
    `candidateRevision=${attempt.revision}`,
    `candidateFingerprint=${attempt.candidateFingerprint}`,
    '- The previous patch was rejected before validation, so the same candidate revision still has these validation failures.',
    '- Fix the patch shape and continue repairing these target failures; do not send a schema-only or no-op patch.',
  ]

  if (attempt.failureClusters.length > 0) {
    lines.push('failureClusters:')

    for (const cluster of attempt.failureClusters.slice(0, 6)) {
      lines.push(`- count=${cluster.count} ${cluster.label}`)
    }
  }

  if (failures.length > 0) {
    lines.push('primaryFailures:')

    for (const failure of failures) {
      lines.push(
        `- [${failure.stage}/${failure.code}] ${failure.summary}${formatTargetFailureRefs(failure.refs)}`,
      )

      const details = formatSignalDetails(failure)

      if (details) {
        lines.push(`  details=${details}`)
      }
    }
  }

  return lines.join('\n')
}

function formatTargetFailureRefs(refs: Record<string, string> | undefined) {
  if (!refs || Object.keys(refs).length === 0) {
    return ''
  }

  return ` refs=${Object.keys(refs)
    .sort()
    .map((key) => `${key}=${formatTargetRefValue(key, refs[key])}`)
    .join(' ')}`
}

function formatSignalDetails(signal: ValidationSignal) {
  if (!signal.details) {
    return null
  }

  const compacted =
    signal.stage === 'sampled_poses' || signal.refs?.poseValues
      ? compactSampledPoseDetails(signal.details)
      : signal.details

  return compactText(compacted, 560)
}

function formatTargetRefValue(key: string, value: string) {
  if (key === 'poseValues') {
    return summarizePoseVector(value)
  }

  return compactText(value, 160)
}

function compactSampledPoseDetails(details: string) {
  return details
    .replace(/\bpose=([^();|\n]+?)\s*\([^)]*\)/g, (_match, poseName: string) =>
      `pose=${poseName.trim()}`,
    )
    .replace(/\bjoints=([^\s;|\n]+)/g, (_match, joints: string) =>
      `joints=${summarizePoseVector(joints)}`,
    )
}

function summarizePoseVector(value: string) {
  const entries = value.split(',').filter(Boolean)

  if (entries.length <= 5) {
    return value
  }

  return `${entries.slice(0, 5).join(',')},+${entries.length - 5}`
}

function compactText(value: string, maxLength: number) {
  return value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 3))}...`
    : value
}

function createPatchApplicationPathHints(
  message: string,
  rejectedPatchSummary: string,
) {
  const combined = `${message}\n${rejectedPatchSummary}`
  const hints: string[] = []
  const geometryPrimitiveTypes =
    '`box`, `roundedBox`, `cylinder`, `sphere`, `cone`, `torus`, `capsule`, `lathe`, `extrude`, `tube`, or `connectorTube`'

  if (
    /\/joints\/(?:\d+|byId\/[^/\s]+)\/limits/.test(combined) &&
    /\b(?:position|rotation|scale)\b/.test(combined)
  ) {
    hints.push(
      '- Joint `limits` only accepts `lower`, `upper`, `effort`, and `velocity`. To move or rotate a joint frame, patch `/joints/byId/<joint-id>/origin/position`, `/origin/rotation`, or `/origin/scale`.',
    )
  }

  if (
    /\/controls\/(?:\d+|byId\/[^/\s]+)\/limits/.test(combined) &&
    /\b(?:type|partAId|partBId|visualAId|visualBId|contactTolerance|maxPenetration|expect_)\b/.test(
      combined,
    )
  ) {
    hints.push(
      '- Control `limits` only accepts numeric `lower` and `upper`. Do not place authored checks or relation descriptors inside control limits; add `expect_*`, `part_exists`, or `joint_exists` objects under `/checks/-`.',
    )
  }

  if (
    hasControlJointBindingPath(combined) &&
    /\bUnrecognized keys: "id", "name", "joints", "limits"/.test(combined)
  ) {
    hints.push(
      '- The rejected value is a full control object placed inside a control `joints` binding array. To append one binding, use only `{ "jointId": "<existing-movable-joint>", "scale": number, "offset": number }` at `/controls/byId/<control-id>/joints/-`; to create a new control, append the full `{ "id", "name", "joints", "limits" }` object at `/controls/-`.',
    )
  }

  if (
    hasControlJointBindingPath(combined) &&
    hasControlJointBindingSchemaDomainMistake(combined)
  ) {
    hints.push(
      '- Control `joints` entries accept only control bindings `{ "jointId": "<existing-movable-joint>", "scale": number, "offset": number }`. Do not put `part_exists`, `joint_exists`, `expect_*`, `allow_*`, relation descriptors, or full joint definitions in `/controls/byId/<control-id>/joints/-`; add authored checks under `/checks/-`, allowances under `/allowances/-`, and patch joint definitions under `/joints/byId/<joint-id>/...`.',
    )
  }

  if (
    /(?:remove|replace) \/controls\/(?:\d+|byId\/[^/\s]+)\/joints\/-/.test(
      combined,
    ) ||
    /Path "\/controls\/(?:\d+|byId\/[^/\s]+)\/joints\/-" does not exist/.test(
      combined,
    )
  ) {
    hints.push(
      '- The `/-` suffix is append-only for `add` operations. Do not `remove` `/controls/byId/<control-id>/joints/-`; remove a concrete existing binding by index only when it should be deleted, or append a new binding with `add`.',
    )
  }

  if (
    /\/joints\/(?:\d+|byId\/[^/\s]+)\/limits/.test(combined) &&
    /\b(?:schemaVersion|parts|materials|checks|allowances)\b/.test(combined)
  ) {
    hints.push(
      '- The rejected value looks like a whole asset object placed into one nested field. Patch only the specific nested property that should change.',
    )
  }

  if (
    /\/checks\/(?:\d+|-)\/pose(?:\/|\b)/.test(combined) &&
    /\b(?:position|rotation|scale)\b/.test(combined)
  ) {
    hints.push(
      '- Authored `check.pose` is a joint pose, not a transform. Use `pose: { "name": "...", "joints": [{ "jointId": "<existing-movable-joint>", "value": number }] }`; patch visual or joint `transform`/`origin` fields separately.',
    )
  }

  if (
    /\/checks\/(?:\d+|-)\/pose(?:\/|\b)/.test(combined) &&
    /\b(?:schemaVersion|parts|materials|checks|allowances|metadata|units)\b/.test(
      combined,
    )
  ) {
    hints.push(
      '- Authored `check.pose` must be only a compact joint pose object: `{ "name": "...", "joints": [{ "jointId": "<existing-movable-joint>", "value": number }] }`. Do not paste a whole asset, part array, material list, checks array, or allowance list inside `pose`.',
    )
  }

  if (
    /\/checks\/(?:\d+|-)\/pose(?:\/|\b)/.test(combined) &&
    /\b(?:type|partAId|partBId|innerPartId|outerPartId|positivePartId|negativePartId|visualAId|visualBId|axes|contactTolerance|maxPenetration)\b/.test(
      combined,
    )
  ) {
    hints.push(
      '- Do not nest another authored check object inside `check.pose`. Put only the sampled joint values in `pose`, and add any additional `expect_*`, `part_exists`, or `joint_exists` object as a separate check under `/checks/-`.',
    )
  }

  if (
    /\/checks\/(?:\d+|-)\/pose\/joints\/\d+/.test(combined) &&
    /\b(?:jointType|type)\b/.test(combined)
  ) {
    hints.push(
      '- Entries in `check.pose.joints` are joint values, not `joint_exists` checks. Use `{ "jointId": "<existing-movable-joint>", "value": number }` inside `pose.joints`; add any `joint_exists` check as a separate object under `/checks/-`.',
    )
  }

  if (
    /\/checks\/(?:\d+|-)\/pose\/joints\/\d+/.test(combined) &&
    /\b(?:parentPartId|childPartId|origin|axis|limits|effort|velocity)\b/.test(
      combined,
    )
  ) {
    hints.push(
      '- Entries in `check.pose.joints` are sampled joint values, not full joint descriptors. Use `{ "jointId": "<existing-movable-joint>", "value": number }` inside `pose.joints`; patch `/joints/byId/<joint-id>/...` separately if the joint definition itself is wrong.',
    )
  }

  if (
    /\b(?:part|visual|joint|material)[A-Za-z]*Id=(?:x|y|z|a|b|todo|dummy|example|placeholder|replace-me|invalid|invalid-id|__invalid__|fake|part-a|part-b|visual-a|visual-b|joint-a|joint-b)\b/i.test(
      combined,
    )
  ) {
    hints.push(
      '- Do not use placeholder reference ids such as `x`, `y`, `a`, `b`, `part-a`, or `visual-b`. Reference existing stable part, visual, joint, and material ids from the supplied candidate, or add the real object before referencing it.',
    )
  }

  if (
    /No item with id "[^"]+" exists under array path "\/(?:parts|joints|materials|controls)/.test(
      combined,
    ) ||
    /Path "\/(?:parts|joints|materials|controls)\/byId\/[^"]+" does not exist/.test(
      combined,
    ) ||
    (
      /\/(?:parts|joints|materials|controls)\/byId\/[^/\s]+\/.+/.test(
        combined,
      ) &&
      /Path "[^"]+" does not exist/.test(combined)
    )
  ) {
    hints.push(
      '- Stable `/.../byId/<id>/...` paths only resolve objects that already exist in the current candidate. If the id-bearing object is new, append the complete object to the owning array first, such as `/controls/-`, `/joints/-`, `/parts/-`, or `/parts/byId/<part-id>/visuals/-`; append checks and allowances with `/checks/-` or `/allowances/-`. Patch nested fields only after that id exists.',
    )
  }

  if (
    /Array index "\d+" is out of range/.test(combined) &&
    /\/(?:checks|allowances|parts|joints|materials|controls)\/\d+/.test(
      combined,
    )
  ) {
    hints.push(
      '- A numeric JSON Pointer array index in the rejected operation is out of range for the current candidate. Use `/checks/-` or `/allowances/-` to append new proof or allowance entries, and use stable `/parts/byId/...`, `/joints/byId/...`, or `/controls/byId/...` paths for existing id-bearing objects instead of guessed numeric indexes.',
    )
  }

  const targetsVisualGeometry =
    /\/parts\/(?:\d+|byId\/[^/\s]+)\/visuals\/(?:\d+|byId\/[^/\s]+)\/geometry(?:\/type)?/.test(
      combined,
    )
  const hasInvalidGeometryDiscriminator =
    targetsVisualGeometry && /Invalid discriminator value/.test(combined)

  if (hasInvalidGeometryDiscriminator) {
    const looksLikeAllowanceObject =
      /\b(?:type=allow_|allow_overlap|allow_isolated_part|reason)\b/.test(
        combined,
      )
    const looksLikeCheckObject =
      /\b(?:type=(?:expect_|part_exists|joint_exists)|partAId|partBId|partId|jointId|positivePartId|negativePartId|innerPartId|outerPartId)\b/.test(
        combined,
      )

    hints.push(
      looksLikeAllowanceObject
        ? `- The rejected value looks like an allowance object placed into a visual \`geometry\` field. Visual geometry must be a primitive descriptor with type ${geometryPrimitiveTypes}. To add or change an allowance, patch \`/allowances/-\` or an existing \`/allowances/<index>\`; to fix that visual, replace only its \`geometry\` with a valid primitive descriptor.`
        : looksLikeCheckObject
          ? `- The rejected value looks like an authored check object placed into a visual \`geometry\` field. Visual geometry must be a primitive descriptor with type ${geometryPrimitiveTypes}. To add or change a relation/material check, patch \`/checks/-\` or an existing \`/checks/<index>\`; to fix that visual, replace only its \`geometry\` with a valid primitive descriptor. A check-only patch is not a geometry repair, and presence checks such as \`part_exists\` and \`joint_exists\` only prove ids exist; they do not repair physical contact, overlap, fit, or motion failures.`
          : `- The rejected patch writes an invalid visual \`geometry.type\`. Visual geometry must be a primitive descriptor with type ${geometryPrimitiveTypes}. If you meant to add or change an authored check, patch \`/checks/-\` or an existing \`/checks/<index>\`; otherwise replace that visual \`geometry\` with a valid primitive descriptor.`,
    )
  }

  return hints
}

function createPatchApplicationErrorSignature(
  message: string,
  rejectedPatchSummary: string,
) {
  return `${message}\n${rejectedPatchSummary}`
}

function parsePatchOperationFailureIndex(message: string) {
  const match = message.match(/\bPatch operation (\d+) failed:/)
  if (!match) {
    return null
  }

  const operationNumber = Number.parseInt(match[1] ?? '', 10)
  if (!Number.isFinite(operationNumber) || operationNumber < 1) {
    return null
  }

  return operationNumber - 1
}

function summarizePatchCandidate(
  patchCandidate: unknown,
  options: { failedOperationIndex?: number | null } = {},
) {
  if (!isRecord(patchCandidate) || !Array.isArray(patchCandidate.patch)) {
    return `response=${summarizePatchValue(patchCandidate)}`
  }

  if (patchCandidate.patch.length === 0) {
    return 'patch array is empty'
  }

  const maxOperations = 6
  const includedIndexes = new Set<number>()
  const operationLines = patchCandidate.patch
    .slice(0, maxOperations)
    .map((operation, index) => {
      includedIndexes.add(index)
      return summarizePatchOperation(operation, index)
    })
  const remainingCount = patchCandidate.patch.length - maxOperations

  if (remainingCount > 0) {
    operationLines.push(`...and ${remainingCount} more operation(s).`)
  }

  if (
    typeof options.failedOperationIndex === 'number' &&
    options.failedOperationIndex >= 0 &&
    options.failedOperationIndex < patchCandidate.patch.length &&
    !includedIndexes.has(options.failedOperationIndex)
  ) {
    operationLines.push('Failed operation:')
    operationLines.push(
      summarizePatchOperation(
        patchCandidate.patch[options.failedOperationIndex],
        options.failedOperationIndex,
      ),
    )
    includedIndexes.add(options.failedOperationIndex)
  }

  const hiddenSchemaDomainOperations = patchCandidate.patch
    .map((operation, index) => ({ index, operation }))
    .filter(
      ({ index, operation }) =>
        index >= maxOperations &&
        !includedIndexes.has(index) &&
        isSuspiciousSchemaDomainOperation(operation),
    )
    .slice(0, 4)

  if (hiddenSchemaDomainOperations.length > 0) {
    operationLines.push('Flagged hidden schema-domain operation(s):')

    for (const { index, operation } of hiddenSchemaDomainOperations) {
      operationLines.push(summarizePatchOperation(operation, index))
    }
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
    const typeSummary = typeof value.type === 'string' ? `type=${value.type}, ` : ''
    const referenceSummary = summarizeReferenceIds(value)
    const referenceSuffix = referenceSummary ? `refs=${referenceSummary}, ` : ''

    return `object(${typeSummary}${referenceSuffix}keys=${keySummary}${suffix})`
  }

  if (typeof value === 'string') {
    const truncated = value.length > 80 ? `${value.slice(0, 77)}...` : value

    return JSON.stringify(truncated)
  }

  return String(value)
}

function isVisualGeometryPatchPath(path: string) {
  return /\/parts\/(?:\d+|byId\/[^/\s]+)\/visuals\/(?:\d+|byId\/[^/\s]+)\/geometry(?:\/type)?$/.test(
    path,
  )
}

function hasControlJointBindingPath(value: string) {
  return /\/controls\/(?:\d+|byId\/[^/\s]+)\/joints(?:\/\d+|\/-|\b)/.test(
    value,
  )
}

function hasControlJointBindingSchemaDomainMistake(value: string) {
  return (
    /\btype=(?:part_exists|joint_exists|expect_[a-z_]+|allow_[a-z_]+)/.test(
      value,
    ) ||
    /\b(?:partId|partAId|partBId|visualAId|visualBId|innerPartId|outerPartId|innerVisualId|outerVisualId|jointType|parentPartId|childPartId|axis|origin|contactTolerance|maxPenetration|minContacts|minOverlap|margin)\b/.test(
      value,
    ) ||
    /Unrecognized keys: "[^"]*(?:partId|partAId|partBId|visualAId|visualBId|innerPartId|outerPartId|innerVisualId|outerVisualId|jointType|parentPartId|childPartId|axis|origin|type)[^"]*"/.test(
      value,
    )
  )
}

function isControlJointBindingItemPath(path: string) {
  return /\/controls\/(?:\d+|byId\/[^/\s]+)\/joints\/(?:\d+|-)$/.test(
    path,
  )
}

function isControlJointBindingAppendPath(path: string) {
  return /\/controls\/(?:\d+|byId\/[^/\s]+)\/joints\/-$/.test(path)
}

function getSingleNestedControlBinding(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.joints) || value.joints.length !== 1) {
    return null
  }

  const parsed = manifestJointControlBindingSchema.safeParse(value.joints[0])

  return parsed.success ? parsed.data : null
}

function isSuspiciousSchemaDomainOperation(operation: unknown) {
  if (!isRecord(operation) || typeof operation.path !== 'string') {
    return false
  }

  if (
    operation.path !== '' &&
    'value' in operation &&
    isWholeAssetDescriptorLike(operation.value)
  ) {
    return true
  }

  if (
    isSuspiciousControlJointBindingOperation({
      op: operation.op,
      path: operation.path,
      value: operation.value,
    })
  ) {
    return true
  }

  return (
    isVisualGeometryPatchPath(operation.path) &&
    'value' in operation &&
    !isPrimitiveGeometryDescriptor(operation.value)
  )
}

function isSuspiciousControlJointBindingOperation(operation: {
  op?: unknown
  path: string
  value?: unknown
}) {
  if (
    operation.op === 'remove' &&
    isControlJointBindingAppendPath(operation.path)
  ) {
    return true
  }

  return (
    (operation.op === 'add' || operation.op === 'replace') &&
    isControlJointBindingItemPath(operation.path) &&
    'value' in operation &&
    !manifestJointControlBindingSchema.safeParse(operation.value).success
  )
}

function isWholeAssetDescriptorLike(value: unknown) {
  if (!isRecord(value)) {
    return false
  }

  return (
    'schemaVersion' in value &&
    'parts' in value &&
    'joints' in value &&
    'materials' in value &&
    'checks' in value &&
    'metadata' in value
  )
}

function isPrimitiveGeometryDescriptor(value: unknown) {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false
  }

  return geometryPrimitiveTypeNames.has(value.type)
}

const geometryPrimitiveTypeNames = new Set([
  'box',
  'roundedBox',
  'cylinder',
  'sphere',
  'torus',
  'cone',
  'capsule',
  'lathe',
  'extrude',
  'tube',
  'connectorTube',
])

function summarizeReferenceIds(value: Record<string, unknown>) {
  const refs = Object.entries(value)
    .filter(
      ([key, childValue]) =>
        isReferenceIdField(key) && typeof childValue === 'string',
    )
    .slice(0, 6)
    .map(([key, childValue]) => `${key}=${childValue}`)

  return refs.join(' ')
}

function isReferenceIdField(key: string) {
  const normalized = key.toLowerCase()

  return (
    normalized.endsWith('id') &&
    (
      normalized.includes('part') ||
      normalized.includes('visual') ||
      normalized.includes('joint') ||
      normalized.includes('material')
    )
  )
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
  publishEvent: (event: AgentLoopEvent) => void,
  runId: string,
  nextEventIndex: () => number,
  state: AgentLoopState,
  label: string,
  detail: string | null,
  status: AgentLoopStatus,
) {
  publishEvent({
    detail,
    id: `${runId}:${nextEventIndex()}:${state}`,
    label,
    state,
    status,
  })
}

function beginAgentLoopStep(
  publishEvent: (event: AgentLoopEvent) => void,
  runId: string,
  nextEventIndex: () => number,
  state: AgentLoopState,
  label: string,
  detail: string | null,
) {
  const id = `${runId}:${nextEventIndex()}:${state}`

  publishEvent({
    detail,
    id,
    label,
    state,
    status: 'running',
  })

  return (status: Exclude<AgentLoopStatus, 'running'>, nextDetail = detail) => {
    publishEvent({
      detail: nextDetail,
      id,
      label,
      state,
      status,
    })
  }
}

function upsertAgentLoopEvent(
  events: readonly AgentLoopEvent[],
  event: AgentLoopEvent,
) {
  const existingEventIndex = events.findIndex(
    (currentEvent) => currentEvent.id === event.id,
  )

  if (existingEventIndex < 0) {
    return [...events, event]
  }

  const nextEvents = [...events]

  nextEvents[existingEventIndex] = event

  return nextEvents
}

function createRunId(now?: () => string) {
  const timestamp = now ? now() : new Date().toISOString()

  return `agent:${timestamp}`
}
