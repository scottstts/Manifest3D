import type { CompiledManifestPrompt, PromptImageAttachment } from '../prompt/promptCompiler'

export type AgentImageAttachment = PromptImageAttachment & {
  detail?: 'auto' | 'high' | 'low' | 'original'
  imageUrl: string
}

export type AgentGeminiCachedContentRequest = {
  cacheKey: string
  cacheExpiresAt?: string | null
  cachedContentName?: string | null
  sourceMediaIds: readonly string[]
  stableImageAttachments?: readonly AgentImageAttachment[]
  stablePrompt: CompiledManifestPrompt
}

export type AgentProviderRequestState = {
  geminiCachedContent?: AgentGeminiCachedContentRequest | null
}

export type AgentGeminiCachedContentState = {
  cacheExpiresAt: string | null
  cacheKey: string
  cachedContentName: string
  modelId: string
  provider: 'gemini'
  sourceMediaIds: readonly string[]
}

export type AgentProviderResponseState = {
  geminiCachedContent?: AgentGeminiCachedContentState | null
}

export type AgentConversationMessage = {
  content: string
  imageAttachments?: readonly AgentImageAttachment[]
  role: 'assistant' | 'user'
}

export type AgentRequest = {
  conversationMessages?: readonly AgentConversationMessage[]
  imageAttachments?: readonly AgentImageAttachment[]
  prompt: CompiledManifestPrompt
  previousResponseId?: string | null
  providerSessionId?: string | null
  providerState?: AgentProviderRequestState
  sessionId?: string | null
  signal?: AbortSignal
}

export type AgentResponse =
  | {
      candidate: unknown
      providerState?: AgentProviderResponseState
      rawText: string
      responseId: string | null
      status: 'ok'
    }
  | {
      providerState?: AgentProviderResponseState
      message: string
      reason: 'missing_api_key'
      status: 'unavailable'
    }
  | {
      providerState?: AgentProviderResponseState
      message: string
      responseId: string | null
      status: 'refused'
    }
  | {
      providerState?: AgentProviderResponseState
      message: string
      responseId: string | null
      status: 'error'
      statusCode?: number
    }

export type ManifestProviderClient = {
  generateAsset: (request: AgentRequest) => Promise<AgentResponse>
}

export type OpenAIManifestClient = ManifestProviderClient
