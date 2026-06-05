import {
  modelProviderOptions,
  type ModelProvider,
} from '../config/modelConfig'

const defaultProvider: ModelProvider = 'openai'
const providerPreferenceStorageKey = 'manifest3d:provider'

export function readPreferredModelProvider(): ModelProvider {
  if (typeof window === 'undefined') {
    return defaultProvider
  }

  try {
    return parseModelProvider(
      window.localStorage.getItem(providerPreferenceStorageKey),
    )
  } catch {
    return defaultProvider
  }
}

export function writePreferredModelProvider(provider: ModelProvider) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(providerPreferenceStorageKey, provider)
  } catch {
    // Provider choice is only a convenience preference.
  }
}

export function parseModelProvider(value: unknown): ModelProvider {
  return modelProviderOptions.includes(value as ModelProvider)
    ? (value as ModelProvider)
    : defaultProvider
}

export function getProviderLabel(provider: ModelProvider) {
  return provider === 'gemini'
    ? 'Gemini'
    : provider === 'openrouter'
    ? 'OpenRouter'
    : 'OpenAI'
}
