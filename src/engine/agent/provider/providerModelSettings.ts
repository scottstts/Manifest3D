import {
  geminiModelConfig,
  getProviderReasoningEffortOptions,
  modelConfig,
  modelProviderOptions,
  openRouterModelConfig,
  type GeminiModelConfig,
  type ModelConfig,
  type ModelProvider,
} from '../../config/modelConfig'

export type ProviderModelSettings = {
  modelId: string
  reasoningEffort: string
}

export type ProviderModelSettingsMap = Record<
  ModelProvider,
  ProviderModelSettings
>

const providerModelSettingsStorageKey = 'manifest3d:provider-model-settings'

export const defaultProviderModelSettings = {
  gemini: {
    modelId: geminiModelConfig.model,
    reasoningEffort: geminiModelConfig.thinkingLevel,
  },
  openai: {
    modelId: modelConfig.model,
    reasoningEffort: modelConfig.reasoningEffort,
  },
  openrouter: {
    modelId: openRouterModelConfig.model,
    reasoningEffort: openRouterModelConfig.reasoningEffort,
  },
} satisfies ProviderModelSettingsMap

export function createDefaultProviderModelSettings(): ProviderModelSettingsMap {
  return {
    gemini: { ...defaultProviderModelSettings.gemini },
    openai: { ...defaultProviderModelSettings.openai },
    openrouter: { ...defaultProviderModelSettings.openrouter },
  }
}

export function getDefaultProviderModelSettings(
  provider: ModelProvider,
): ProviderModelSettings {
  return { ...defaultProviderModelSettings[provider] }
}

export function readProviderModelSettings(): ProviderModelSettingsMap {
  if (typeof window === 'undefined') {
    return createDefaultProviderModelSettings()
  }

  try {
    return parseProviderModelSettings(
      window.localStorage.getItem(providerModelSettingsStorageKey),
    )
  } catch {
    return createDefaultProviderModelSettings()
  }
}

export function writeProviderModelSettings(
  settings: ProviderModelSettingsMap,
) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      providerModelSettingsStorageKey,
      serializeProviderModelSettings(settings),
    )
  } catch {
    // Model settings are convenience preferences, not required app state.
  }
}

export function parseProviderModelSettings(
  value: unknown,
): ProviderModelSettingsMap {
  const payload = typeof value === 'string' ? parseJsonOrNull(value) : value
  const settings = createDefaultProviderModelSettings()

  if (!isRecord(payload)) {
    return settings
  }

  for (const provider of modelProviderOptions) {
    const providerPayload = payload[provider]

    if (!isRecord(providerPayload)) {
      continue
    }

    if (typeof providerPayload.modelId === 'string') {
      settings[provider].modelId = providerPayload.modelId
    }

    const reasoningEffort = parseReasoningEffort(
      provider,
      providerPayload.reasoningEffort,
    )

    if (reasoningEffort) {
      settings[provider].reasoningEffort = reasoningEffort
    }
  }

  return settings
}

export function serializeProviderModelSettings(
  settings: ProviderModelSettingsMap,
) {
  return JSON.stringify(settings)
}

export function updateProviderModelId(
  settings: ProviderModelSettingsMap,
  provider: ModelProvider,
  modelId: string,
): ProviderModelSettingsMap {
  return updateProviderModelSettings(settings, provider, { modelId })
}

export function updateProviderReasoningEffort(
  settings: ProviderModelSettingsMap,
  provider: ModelProvider,
  reasoningEffort: string,
): ProviderModelSettingsMap {
  return updateProviderModelSettings(settings, provider, { reasoningEffort })
}

export function resetProviderModelId(
  settings: ProviderModelSettingsMap,
  provider: ModelProvider,
): ProviderModelSettingsMap {
  return updateProviderModelSettings(settings, provider, {
    modelId: defaultProviderModelSettings[provider].modelId,
  })
}

export function resetProviderReasoningEffort(
  settings: ProviderModelSettingsMap,
  provider: ModelProvider,
): ProviderModelSettingsMap {
  return updateProviderModelSettings(settings, provider, {
    reasoningEffort: defaultProviderModelSettings[provider].reasoningEffort,
  })
}

export function createOpenAIModelConfig(
  settings: ProviderModelSettings,
): ModelConfig {
  const reasoningEffort = resolvePresetProviderReasoningEffort(
    'openai',
    settings.reasoningEffort,
  )

  return {
    ...modelConfig,
    model: settings.modelId.trim(),
    reasoningEffort,
  }
}

export function createGeminiModelConfig(
  settings: ProviderModelSettings,
): GeminiModelConfig {
  const thinkingLevel = resolvePresetProviderReasoningEffort(
    'gemini',
    settings.reasoningEffort,
  ) as GeminiModelConfig['thinkingLevel']

  return {
    ...geminiModelConfig,
    model: settings.modelId.trim(),
    thinkingLevel,
  }
}

export function createOpenRouterModelConfig(
  settings: ProviderModelSettings,
): ModelConfig {
  const model = settings.modelId.trim()
  const reasoningEffort = settings.reasoningEffort.trim()

  return {
    ...openRouterModelConfig,
    model: model || openRouterModelConfig.model,
    reasoningEffort:
      reasoningEffort || openRouterModelConfig.reasoningEffort,
  }
}

export function isReasoningEffort(value: unknown): value is string {
  return modelProviderOptions.some((provider) =>
    isProviderReasoningEffort(provider, value),
  )
}

function updateProviderModelSettings(
  settings: ProviderModelSettingsMap,
  provider: ModelProvider,
  patch: Partial<ProviderModelSettings>,
): ProviderModelSettingsMap {
  return {
    ...settings,
    [provider]: {
      ...settings[provider],
      ...patch,
    },
  }
}

function parseReasoningEffort(
  provider: ModelProvider,
  value: unknown,
): string | null {
  if (provider === 'openrouter') {
    return typeof value === 'string' && value.trim().length > 0
      ? value
      : null
  }

  return isProviderReasoningEffort(provider, value)
    ? (value as string)
    : null
}

function isProviderReasoningEffort(
  provider: ModelProvider,
  value: unknown,
) {
  return getProviderReasoningEffortOptions(provider).includes(
    value as string,
  )
}

function resolvePresetProviderReasoningEffort(
  provider: ModelProvider,
  value: unknown,
) {
  return isProviderReasoningEffort(provider, value)
    ? (value as string)
    : defaultProviderModelSettings[provider].reasoningEffort
}

function parseJsonOrNull(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
