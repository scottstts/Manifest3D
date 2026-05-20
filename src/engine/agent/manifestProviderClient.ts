import type { ModelProvider } from '../config/modelConfig'
import { createGeminiManifestClient } from './geminiManifestClient'
import { createOpenAIManifestClient } from './openAiManifestClient'
import type { ManifestProviderClient } from './providerClient'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type CreateManifestProviderClientOptions = {
  apiKey: string
  fetcher?: FetchLike
  provider: ModelProvider
}

export function createManifestProviderClient({
  apiKey,
  fetcher,
  provider,
}: CreateManifestProviderClientOptions): ManifestProviderClient {
  if (provider === 'gemini') {
    return createGeminiManifestClient({ apiKey, fetcher })
  }

  return createOpenAIManifestClient({ apiKey, fetcher })
}
