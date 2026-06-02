import type { ModelProvider } from '../config/modelConfig'
import { createGeminiManifestClient } from './geminiManifestClient'
import { createOpenAIManifestClient } from './openAiManifestClient'
import type { ManifestProviderClient } from './providerClient'
import {
  createGeminiModelConfig,
  createOpenAIModelConfig,
  type ProviderModelSettings,
} from './providerModelSettings'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type CreateManifestProviderClientOptions = {
  apiKey: string
  fetcher?: FetchLike
  modelSettings?: ProviderModelSettings
  provider: ModelProvider
}

export function createManifestProviderClient({
  apiKey,
  fetcher,
  modelSettings,
  provider,
}: CreateManifestProviderClientOptions): ManifestProviderClient {
  if (provider === 'gemini') {
    return createGeminiManifestClient({
      apiKey,
      fetcher,
      model: modelSettings
        ? createGeminiModelConfig(modelSettings)
        : undefined,
    })
  }

  return createOpenAIManifestClient({
    apiKey,
    fetcher,
    model: modelSettings ? createOpenAIModelConfig(modelSettings) : undefined,
  })
}
