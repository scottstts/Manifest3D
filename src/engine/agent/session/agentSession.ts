import type { CompiledManifestPrompt, PromptCompilerMode } from '../prompt/promptCompiler'
import type { AgentImageAttachment } from '../provider/providerClient'
import type { ModelProvider } from '../../config/modelConfig'
import { createCandidateFingerprint } from './candidateHistory'
import { summarizeToolCandidate } from '../protocol/agentToolCalls'

export type AgentSessionProviderContext = {
  maxOutputTokens?: number
  modelId: string
  provider: ModelProvider
  reasoningEffort: string
}

export type PersistedAgentSessionExchange =
  | {
      content: string
      createdAt: string
      exchangeId: string
      kind: 'user'
      mode: PromptCompilerMode
      sequence: number
    }
  | {
      content: string
      createdAt: string
      exchangeId: string
      kind: 'harness_feedback'
      mode: PromptCompilerMode
      sequence: number
    }
  | {
      argumentsJson: string | null
      createdAt: string
      exchangeId: string
      kind: 'model_tool_call'
      providerResponseId: string | null
      sequence: number
      tool: string | null
    }
  | {
      createdAt: string
      exchangeId: string
      kind: 'tool_result'
      sequence: number
      status: 'failed' | 'passed'
      summary: string
    }
  | {
      assetFingerprint: string | null
      content: string
      createdAt: string
      exchangeId: string
      kind: 'continuation_bootstrap'
      sequence: number
    }

export type PersistedAgentSession = {
  assetId: string | null
  contextBufferTokens: number
  contextLimitTokens: number
  createdAt: string
  exchanges: PersistedAgentSessionExchange[]
  latestAssetFingerprint: string | null
  latestProviderResponseId: string | null
  modelId: string
  parentSessionId: string | null
  provider: ModelProvider
  reasoningEffort: string
  sessionId: string
  status: 'active' | 'complete' | 'failed'
  tokenEstimate: number
  updatedAt: string
}

export type AgentSessionRequestTokenInput = {
  imageAttachments?: readonly AgentImageAttachment[]
  prompt: CompiledManifestPrompt
}

export type AgentSessionPrepareResult =
  | {
      includeCandidateJson: boolean
      previousProviderResponseId: string | null
      requestTokenEstimate: number
      sessionId: string
      status: 'ready'
    }
  | {
      contextLimitTokens: number
      message: string
      requestTokenEstimate: number
      safeInputTokenLimit: number
      sessionId: string
      status: 'context_exceeded'
    }

export type AgentSessionTracker = {
  finish: (input: {
    candidate?: unknown
    status: PersistedAgentSession['status']
  }) => void
  getPreviousProviderResponseId: () => string | null
  getSessionId: () => string
  getSnapshot: () => {
    activeSessionId: string
    sessions: PersistedAgentSession[]
  }
  prepareRequest: (input: {
    candidateJson: unknown
    imageAttachments?: readonly AgentImageAttachment[]
    replayContent: string
    prompt: CompiledManifestPrompt
    validationFeedback: string | null
  }) => AgentSessionPrepareResult
  shouldStartContinuation: (input: AgentSessionRequestTokenInput) => boolean
  recordHarnessFeedback: (input: {
    content: string
    mode: PromptCompilerMode
  }) => void
  recordModelResponse: (input: {
    candidate: unknown
    providerResponseId: string | null
    rawText: string
  }) => void
  recordToolResult: (input: {
    status: 'failed' | 'passed'
    summary: string
  }) => void
}

export const agentSessionContextLimitTokens = 256_000
export const agentSessionContextBufferTokens = 50_000

const imageTokenReserveByDetail = {
  high: 1_024,
  low: 256,
  auto: 512,
} as const

export function createAgentSessionTracker({
  assetId = null,
  now = () => new Date().toISOString(),
  parentSessions = [],
  providerContext,
  runId,
}: {
  assetId?: string | null
  now?: () => string
  parentSessions?: readonly PersistedAgentSession[]
  providerContext: AgentSessionProviderContext
  runId: string
}): AgentSessionTracker {
  let sequence = 0
  const sessions: PersistedAgentSession[] = []
  const supportsServerContinuation = supportsProviderResponseContinuation(
    providerContext.provider,
  )
  const contextBufferTokens = getEffectiveContextBufferTokens(providerContext)
  const continuationThresholdTokens = getSafeInputTokenLimit(providerContext)
  const reusableParentSession = findReusableParentSession(
    parentSessions,
    providerContext,
    supportsServerContinuation,
    continuationThresholdTokens,
  )
  let activeSession = createSession({
    assetId,
    contextBufferTokens,
    latestProviderResponseId:
      reusableParentSession?.latestProviderResponseId ?? null,
    now,
    parentSessionId: reusableParentSession?.sessionId ?? null,
    providerContext,
    runId,
    tokenEstimate: reusableParentSession?.tokenEstimate ?? 0,
  })

  sessions.push(activeSession)

  function getSnapshot() {
    return {
      activeSessionId: activeSession.sessionId,
      sessions: sessions.map((session) => ({
        ...session,
        exchanges: [...session.exchanges],
      })),
    }
  }

  function getPreviousProviderResponseId() {
    return supportsServerContinuation
      ? activeSession.latestProviderResponseId
      : null
  }

  function getSessionId() {
    return activeSession.sessionId
  }

  function shouldStartContinuation(input: AgentSessionRequestTokenInput) {
    if (!supportsServerContinuation) {
      return false
    }

    return (
      activeSession.tokenEstimate + estimateAgentRequestInputTokens(input) >
      continuationThresholdTokens
    )
  }

  function prepareRequest({
    candidateJson,
    imageAttachments,
    prompt,
    replayContent,
    validationFeedback,
  }: {
    candidateJson: unknown
    imageAttachments?: readonly AgentImageAttachment[]
    replayContent: string
    prompt: CompiledManifestPrompt
    validationFeedback: string | null
  }): AgentSessionPrepareResult {
    const requestTokenEstimate = estimateAgentRequestInputTokens({
      imageAttachments,
      prompt,
    })

    if (requestTokenEstimate > continuationThresholdTokens) {
      return createContextExceededPrepareResult({
        requestTokenEstimate,
        sessionId: activeSession.sessionId,
        thresholdTokens: continuationThresholdTokens,
      })
    }

    if (shouldStartContinuation({ imageAttachments, prompt })) {
      const candidateFingerprint =
        candidateJson === undefined ? null : createCandidateFingerprint(candidateJson)
      activeSession = createSession({
        assetId,
        contextBufferTokens,
        latestProviderResponseId: null,
        now,
        parentSessionId: activeSession.sessionId,
        providerContext,
        runId,
        tokenEstimate: 0,
      })
      sessions.push(activeSession)
      appendExchange({
        assetFingerprint: candidateFingerprint,
        content: [
          'Started a continuation session because the previous session approached the context buffer.',
          validationFeedback ? `Latest feedback:\n${validationFeedback}` : '',
        ].filter(Boolean).join('\n\n'),
        kind: 'continuation_bootstrap',
      })
    }

    appendExchange({
      content: replayContent,
      kind: 'user',
      mode: prompt.metadata.mode,
    })

    if (supportsServerContinuation) {
      activeSession.tokenEstimate += requestTokenEstimate
    } else {
      activeSession.tokenEstimate = requestTokenEstimate
    }

    touch()

    const previousProviderResponseId = getPreviousProviderResponseId()

    return {
      includeCandidateJson:
        prompt.metadata.mode === 'repair' &&
        previousProviderResponseId === null,
      previousProviderResponseId,
      requestTokenEstimate,
      sessionId: activeSession.sessionId,
      status: 'ready',
    }
  }

  function recordHarnessFeedback({
    content,
    mode,
  }: {
    content: string
    mode: PromptCompilerMode
  }) {
    appendExchange({
      content,
      kind: 'harness_feedback',
      mode,
    })
    touch()
  }

  function recordModelResponse({
    candidate,
    providerResponseId,
    rawText,
  }: {
    candidate: unknown
    providerResponseId: string | null
    rawText: string
  }) {
    const toolCall = extractToolCall(candidate)

    appendExchange({
      argumentsJson: toolCall.argumentsJson,
      kind: 'model_tool_call',
      providerResponseId,
      tool: toolCall.tool,
    })
    activeSession.latestProviderResponseId = providerResponseId
    activeSession.tokenEstimate += estimateTokensFromText(rawText)
    touch()
  }

  function recordToolResult({
    status,
    summary,
  }: {
    status: 'failed' | 'passed'
    summary: string
  }) {
    appendExchange({
      kind: 'tool_result',
      status,
      summary,
    })
    touch()
  }

  function finish({
    candidate,
    status,
  }: {
    candidate?: unknown
    status: PersistedAgentSession['status']
  }) {
    activeSession.status = status
    activeSession.latestAssetFingerprint =
      candidate === undefined ? null : createCandidateFingerprint(candidate)
    touch()
  }

  function appendExchange(
    exchange:
      | Omit<
          Extract<PersistedAgentSessionExchange, { kind: 'continuation_bootstrap' }>,
          'createdAt' | 'exchangeId' | 'sequence'
        >
      | Omit<
          Extract<PersistedAgentSessionExchange, { kind: 'harness_feedback' }>,
          'createdAt' | 'exchangeId' | 'sequence'
        >
      | Omit<
          Extract<PersistedAgentSessionExchange, { kind: 'model_tool_call' }>,
          'createdAt' | 'exchangeId' | 'sequence'
        >
      | Omit<
          Extract<PersistedAgentSessionExchange, { kind: 'tool_result' }>,
          'createdAt' | 'exchangeId' | 'sequence'
        >
      | Omit<
          Extract<PersistedAgentSessionExchange, { kind: 'user' }>,
          'createdAt' | 'exchangeId' | 'sequence'
        >,
  ) {
    sequence += 1
    activeSession.exchanges = [
      ...activeSession.exchanges,
      {
        ...exchange,
        createdAt: now(),
        exchangeId: `${activeSession.sessionId}:exchange:${sequence}`,
        sequence,
      } as PersistedAgentSessionExchange,
    ]
  }

  function touch() {
    activeSession.updatedAt = now()
  }

  return {
    finish,
    getPreviousProviderResponseId,
    getSessionId,
    getSnapshot,
    prepareRequest,
    recordHarnessFeedback,
    recordModelResponse,
    recordToolResult,
    shouldStartContinuation,
  }
}

function createContextExceededPrepareResult({
  requestTokenEstimate,
  sessionId,
  thresholdTokens,
}: {
  requestTokenEstimate: number
  sessionId: string
  thresholdTokens: number
}): Extract<AgentSessionPrepareResult, { status: 'context_exceeded' }> {
  return {
    contextLimitTokens: agentSessionContextLimitTokens,
    message: [
      `The compiled provider request is estimated at ${formatTokenCount(requestTokenEstimate)} input tokens, which exceeds the safe per-request budget of ${formatTokenCount(thresholdTokens)} tokens.`,
      `The harness reserves ${formatTokenCount(agentSessionContextLimitTokens - thresholdTokens)} tokens for model output/reasoning inside the ${formatTokenCount(agentSessionContextLimitTokens)} token context window.`,
      'This run was stopped before sending the request so the provider does not terminate the connection with a context-length or transport error.',
    ].join(' '),
    requestTokenEstimate,
    safeInputTokenLimit: thresholdTokens,
    sessionId,
    status: 'context_exceeded',
  }
}

function createSession({
  assetId,
  contextBufferTokens,
  latestProviderResponseId,
  now,
  parentSessionId,
  providerContext,
  runId,
  tokenEstimate,
}: {
  assetId: string | null
  contextBufferTokens: number
  latestProviderResponseId: string | null
  now: () => string
  parentSessionId: string | null
  providerContext: AgentSessionProviderContext
  runId: string
  tokenEstimate: number
}): PersistedAgentSession {
  const createdAt = now()
  const sessionOrdinal = parentSessionId ? Date.now().toString(36) : '1'

  return {
    assetId,
    contextBufferTokens,
    contextLimitTokens: agentSessionContextLimitTokens,
    createdAt,
    exchanges: [],
    latestAssetFingerprint: null,
    latestProviderResponseId,
    modelId: providerContext.modelId,
    parentSessionId,
    provider: providerContext.provider,
    reasoningEffort: providerContext.reasoningEffort,
    sessionId: `${runId}:session:${sessionOrdinal}`,
    status: 'active',
    tokenEstimate,
    updatedAt: createdAt,
  }
}

function findReusableParentSession(
  parentSessions: readonly PersistedAgentSession[],
  providerContext: AgentSessionProviderContext,
  supportsServerContinuation: boolean,
  continuationThresholdTokens: number,
) {
  if (!supportsServerContinuation) {
    return null
  }

  return [...parentSessions].reverse().find(
    (session) =>
      session.provider === providerContext.provider &&
      session.modelId === providerContext.modelId &&
      session.reasoningEffort === providerContext.reasoningEffort &&
      Boolean(session.latestProviderResponseId) &&
      session.tokenEstimate < continuationThresholdTokens,
  ) ?? null
}

export function supportsProviderResponseContinuation(provider: ModelProvider) {
  return provider === 'openai' || provider === 'gemini'
}

export function getEffectiveContextBufferTokens(
  providerContext: Pick<AgentSessionProviderContext, 'maxOutputTokens'>,
) {
  return Math.max(
    agentSessionContextBufferTokens,
    providerContext.maxOutputTokens ?? 0,
  )
}

export function getSafeInputTokenLimit(
  providerContext: Pick<AgentSessionProviderContext, 'maxOutputTokens'>,
) {
  return Math.max(
    1,
    agentSessionContextLimitTokens - getEffectiveContextBufferTokens(providerContext),
  )
}

export function estimateAgentRequestInputTokens({
  imageAttachments = [],
  prompt,
}: AgentSessionRequestTokenInput) {
  const promptTokens = estimateTokensFromText(`${prompt.system}\n${prompt.user}`)
  const imageTokens = imageAttachments.reduce(
    (total, attachment) => total + estimateImageAttachmentTokens(attachment),
    0,
  )

  return promptTokens + imageTokens
}

function estimateImageAttachmentTokens(attachment: AgentImageAttachment) {
  const detail = attachment.detail === 'low'
    ? 'low'
    : attachment.detail === 'high'
    ? 'high'
    : 'auto'

  return imageTokenReserveByDetail[detail]
}

function extractToolCall(candidate: unknown) {
  if (!isRecord(candidate)) {
    return {
      argumentsJson: summarizeToolCandidate(candidate),
      tool: null,
    }
  }

  if (candidate.schemaVersion === 2) {
    return {
      argumentsJson: null,
      tool: 'submit_manifest_asset',
    }
  }

  return {
    argumentsJson:
      typeof candidate.argumentsJson === 'string'
        ? candidate.argumentsJson
        : Array.isArray(candidate.operations)
        ? stringifySummary({ operations: candidate.operations })
        : Array.isArray(candidate.patch)
        ? stringifySummary({ patch: candidate.patch })
        : null,
    tool: typeof candidate.tool === 'string' ? candidate.tool : null,
  }
}

function stringifySummary(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function estimateTokensFromText(value: string) {
  return Math.max(1, Math.ceil(value.length / 4))
}

function formatTokenCount(value: number) {
  return value.toLocaleString('en-US')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
