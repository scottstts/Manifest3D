import {
  buildOpenAIResponsesRequestBody,
  parseOpenAIManifestResponse,
} from '../../src/engine/agent/openAiManifestClient'
import type {
  AgentRequest,
  AgentResponse,
  ManifestProviderClient,
} from '../../src/engine/agent/providerClient'
import { createProviderModelHttpErrorMessage } from '../../src/engine/agent/providerModelErrors'
import { modelConfig, type ModelConfig } from '../../src/engine/config/modelConfig'

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

export type CreateOpenRouterHeadlessManifestClientOptions = {
  apiKey?: string
  endpoint?: string
  fetcher?: FetchLike
  maxRetries?: number
  model?: ModelConfig
  retryDelayMs?: number
}

export type OpenRouterHeadlessSmokeRequestOptions = {
  apiKey?: string
  endpoint?: string
  fetcher?: FetchLike
  label?: string
  maxRetries?: number
  model?: ModelConfig
  prompt?: string
  retryDelayMs?: number
}

export const openRouterHeadlessModelConfig: ModelConfig = {
  ...modelConfig,
  model: 'openai/gpt-5.5',
  reasoningEffort: 'high',
}

export const openRouterHeadlessResponsesEndpoint =
  'https://openrouter.ai/api/v1/responses'

const defaultMaxRetries = 1
const defaultRetryDelayMs = 1_000
const transientHttpStatuses = new Set([
  408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524,
])

export function createOpenRouterHeadlessManifestClient(
  options: CreateOpenRouterHeadlessManifestClientOptions = {},
): ManifestProviderClient {
  const endpoint = options.endpoint ?? openRouterHeadlessResponsesEndpoint
  const fetcher = options.fetcher ?? fetch
  const config = options.model ?? openRouterHeadlessModelConfig
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

      const body = buildOpenRouterHeadlessResponsesRequestBody(request, config)
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

export function buildOpenRouterHeadlessResponsesRequestBody(
  request: AgentRequest,
  config: ModelConfig = openRouterHeadlessModelConfig,
) {
  return buildOpenAIResponsesRequestBody(request, config, {
    background: false,
  })
}

export async function runOpenRouterHeadlessSmokeRequest(
  options: OpenRouterHeadlessSmokeRequestOptions = {},
): Promise<AgentResponse> {
  const endpoint = options.endpoint ?? openRouterHeadlessResponsesEndpoint
  const fetcher = options.fetcher ?? fetch
  const config = options.model ?? openRouterHeadlessModelConfig
  const apiKey = options.apiKey ?? ''
  const maxRetries = options.maxRetries ?? defaultMaxRetries
  const retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs

  if (!apiKey) {
    return {
      message: 'OpenRouter smoke request requires OPENROUTER_API_KEY.',
      reason: 'missing_api_key',
      status: 'unavailable',
    }
  }

  const body = buildOpenRouterHeadlessSmokeRequestBody({
    config,
    label: options.label ?? 'openrouter-headless-smoke',
    prompt:
      options.prompt ??
      'Return JSON confirming this OpenRouter Responses client works.',
  })
  const result = await sendOpenRouterJsonRequestWithRetry({
    apiKey,
    body,
    endpoint,
    fetcher,
    maxRetries,
    retryDelayMs,
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
}

export function buildOpenRouterHeadlessSmokeRequestBody({
  config = openRouterHeadlessModelConfig,
  label = 'openrouter-headless-smoke',
  prompt = 'Return JSON confirming this OpenRouter Responses client works.',
}: {
  config?: ModelConfig
  label?: string
  prompt?: string
} = {}) {
  return {
    background: false,
    input: [
      {
        content: [
          {
            text: prompt,
            type: 'input_text',
          },
        ],
        role: 'user',
      },
    ],
    instructions:
      'Return only JSON matching the provided schema. Do not include prose.',
    max_output_tokens: 200,
    model: config.model,
    reasoning: {
      effort: config.reasoningEffort,
    },
    store: false,
    temperature: config.temperature,
    text: {
      format: {
        name: 'openrouter_headless_client_smoke',
        schema: {
          additionalProperties: false,
          properties: {
            label: {
              type: 'string',
            },
            ok: {
              type: 'boolean',
            },
          },
          required: ['ok', 'label'],
          type: 'object',
        },
        strict: true,
        type: 'json_schema',
      },
    },
    user: label,
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

  const textSegments: string[] = []

  for (const choice of value.choices) {
    if (!isRecord(choice) || !isRecord(choice.message)) {
      continue
    }

    const content = choice.message.content

    if (typeof content === 'string') {
      textSegments.push(content)
    }
  }

  return textSegments.length > 0 ? textSegments.join('') : null
}

function parseJsonOrNull(value: string) {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    return Promise.reject(new Error('The OpenRouter request was aborted.'))
  }

  if (ms <= 0) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener('abort', abortHandler)
    }
    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const abortHandler = () => {
      clearTimeout(timeout)
      cleanup()
      reject(new Error('The OpenRouter request was aborted.'))
    }

    signal?.addEventListener('abort', abortHandler, { once: true })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
