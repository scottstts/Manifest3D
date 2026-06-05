import type { CompiledManifestPrompt, PromptImageAttachment } from './promptCompiler'

export type AgentImageAttachment = PromptImageAttachment & {
  detail?: 'auto' | 'high' | 'low' | 'original'
  imageUrl: string
}

export type AgentRequest = {
  imageAttachments?: readonly AgentImageAttachment[]
  prompt: CompiledManifestPrompt
  previousResponseId?: string | null
  sessionId?: string | null
  signal?: AbortSignal
}

export type AgentResponse =
  | {
      candidate: unknown
      rawText: string
      responseId: string | null
      status: 'ok'
    }
  | {
      message: string
      reason: 'missing_api_key'
      status: 'unavailable'
    }
  | {
      message: string
      responseId: string | null
      status: 'refused'
    }
  | {
      message: string
      responseId: string | null
      status: 'error'
      statusCode?: number
    }

export type ManifestProviderClient = {
  generateAsset: (request: AgentRequest) => Promise<AgentResponse>
}

export type OpenAIManifestClient = ManifestProviderClient
