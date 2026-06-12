import type { CompiledManifestPrompt, PromptCompilerMode } from '../prompt/promptCompiler'
import type {
  AgentConversationMessage,
  AgentGeminiCachedContentState,
  AgentImageAttachment,
  AgentProviderResponseState,
} from '../provider/providerClient'
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

export type PersistedAgentProviderState = {
  geminiCachedContent?: AgentGeminiCachedContentState | null
  openRouterSessionId?: string | null
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
  providerState?: PersistedAgentProviderState
  reasoningEffort: string
  sessionId: string
  status: 'active' | 'complete' | 'failed'
  tokenEstimate: number
  updatedAt: string
}

export type AgentSessionRequestTokenInput = {
  conversationMessages?: readonly AgentConversationMessage[]
  imageAttachments?: readonly AgentImageAttachment[]
  prompt: CompiledManifestPrompt
}

export type AgentSessionPrepareResult =
  | {
      geminiCachedContent: AgentSessionGeminiCachePrepareResult | null
      includeCandidateJson: boolean
      providerSessionId: string | null
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

export type AgentSessionGeminiCacheInput = {
  cacheKey: string
  sourceMediaIds: readonly string[]
  stableImageAttachments?: readonly AgentImageAttachment[]
  stablePrompt: CompiledManifestPrompt
}

export type AgentSessionGeminiCachePrepareResult = AgentSessionGeminiCacheInput & {
  cacheExpiresAt: string | null
  cachedContentName: string | null
}

export type AgentSessionTracker = {
  finish: (input: {
    candidate?: unknown
    status: PersistedAgentSession['status']
  }) => void
  getPreviousProviderResponseId: () => string | null
  getProviderContextStrategy: () => AgentProviderContextStrategy
  getSessionId: () => string
  getSnapshot: () => {
    activeSessionId: string
    sessions: PersistedAgentSession[]
  }
  prepareRequest: (input: {
    candidateJson: unknown
    conversationMessages?: readonly AgentConversationMessage[]
    imageAttachments?: readonly AgentImageAttachment[]
    replayContent: string
    geminiCache?: AgentSessionGeminiCacheInput | null
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
    providerState?: AgentProviderResponseState | null
    providerResponseId: string | null
    rawText: string
  }) => void
  recordToolResult: (input: {
    status: 'failed' | 'passed'
    summary: string
  }) => void
}

export type AgentProviderContextStrategy =
  | 'explicit_cached_content'
  | 'provider_response_continuation'
  | 'stateless_replay'

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
  const providerContextStrategy = getAgentProviderContextStrategy(
    providerContext.provider,
  )
  const supportsServerContinuation =
    providerContextStrategy === 'provider_response_continuation'
  const contextBufferTokens = getEffectiveContextBufferTokens(providerContext)
  const continuationThresholdTokens = getSafeInputTokenLimit(providerContext)
  const reusableParentSession = findReusableParentSession(
    parentSessions,
    providerContext,
    supportsServerContinuation,
    continuationThresholdTokens,
  )
  const openRouterSessionId = getReusableOpenRouterSessionId(
    parentSessions,
    providerContext,
  )
  let activeSession = createSession({
    assetId,
    contextBufferTokens,
    latestProviderResponseId:
      reusableParentSession?.latestProviderResponseId ?? null,
    now,
    parentSessionId: reusableParentSession?.sessionId ?? null,
    providerContext,
    providerState: createSessionProviderState({
      openRouterSessionId,
      parentProviderState: reusableParentSession?.providerState,
      providerContext,
    }),
    runId,
    tokenEstimate: supportsServerContinuation
      ? reusableParentSession?.tokenEstimate ?? 0
      : 0,
  })

  sessions.push(activeSession)

  function getSnapshot() {
    return {
      activeSessionId: activeSession.sessionId,
      sessions: sessions.map((session) => ({
        ...session,
        exchanges: [...session.exchanges],
        providerState: cloneProviderState(session.providerState),
      })),
    }
  }

  function getPreviousProviderResponseId() {
    return supportsServerContinuation
      ? activeSession.latestProviderResponseId
      : null
  }

  function getProviderContextStrategy() {
    return providerContextStrategy
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
    conversationMessages,
    imageAttachments,
    geminiCache,
    prompt,
    replayContent,
    validationFeedback,
  }: {
    candidateJson: unknown
    conversationMessages?: readonly AgentConversationMessage[]
    geminiCache?: AgentSessionGeminiCacheInput | null
    imageAttachments?: readonly AgentImageAttachment[]
    replayContent: string
    prompt: CompiledManifestPrompt
    validationFeedback: string | null
  }): AgentSessionPrepareResult {
    const requestTokenEstimate = estimateAgentRequestInputTokens({
      conversationMessages,
      imageAttachments,
      prompt,
    })
    const contextTokenEstimate = geminiCache
      ? estimateAgentRequestInputTokens({
          imageAttachments: geminiCache.stableImageAttachments,
          prompt: geminiCache.stablePrompt,
        }) + requestTokenEstimate
      : requestTokenEstimate

    if (contextTokenEstimate > continuationThresholdTokens) {
      return createContextExceededPrepareResult({
        requestTokenEstimate: contextTokenEstimate,
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
        providerState: createSessionProviderState({
          openRouterSessionId,
          parentProviderState: undefined,
          providerContext,
        }),
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
    const geminiCachedContent = prepareGeminiCachedContent(geminiCache)

    return {
      geminiCachedContent,
      includeCandidateJson:
        prompt.metadata.mode === 'repair' &&
        previousProviderResponseId === null,
      providerSessionId:
        providerContext.provider === 'openrouter'
          ? activeSession.providerState?.openRouterSessionId ??
            activeSession.sessionId
          : null,
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
    providerState,
    providerResponseId,
    rawText,
  }: {
    candidate: unknown
    providerState?: AgentProviderResponseState | null
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
    if (providerState?.geminiCachedContent) {
      activeSession.providerState = {
        ...activeSession.providerState,
        geminiCachedContent: {
          ...providerState.geminiCachedContent,
          sourceMediaIds: [...providerState.geminiCachedContent.sourceMediaIds],
        },
      }
    }
    activeSession.tokenEstimate += estimateTokensFromText(rawText)
    touch()
  }

  function prepareGeminiCachedContent(
    input: AgentSessionGeminiCacheInput | null | undefined,
  ): AgentSessionGeminiCachePrepareResult | null {
    if (!input) {
      return null
    }

    const cachedContent = activeSession.providerState?.geminiCachedContent
    const reusableCachedContent =
      cachedContent &&
      cachedContent.cacheKey === input.cacheKey &&
      sameStringSet(cachedContent.sourceMediaIds, input.sourceMediaIds) &&
      isUsableCacheExpiration(cachedContent.cacheExpiresAt, now())
        ? cachedContent
        : null

    return {
      cacheExpiresAt: reusableCachedContent?.cacheExpiresAt ?? null,
      cachedContentName: reusableCachedContent?.cachedContentName ?? null,
      cacheKey: input.cacheKey,
      sourceMediaIds: [...input.sourceMediaIds],
      stableImageAttachments: [...(input.stableImageAttachments ?? [])],
      stablePrompt: input.stablePrompt,
    }
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
    getProviderContextStrategy,
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
  providerState,
  runId,
  tokenEstimate,
}: {
  assetId: string | null
  contextBufferTokens: number
  latestProviderResponseId: string | null
  now: () => string
  parentSessionId: string | null
  providerContext: AgentSessionProviderContext
  providerState?: PersistedAgentProviderState
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
    ...(providerState ? { providerState } : {}),
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
  if (providerContext.provider === 'gemini') {
    return [...parentSessions].reverse().find(
      (session) =>
        hasMatchingProviderContext(session, providerContext) &&
        Boolean(session.providerState?.geminiCachedContent?.cachedContentName),
    ) ?? null
  }

  if (!supportsServerContinuation) {
    return null
  }

  return [...parentSessions].reverse().find(
    (session) =>
      hasMatchingProviderContext(session, providerContext) &&
      Boolean(session.latestProviderResponseId) &&
      session.tokenEstimate < continuationThresholdTokens,
  ) ?? null
}

function getReusableOpenRouterSessionId(
  parentSessions: readonly PersistedAgentSession[],
  providerContext: AgentSessionProviderContext,
) {
  if (providerContext.provider !== 'openrouter') {
    return null
  }

  const parentSession = [...parentSessions].reverse().find((session) =>
    hasMatchingProviderContext(session, providerContext),
  )

  return parentSession
    ? parentSession.providerState?.openRouterSessionId ?? parentSession.sessionId
    : null
}

function hasMatchingProviderContext(
  session: PersistedAgentSession,
  providerContext: AgentSessionProviderContext,
) {
  return (
    session.provider === providerContext.provider &&
    session.modelId === providerContext.modelId &&
    session.reasoningEffort === providerContext.reasoningEffort
  )
}

function cloneProviderState(
  providerState: PersistedAgentProviderState | undefined,
): PersistedAgentProviderState | undefined {
  const geminiCachedContent = providerState?.geminiCachedContent
  const openRouterSessionId = providerState?.openRouterSessionId ?? null

  if (!geminiCachedContent && !openRouterSessionId) {
    return undefined
  }

  return {
    ...(geminiCachedContent
      ? {
          geminiCachedContent: {
            ...geminiCachedContent,
            sourceMediaIds: [...geminiCachedContent.sourceMediaIds],
          },
        }
      : {}),
    ...(openRouterSessionId ? { openRouterSessionId } : {}),
  }
}

function createSessionProviderState({
  openRouterSessionId,
  parentProviderState,
  providerContext,
}: {
  openRouterSessionId: string | null
  parentProviderState?: PersistedAgentProviderState
  providerContext: AgentSessionProviderContext
}) {
  const providerState = cloneProviderState(parentProviderState)

  if (providerContext.provider !== 'openrouter' || !openRouterSessionId) {
    return providerState
  }

  return {
    ...providerState,
    openRouterSessionId,
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) {
    return false
  }

  const rightValues = new Set(right)

  return left.every((value) => rightValues.has(value))
}

function isUsableCacheExpiration(
  cacheExpiresAt: string | null,
  currentTime: string,
) {
  if (!cacheExpiresAt) {
    return true
  }

  const expiresAtMs = Date.parse(cacheExpiresAt)
  const currentMs = Date.parse(currentTime)

  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(currentMs)) {
    return true
  }

  return expiresAtMs > currentMs + 60_000
}

export function supportsProviderResponseContinuation(provider: ModelProvider) {
  return provider === 'openai'
}

export function getAgentProviderContextStrategy(
  provider: ModelProvider,
): AgentProviderContextStrategy {
  if (provider === 'openai') {
    return 'provider_response_continuation'
  }

  if (provider === 'gemini') {
    return 'explicit_cached_content'
  }

  return 'stateless_replay'
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
  conversationMessages = [],
  imageAttachments = [],
  prompt,
}: AgentSessionRequestTokenInput) {
  const hasConversationMessages = conversationMessages.length > 0
  const promptTokens = estimateTokensFromText(
    hasConversationMessages ? prompt.system : `${prompt.system}\n${prompt.user}`,
  )
  const imageTokens = hasConversationMessages
    ? 0
    : imageAttachments.reduce(
        (total, attachment) => total + estimateImageAttachmentTokens(attachment),
        0,
      )
  const conversationTokens = conversationMessages.reduce(
    (total, message) =>
      total +
      estimateTokensFromText(message.content) +
      (message.imageAttachments ?? []).reduce(
        (imageTotal, attachment) =>
          imageTotal + estimateImageAttachmentTokens(attachment),
        0,
      ),
    0,
  )

  return promptTokens + imageTokens + conversationTokens
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
