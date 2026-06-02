import { modelConfig, type ModelConfig } from '../config/modelConfig'
import {
  manifestAssetResponseFormatName,
  manifestAssetResponseJsonSchema,
  manifestRepairPatchResponseFormatName,
  manifestRepairPatchResponseJsonSchema,
} from '../schema/manifestContract'
import type {
  AgentImageAttachment,
  AgentRequest,
  AgentResponse,
  OpenAIManifestClient,
} from './providerClient'
import { createProviderModelHttpErrorMessage } from './providerModelErrors'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type CreateOpenAIManifestClientOptions = {
  apiKey?: string
  background?: boolean
  endpoint?: string
  fetcher?: FetchLike
  maxCreateRetries?: number
  maxPollRetries?: number
  model?: ModelConfig
  pollIntervalMs?: number
  retryDelayMs?: number
}

export type OpenAIResponsesRequestBody = ReturnType<
  typeof buildOpenAIResponsesRequestBody
>

const defaultEndpoint = 'https://api.openai.com/v1/responses'
const defaultMaxCreateRetries = 1
const defaultMaxPollRetries = 12
const defaultPollIntervalMs = 5_000
const defaultRetryDelayMs = 1_000
const pendingOpenAIStatuses = new Set(['queued', 'in_progress'])
const transientHttpStatuses = new Set([
  408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524,
])

export function createOpenAIManifestClient(
  options: CreateOpenAIManifestClientOptions = {},
): OpenAIManifestClient {
  const endpoint = options.endpoint ?? defaultEndpoint
  const fetcher = options.fetcher ?? fetch
  const config = options.model ?? modelConfig
  const apiKey = options.apiKey ?? ''
  const background = options.background ?? true
  const maxCreateRetries = options.maxCreateRetries ?? defaultMaxCreateRetries
  const maxPollRetries = options.maxPollRetries ?? defaultMaxPollRetries
  const pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs
  const retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs

  return {
    async generateAsset(request) {
      if (!apiKey) {
        return {
          message: 'Generation is unavailable because no OpenAI API key is loaded.',
          reason: 'missing_api_key',
          status: 'unavailable',
        }
      }

      const body = buildOpenAIResponsesRequestBody(request, config, {
        background,
      })
      const createResult = await sendOpenAIJsonRequestWithRetry({
        apiKey,
        body,
        endpoint,
        fetcher,
        maxRetries: maxCreateRetries,
        retryDelayMs,
        signal: request.signal,
      })

      if (createResult.status === 'network_error') {
        return {
          message: createResult.message,
          responseId: null,
          status: 'error',
        }
      }

      if (!createResult.response.ok) {
        return {
          message: createOpenAIHttpErrorMessage(createResult, config.model),
          responseId: extractResponseId(createResult.json),
          status: 'error',
          statusCode: createResult.response.status,
        }
      }

      if (!background || !isPendingOpenAIResponse(createResult.json)) {
        return parseOpenAIManifestResponse(createResult.json)
      }

      const responseId = extractResponseId(createResult.json)

      if (!responseId) {
        return {
          message: 'The OpenAI background response did not include an id.',
          responseId: null,
          status: 'error',
        }
      }

      return pollOpenAIBackgroundResponse({
        apiKey,
        endpoint,
        fetcher,
        maxPollRetries,
        modelId: config.model,
        pollIntervalMs,
        responseId,
        retryDelayMs,
        signal: request.signal,
      })
    },
  }
}

type OpenAIResponsesRequestOptions = {
  background?: boolean
}

export function buildOpenAIResponsesRequestBody(
  request: AgentRequest,
  config: ModelConfig = modelConfig,
  options: OpenAIResponsesRequestOptions = {},
) {
  const background = options.background ?? true

  return {
    background,
    input: [
      {
        content: [
          {
            text: request.prompt.user,
            type: 'input_text',
          },
          ...formatImageInputs(request.imageAttachments ?? []),
        ],
        role: 'user',
      },
    ],
    instructions: request.prompt.system,
    max_output_tokens: config.maxOutputTokens,
    model: config.model,
    reasoning: {
      effort: config.reasoningEffort,
    },
    store: background,
    temperature: config.temperature,
    text: {
      format: {
        name:
          request.prompt.metadata.mode === 'repair'
            ? manifestRepairPatchResponseFormatName
            : manifestAssetResponseFormatName,
        schema:
          request.prompt.metadata.mode === 'repair'
            ? manifestRepairPatchResponseJsonSchema
            : manifestAssetResponseJsonSchema,
        strict: true,
        type: 'json_schema',
      },
    },
  }
}

export function parseOpenAIManifestResponse(response: unknown): AgentResponse {
  const responseId = extractResponseId(response)
  const errorMessage = extractErrorMessage(response)

  if (errorMessage) {
    return {
      message: errorMessage,
      responseId,
      status: 'error',
    }
  }

  const status = extractStatus(response)

  if (status && status !== 'completed') {
    return {
      message: `The OpenAI response ended with status "${status}".`,
      responseId,
      status: 'error',
    }
  }

  const refusal = extractRefusal(response)

  if (refusal) {
    return {
      message: refusal,
      responseId,
      status: 'refused',
    }
  }

  const rawText = extractOutputText(response)

  if (!rawText) {
    return {
      message: 'The OpenAI response did not contain output_text content.',
      responseId,
      status: 'error',
    }
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
          ? `The OpenAI response was not valid JSON: ${error.message}`
          : 'The OpenAI response was not valid JSON.',
      responseId,
      status: 'error',
    }
  }
}

type OpenAIRequestResult =
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
type OpenAIResponseResult = Extract<OpenAIRequestResult, { status: 'response' }>

async function pollOpenAIBackgroundResponse({
  apiKey,
  endpoint,
  fetcher,
  maxPollRetries,
  modelId,
  pollIntervalMs,
  responseId,
  retryDelayMs,
  signal,
}: {
  apiKey: string
  endpoint: string
  fetcher: FetchLike
  maxPollRetries: number
  modelId: string
  pollIntervalMs: number
  responseId: string
  retryDelayMs: number
  signal?: AbortSignal
}): Promise<AgentResponse> {
  let cancelled = false
  const abortHandler = () => {
    if (cancelled) {
      return
    }

    cancelled = true
    void cancelOpenAIBackgroundResponse({
      apiKey,
      endpoint,
      fetcher,
      responseId,
    })
  }

  if (signal?.aborted) {
    abortHandler()

    return createAbortResponse(responseId)
  }

  signal?.addEventListener('abort', abortHandler, { once: true })

  try {
    while (true) {
      try {
        await sleep(pollIntervalMs, signal)
      } catch {
        abortHandler()

        return createAbortResponse(responseId)
      }

      const pollResult = await sendOpenAIJsonRequestWithRetry({
        apiKey,
        endpoint: `${endpoint}/${encodeURIComponent(responseId)}`,
        fetcher,
        maxRetries: maxPollRetries,
        retryDelayMs,
        signal,
      })

      if (pollResult.status === 'network_error') {
        return {
          message: pollResult.message,
          responseId,
          status: 'error',
        }
      }

      if (!pollResult.response.ok) {
        return {
          message: createOpenAIHttpErrorMessage(pollResult, modelId),
          responseId: extractResponseId(pollResult.json) ?? responseId,
          status: 'error',
          statusCode: pollResult.response.status,
        }
      }

      if (!isPendingOpenAIResponse(pollResult.json)) {
        return parseOpenAIManifestResponse(pollResult.json)
      }
    }
  } finally {
    signal?.removeEventListener('abort', abortHandler)
  }
}

async function sendOpenAIJsonRequestWithRetry({
  apiKey,
  body,
  endpoint,
  fetcher,
  maxRetries,
  retryDelayMs,
  signal,
}: {
  apiKey: string
  body?: unknown
  endpoint: string
  fetcher: FetchLike
  maxRetries: number
  retryDelayMs: number
  signal?: AbortSignal
}): Promise<OpenAIRequestResult> {
  for (let attempt = 0; ; attempt += 1) {
    const result = await sendOpenAIJsonRequest({
      apiKey,
      body,
      endpoint,
      fetcher,
      signal,
    })

    if (!shouldRetryOpenAIRequest(result, attempt, maxRetries)) {
      return result
    }

    try {
      await sleep(retryDelayMs, signal)
    } catch {
      return createNetworkErrorResult(new Error('The OpenAI request was aborted.'))
    }
  }
}

async function sendOpenAIJsonRequest({
  apiKey,
  body,
  endpoint,
  fetcher,
  signal,
}: {
  apiKey: string
  body?: unknown
  endpoint: string
  fetcher: FetchLike
  signal?: AbortSignal
}): Promise<OpenAIRequestResult> {
  let response: Response

  try {
    response = await fetcher(endpoint, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: body === undefined ? 'GET' : 'POST',
      signal,
    })
  } catch (error) {
    return createNetworkErrorResult(error)
  }

  const rawText = await response.text()
  const json = parseJsonOrNull(rawText)

  return {
    json,
    rawText,
    response,
    status: 'response',
  }
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

function shouldRetryOpenAIRequest(
  result: OpenAIRequestResult,
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

async function cancelOpenAIBackgroundResponse({
  apiKey,
  endpoint,
  fetcher,
  responseId,
}: {
  apiKey: string
  endpoint: string
  fetcher: FetchLike
  responseId: string
}) {
  try {
    await fetcher(`${endpoint}/${encodeURIComponent(responseId)}/cancel`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
  } catch {
    // Cancellation is best effort; the abort path still returns immediately.
  }
}

function createOpenAIHttpErrorMessage(
  result: OpenAIResponseResult,
  modelId: string,
) {
  const extracted = extractErrorMessage(result.json)
  const modelErrorMessage = createProviderModelHttpErrorMessage({
    message: extracted ?? result.rawText.trim(),
    modelId,
    providerLabel: 'OpenAI',
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
    `OpenAI request failed with HTTP ${result.response.status}.`
  )
}

function createNetworkErrorResult(error: unknown): OpenAIRequestResult {
  return {
    message: formatOpenAINetworkError(error),
    status: 'network_error',
  }
}

function createAbortResponse(responseId: string): AgentResponse {
  return {
    message: 'The OpenAI request was aborted.',
    responseId,
    status: 'error',
  }
}

function formatOpenAINetworkError(error: unknown) {
  if (!(error instanceof Error)) {
    return 'The OpenAI request could not be sent.'
  }

  const cause = error.cause

  if (cause instanceof Error && cause.message) {
    return `${error.message}: ${cause.message}`
  }

  return error.message
}

function sleep(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    return Promise.reject(new Error('The OpenAI request was aborted.'))
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
      reject(new Error('The OpenAI request was aborted.'))
    }

    signal?.addEventListener('abort', abortHandler, { once: true })
  })
}

function formatImageInputs(attachments: readonly AgentImageAttachment[]) {
  return attachments.map((attachment) => ({
    detail: attachment.detail ?? 'auto',
    image_url: attachment.imageUrl,
    type: 'input_image',
  }))
}

function extractResponseId(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  return typeof value.id === 'string' ? value.id : null
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
      return `The OpenAI response failed: ${reason}.`
    }
  }

  if (value.status === 'cancelled') {
    return 'The OpenAI response was cancelled.'
  }

  return null
}

function extractStatus(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  return typeof value.status === 'string' ? value.status : null
}

function isPendingOpenAIResponse(value: unknown) {
  const status = extractStatus(value)

  return status !== null && pendingOpenAIStatuses.has(status)
}

function extractOutputText(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  if (typeof value.output_text === 'string') {
    return value.output_text
  }

  if (!Array.isArray(value.output)) {
    return null
  }

  const textSegments: string[] = []

  for (const outputItem of value.output) {
    if (!isRecord(outputItem) || !Array.isArray(outputItem.content)) {
      continue
    }

    for (const contentItem of outputItem.content) {
      if (
        isRecord(contentItem) &&
        contentItem.type === 'output_text' &&
        typeof contentItem.text === 'string'
      ) {
        textSegments.push(contentItem.text)
      }
    }
  }

  return textSegments.length > 0 ? textSegments.join('') : null
}

function extractRefusal(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.output)) {
    return null
  }

  for (const outputItem of value.output) {
    if (!isRecord(outputItem) || !Array.isArray(outputItem.content)) {
      continue
    }

    for (const contentItem of outputItem.content) {
      if (!isRecord(contentItem)) {
        continue
      }

      if (
        contentItem.type === 'refusal' &&
        typeof contentItem.refusal === 'string'
      ) {
        return contentItem.refusal
      }

      if (typeof contentItem.refusal === 'string') {
        return contentItem.refusal
      }
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
