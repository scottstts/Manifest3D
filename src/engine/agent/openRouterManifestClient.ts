import {
  buildOpenAIResponsesRequestBody,
  parseOpenAIManifestResponse,
} from './openAiManifestClient'
import type {
  AgentRequest,
  AgentResponse,
  ManifestProviderClient,
} from './providerClient'
import { createProviderModelHttpErrorMessage } from './providerModelErrors'
import {
  openRouterModelConfig,
  type ModelConfig,
} from '../config/modelConfig'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

type OpenRouterRequestResult =
  | {
      json: unknown
      rawText: string
      response: Response
      status: 'response'
    }
  | {
      message: string
      status: 'network_error'
    }

type OpenRouterResponseResult = Extract<
  OpenRouterRequestResult,
  { status: 'response' }
>

export type CreateOpenRouterManifestClientOptions = {
  apiKey?: string
  endpoint?: string
  fetcher?: FetchLike
  maxRetries?: number
  model?: ModelConfig
  retryDelayMs?: number
}

export const openRouterResponsesEndpoint =
  'https://openrouter.ai/api/v1/responses'

const defaultMaxRetries = 1
const defaultRetryDelayMs = 1_000
const transientHttpStatuses = new Set([
  408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524,
])

export function createOpenRouterManifestClient(
  options: CreateOpenRouterManifestClientOptions = {},
): ManifestProviderClient {
  const endpoint = options.endpoint ?? openRouterResponsesEndpoint
  const fetcher = options.fetcher ?? fetch
  const config = options.model ?? openRouterModelConfig
  const apiKey = options.apiKey ?? ''
  const maxRetries = options.maxRetries ?? defaultMaxRetries
  const retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs

  return {
    async generateAsset(request) {
      if (!apiKey) {
        return {
          message:
            'Generation is unavailable because no OpenRouter API key is loaded.',
          reason: 'missing_api_key',
          status: 'unavailable',
        }
      }

      const body = buildOpenRouterResponsesRequestBody(request, config)
      const result = await sendOpenRouterJsonRequestWithRetry({
        apiKey,
        body,
        endpoint,
        fetcher,
        maxRetries,
        retryDelayMs,
        signal: request.signal,
      })

      if (result.status === 'network_error') {
        return {
          message: result.message,
          responseId: null,
          status: 'error',
        }
      }

      if (!result.response.ok) {
        return {
          message: createOpenRouterHttpErrorMessage(result, config.model),
          responseId: extractResponseId(result.json),
          status: 'error',
          statusCode: result.response.status,
        }
      }

      return parseOpenRouterManifestResponse(result.json)
    },
  }
}

export function buildOpenRouterResponsesRequestBody(
  request: AgentRequest,
  config: ModelConfig = openRouterModelConfig,
) {
  const body = buildOpenAIResponsesRequestBody(
    {
      ...request,
      previousResponseId: null,
    },
    config,
    {
      background: false,
    },
  )
  const sessionId = sanitizeOpenRouterSessionId(request.sessionId)

  return {
    ...body,
    ...(sessionId ? { session_id: sessionId } : {}),
  }
}

function parseOpenRouterManifestResponse(response: unknown): AgentResponse {
  const parsed = parseOpenAIManifestResponse(response)

  if (
    parsed.status !== 'error' ||
    !parsed.message.includes('output_text content')
  ) {
    return parsed
  }

  const responseId = extractResponseId(response)
  const rawText = extractChatCompletionText(response)

  if (!rawText) {
    return parsed
  }

  try {
    return {
      candidate: JSON.parse(rawText) as unknown,
      rawText,
      responseId,
      status: 'ok',
    }
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? `The OpenRouter response was not valid JSON: ${error.message}`
          : 'The OpenRouter response was not valid JSON.',
      responseId,
      status: 'error',
    }
  }
}

async function sendOpenRouterJsonRequestWithRetry({
  apiKey,
  body,
  endpoint,
  fetcher,
  maxRetries,
  retryDelayMs,
  signal,
}: {
  apiKey: string
  body: unknown
  endpoint: string
  fetcher: FetchLike
  maxRetries: number
  retryDelayMs: number
  signal?: AbortSignal
}): Promise<OpenRouterRequestResult> {
  for (let attempt = 0; ; attempt += 1) {
    const result = await sendOpenRouterJsonRequest({
      apiKey,
      body,
      endpoint,
      fetcher,
      signal,
    })

    if (!shouldRetryOpenRouterRequest(result, attempt, maxRetries)) {
      return result
    }

    try {
      await sleep(retryDelayMs, signal)
    } catch {
      return {
        message: 'The OpenRouter request was aborted.',
        status: 'network_error',
      }
    }
  }
}

async function sendOpenRouterJsonRequest({
  apiKey,
  body,
  endpoint,
  fetcher,
  signal,
}: {
  apiKey: string
  body: unknown
  endpoint: string
  fetcher: FetchLike
  signal?: AbortSignal
}): Promise<OpenRouterRequestResult> {
  let response: Response

  try {
    response = await fetcher(endpoint, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal,
    })
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : 'The OpenRouter request could not be sent.',
      status: 'network_error',
    }
  }

  let rawText: string

  try {
    rawText = await response.text()
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : 'The OpenRouter response body could not be read.',
      status: 'network_error',
    }
  }

  return {
    json: parseJsonOrNull(rawText),
    rawText,
    response,
    status: 'response',
  }
}

function shouldRetryOpenRouterRequest(
  result: OpenRouterRequestResult,
  attempt: number,
  maxRetries: number,
) {
  if (attempt >= maxRetries) {
    return false
  }

  if (result.status === 'network_error') {
    return true
  }

  return transientHttpStatuses.has(result.response.status)
}

function createOpenRouterHttpErrorMessage(
  result: OpenRouterResponseResult,
  modelId: string,
) {
  const extracted = extractErrorMessage(result.json)
  const modelErrorMessage = createProviderModelHttpErrorMessage({
    message: extracted ?? result.rawText.trim(),
    modelId,
    providerLabel: 'OpenRouter',
    statusCode: result.response.status,
  })

  if (modelErrorMessage) {
    return modelErrorMessage
  }

  if (extracted) {
    return extracted
  }

  const body = result.rawText.trim()

  if (body) {
    return body.slice(0, 1_000)
  }

  return (
    result.response.statusText ||
    `OpenRouter request failed with HTTP ${result.response.status}.`
  )
}

function extractErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  if (isRecord(value.error) && typeof value.error.message === 'string') {
    return value.error.message
  }

  if (
    (value.status === 'failed' || value.status === 'incomplete') &&
    isRecord(value.incomplete_details)
  ) {
    const reason = value.incomplete_details.reason

    if (typeof reason === 'string') {
      return `The OpenRouter response failed: ${reason}.`
    }
  }

  if (value.status === 'cancelled') {
    return 'The OpenRouter response was cancelled.'
  }

  return null
}

function extractResponseId(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  return typeof value.id === 'string' ? value.id : null
}

function extractChatCompletionText(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    return null
  }

  const choice = value.choices[0]

  if (!isRecord(choice) || !isRecord(choice.message)) {
    return null
  }

  return typeof choice.message.content === 'string'
    ? choice.message.content
    : null
}

function parseJsonOrNull(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function sanitizeOpenRouterSessionId(value: string | null | undefined) {
  if (!value) {
    return null
  }

  return value.slice(0, 256)
}

function sleep(durationMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted.'))
      return
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, durationMs)

    function abort() {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      reject(new Error('Aborted.'))
    }

    signal?.addEventListener('abort', abort, { once: true })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
