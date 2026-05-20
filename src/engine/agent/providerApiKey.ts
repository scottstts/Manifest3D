import {
  modelProviderOptions,
  type ModelProvider,
} from '../config/modelConfig'

export type ProviderApiKeySource = 'local_env' | 'none'

export type ProviderApiKeyMap = Record<ModelProvider, string>

export type ProviderApiKeyStatus = {
  apiKeys: ProviderApiKeyMap
  source: ProviderApiKeySource
}

type LoadStartupProviderApiKeyOptions = {
  fetchLocalEnvApiKeys?: () => Promise<ProviderApiKeyMap>
  hostname?: string
}

type ResolveStartupProviderApiKeyOptions = {
  envApiKeys?: Partial<ProviderApiKeyMap>
  hostname?: string
}

const localProviderApiKeysEndpoint = '/__manifest3d/local-provider-api-keys'

export function createEmptyProviderApiKeys(): ProviderApiKeyMap {
  return {
    gemini: '',
    openai: '',
  }
}

export async function loadStartupProviderApiKeyStatus(
  options: LoadStartupProviderApiKeyOptions = {},
): Promise<ProviderApiKeyStatus> {
  const hostname = options.hostname ?? readBrowserHostname()

  if (!shouldUseLocalEnvApiKey(hostname)) {
    return createMissingProviderApiKeyStatus()
  }

  const envApiKeys = await (options.fetchLocalEnvApiKeys ??
    fetchLocalProviderApiKeys)()

  return resolveStartupProviderApiKeyStatus({
    envApiKeys,
    hostname,
  })
}

export function resolveStartupProviderApiKeyStatus(
  options: ResolveStartupProviderApiKeyOptions = {},
): ProviderApiKeyStatus {
  const hostname = options.hostname ?? readBrowserHostname()
  const apiKeys = normalizeProviderApiKeys(options.envApiKeys)

  if (shouldUseLocalEnvApiKey(hostname) && hasAnyProviderApiKey(apiKeys)) {
    return {
      apiKeys,
      source: 'local_env',
    }
  }

  return createMissingProviderApiKeyStatus()
}

export function getProviderApiKey(
  provider: ModelProvider,
  startupStatus: ProviderApiKeyStatus,
  sessionApiKeys: ProviderApiKeyMap,
) {
  return startupStatus.apiKeys[provider] || sessionApiKeys[provider]
}

export function isProviderApiKeyLoaded(
  provider: ModelProvider,
  startupStatus: ProviderApiKeyStatus,
  sessionApiKeys: ProviderApiKeyMap,
) {
  if (startupStatus.source === 'local_env') {
    return hasAnyProviderApiKey(startupStatus.apiKeys)
  }

  return Boolean(sessionApiKeys[provider])
}

export function canUseInAppProviderApiKeyInput(hostname: string) {
  return !shouldUseLocalEnvApiKey(hostname)
}

export function shouldUseLocalEnvApiKey(hostname: string) {
  const normalizedHostname = hostname.trim().toLowerCase()

  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname === '127.0.0.1' ||
    normalizedHostname === '::1' ||
    normalizedHostname === '[::1]'
  )
}

function normalizeProviderApiKeys(
  apiKeys: Partial<ProviderApiKeyMap> = {},
): ProviderApiKeyMap {
  const normalizedApiKeys = createEmptyProviderApiKeys()

  for (const provider of modelProviderOptions) {
    normalizedApiKeys[provider] = (apiKeys[provider] ?? '').trim()
  }

  return normalizedApiKeys
}

function hasAnyProviderApiKey(apiKeys: ProviderApiKeyMap) {
  return modelProviderOptions.some((provider) => Boolean(apiKeys[provider]))
}

function readBrowserHostname() {
  return typeof window === 'undefined' ? '' : window.location.hostname
}

async function fetchLocalProviderApiKeys(): Promise<ProviderApiKeyMap> {
  if (typeof fetch === 'undefined') {
    return createEmptyProviderApiKeys()
  }

  try {
    const response = await fetch(localProviderApiKeysEndpoint, {
      cache: 'no-store',
      credentials: 'same-origin',
    })

    if (!response.ok) {
      return createEmptyProviderApiKeys()
    }

    const payload: unknown = await response.json()

    return parseLocalProviderApiKeyPayload(payload)
  } catch {
    return createEmptyProviderApiKeys()
  }
}

function parseLocalProviderApiKeyPayload(payload: unknown): ProviderApiKeyMap {
  if (!isRecord(payload)) {
    return createEmptyProviderApiKeys()
  }

  if (isRecord(payload.apiKeys)) {
    return normalizeProviderApiKeys({
      gemini: readString(payload.apiKeys.gemini),
      openai: readString(payload.apiKeys.openai),
    })
  }

  return normalizeProviderApiKeys({
    gemini: readString(payload.geminiApiKey),
    openai: readString(payload.openaiApiKey) || readString(payload.apiKey),
  })
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function createMissingProviderApiKeyStatus(): ProviderApiKeyStatus {
  return {
    apiKeys: createEmptyProviderApiKeys(),
    source: 'none',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
