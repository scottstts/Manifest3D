export type OpenAIApiKeySource = 'local_env' | 'none'

export type OpenAIApiKeyStatus = {
  apiKey: string
  source: OpenAIApiKeySource
}

type ResolveStartupOpenAIApiKeyOptions = {
  envApiKey?: string
  hostname?: string
}

export function resolveStartupOpenAIApiKeyStatus(
  options: ResolveStartupOpenAIApiKeyOptions = {},
): OpenAIApiKeyStatus {
  const envApiKey = (options.envApiKey ?? readViteOpenAIApiKey()).trim()
  const hostname = options.hostname ?? readBrowserHostname()

  if (envApiKey && shouldUseLocalEnvApiKey(hostname)) {
    return {
      apiKey: envApiKey,
      source: 'local_env',
    }
  }

  return {
    apiKey: '',
    source: 'none',
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

function readViteOpenAIApiKey() {
  return import.meta.env.VITE_OPENAI_API_KEY ?? ''
}
