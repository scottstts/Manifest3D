import type { ModelProvider } from '../../config/modelConfig'
import { createGeminiManifestClient } from './gemini/geminiManifestClient'
import { createOpenAIManifestClient } from './openai/openAiManifestClient'
import { createOpenRouterManifestClient } from './openrouter/openRouterManifestClient'
import type { ManifestProviderClient } from './providerClient'
import {
  createGeminiModelConfig,
  createOpenAIModelConfig,
  createOpenRouterModelConfig,
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

  if (provider === 'openrouter') {
    return createOpenRouterManifestClient({
      apiKey,
      fetcher,
      model: modelSettings
        ? createOpenRouterModelConfig(modelSettings)
        : undefined,
    })
  }

  return createOpenAIManifestClient({
    apiKey,
    fetcher,
    model: modelSettings ? createOpenAIModelConfig(modelSettings) : undefined,
  })
}
