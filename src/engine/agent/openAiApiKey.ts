export type OpenAIApiKeySource = 'local_env' | 'none'

export type OpenAIApiKeyStatus = {
  apiKey: string
  source: OpenAIApiKeySource
}

type LoadStartupOpenAIApiKeyOptions = {
  fetchLocalEnvApiKey?: () => Promise<string>
  hostname?: string
}

type ResolveStartupOpenAIApiKeyOptions = {
  envApiKey?: string
  hostname?: string
}

const localOpenAIApiKeyEndpoint = '/__manifest3d/local-openai-api-key'

export async function loadStartupOpenAIApiKeyStatus(
  options: LoadStartupOpenAIApiKeyOptions = {},
): Promise<OpenAIApiKeyStatus> {
  const hostname = options.hostname ?? readBrowserHostname()

  if (!shouldUseLocalEnvApiKey(hostname)) {
    return createMissingOpenAIApiKeyStatus()
  }

  const envApiKey = (
    await (options.fetchLocalEnvApiKey ?? fetchLocalOpenAIApiKey)()
  ).trim()

  return resolveStartupOpenAIApiKeyStatus({
    envApiKey,
    hostname,
  })
}

export function resolveStartupOpenAIApiKeyStatus(
  options: ResolveStartupOpenAIApiKeyOptions = {},
): OpenAIApiKeyStatus {
  const envApiKey = (options.envApiKey ?? '').trim()
  const hostname = options.hostname ?? readBrowserHostname()

  if (envApiKey && shouldUseLocalEnvApiKey(hostname)) {
    return {
      apiKey: envApiKey,
      source: 'local_env',
    }
  }

  return {
    ...createMissingOpenAIApiKeyStatus(),
  }
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

function readBrowserHostname() {
  return typeof window === 'undefined' ? '' : window.location.hostname
}

async function fetchLocalOpenAIApiKey() {
  if (typeof fetch === 'undefined') {
    return ''
  }

  try {
    const response = await fetch(localOpenAIApiKeyEndpoint, {
      cache: 'no-store',
      credentials: 'same-origin',
    })

    if (!response.ok) {
      return ''
    }

    const payload: unknown = await response.json()

    return isLocalOpenAIApiKeyPayload(payload) ? payload.apiKey : ''
  } catch {
    return ''
  }
}

function isLocalOpenAIApiKeyPayload(
  payload: unknown,
): payload is { apiKey: string } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'apiKey' in payload &&
    typeof payload.apiKey === 'string'
  )
}

function createMissingOpenAIApiKeyStatus(): OpenAIApiKeyStatus {
  return {
    apiKey: '',
    source: 'none',
  }
}
