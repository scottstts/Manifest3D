import { parseOpenAIManifestResponse } from './openAiManifestClient'
import type {
  AgentImageAttachment,
  AgentRequest,
  AgentResponse,
  ManifestProviderClient,
} from './providerClient'
import { createProviderModelHttpErrorMessage } from './providerModelErrors'
import {
  openRouterModelConfig,
  type ModelConfig,
} from '../config/modelConfig'
import {
  manifestAssetResponseFormatName,
  manifestAssetResponseJsonSchema,
  manifestToolCallResponseFormatName,
  manifestToolCallResponseJsonSchema,
} from '../schema/manifestContract'

const openRouterManifestAssetResponseJsonSchema =
  createOpenRouterCompatibleJsonSchema(manifestAssetResponseJsonSchema)
const openRouterManifestToolCallResponseJsonSchema =
  createOpenRouterCompatibleJsonSchema(manifestToolCallResponseJsonSchema)

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
type OpenRouterModelProfile =
  | 'anthropic'
  | 'general'
  | 'minimax'
  | 'openai'
  | 'qwen'

export type CreateOpenRouterManifestClientOptions = {
  apiKey?: string
  endpoint?: string
  fetcher?: FetchLike
  maxRetries?: number
  model?: ModelConfig
  retryDelayMs?: number
}

export const openRouterChatCompletionsEndpoint =
  'https://openrouter.ai/api/v1/chat/completions'

const defaultMaxRetries = 1
const defaultRetryDelayMs = 1_000
const openRouterAppReferer = 'https://manifest3d.scottsun.io'
const openRouterAppTitle = 'Manifest3D'
const transientHttpStatuses = new Set([
  408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524,
])

export function createOpenRouterManifestClient(
  options: CreateOpenRouterManifestClientOptions = {},
): ManifestProviderClient {
  const endpoint = options.endpoint ?? openRouterChatCompletionsEndpoint
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

      const body = buildOpenRouterChatCompletionsRequestBody(request, config)
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

export function buildOpenRouterChatCompletionsRequestBody(
  request: AgentRequest,
  config: ModelConfig = openRouterModelConfig,
) {
  const modelProfile = getOpenRouterModelProfile(config.model)
  const reasoningEffort = config.reasoningEffort.trim()
  const reasoning = createOpenRouterReasoningConfig({
    maxOutputTokens: config.maxOutputTokens,
    modelProfile,
    reasoningEffort,
  })
  const sessionId = sanitizeOpenRouterSessionId(request.sessionId)

  return {
    max_tokens: config.maxOutputTokens,
    messages: createOpenRouterMessages({
      attachments: request.imageAttachments ?? [],
      modelProfile,
      systemPrompt: request.prompt.system,
      userPrompt: request.prompt.user,
    }),
    model: config.model,
    provider: {
      require_parameters: true,
      sort: {
        by: 'throughput',
      },
    },
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(reasoning ? { reasoning } : {}),
    response_format: getOpenRouterResponseFormat(
      request.prompt.metadata.mode,
      modelProfile,
    ),
  }
}

function parseOpenRouterManifestResponse(response: unknown): AgentResponse {
  const openRouterErrorMessage = extractOpenRouterErrorMessage(response)

  if (openRouterErrorMessage) {
    return {
      message: openRouterErrorMessage,
      responseId: extractResponseId(response),
      status: 'error',
    }
  }

  const responseId = extractResponseId(response)
  const rawText = extractChatCompletionText(response)

  if (rawText) {
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

  if (isOpenRouterChatCompletionResponse(response)) {
    return {
      message: createOpenRouterMissingContentMessage(response),
      responseId,
      status: 'error',
    }
  }

  return parseOpenAIManifestResponse(response)
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
        'HTTP-Referer': openRouterAppReferer,
        'X-OpenRouter-Title': openRouterAppTitle,
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
  const hasRawProviderDetails = hasOpenRouterRawProviderDetails(result.json)

  if (extracted && hasRawProviderDetails) {
    return extracted
  }

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

function getOpenRouterResponseFormat(
  mode: AgentRequest['prompt']['metadata']['mode'],
  modelProfile: OpenRouterModelProfile,
) {
  if (usesJsonObjectResponseFormat(mode, modelProfile)) {
    return {
      type: 'json_object',
    }
  }

  const responseFormat =
    mode === 'create'
      ? {
          name: manifestAssetResponseFormatName,
          schema: openRouterManifestAssetResponseJsonSchema,
        }
      : {
          name: manifestToolCallResponseFormatName,
          schema: openRouterManifestToolCallResponseJsonSchema,
        }

  return {
    json_schema: {
      name: responseFormat.name,
      schema: responseFormat.schema,
      strict: true,
    },
    type: 'json_schema',
  }
}

function usesJsonObjectResponseFormat(
  mode: AgentRequest['prompt']['metadata']['mode'],
  modelProfile: OpenRouterModelProfile,
) {
  return (
    modelProfile === 'general' ||
    modelProfile === 'minimax' ||
    modelProfile === 'qwen' ||
    (mode === 'create' && modelProfile === 'anthropic')
  )
}

function createOpenRouterReasoningConfig({
  maxOutputTokens,
  modelProfile,
  reasoningEffort,
}: {
  maxOutputTokens: number
  modelProfile: OpenRouterModelProfile
  reasoningEffort: string
}) {
  if (!reasoningEffort) {
    return null
  }

  if (modelProfile === 'minimax') {
    return {
      enabled: false,
      exclude: true,
    }
  }

  return {
    exclude: true,
    ...(usesReasoningEffort(modelProfile)
      ? { effort: reasoningEffort }
      : { max_tokens: getOpenRouterReasoningTokenBudget(maxOutputTokens) }),
  }
}

function getOpenRouterReasoningTokenBudget(maxOutputTokens: number) {
  return Math.min(8_192, Math.max(256, Math.floor(maxOutputTokens * 0.25)))
}

function usesReasoningEffort(modelProfile: OpenRouterModelProfile) {
  return modelProfile === 'anthropic' || modelProfile === 'openai'
}

function getOpenRouterModelProfile(modelId: string): OpenRouterModelProfile {
  const normalizedModelId = modelId.trim().toLowerCase()

  if (normalizedModelId.startsWith('openai/')) {
    return 'openai'
  }

  if (normalizedModelId.startsWith('anthropic/')) {
    return 'anthropic'
  }

  if (normalizedModelId.startsWith('qwen/')) {
    return 'qwen'
  }

  if (normalizedModelId.startsWith('minimax/')) {
    return 'minimax'
  }

  return 'general'
}

function createOpenRouterMessages({
  attachments,
  modelProfile,
  systemPrompt,
  userPrompt,
}: {
  attachments: readonly AgentImageAttachment[]
  modelProfile: OpenRouterModelProfile
  systemPrompt: string
  userPrompt: string
}) {
  return [
    {
      content: createSystemMessageContent(systemPrompt, modelProfile),
      role: 'system',
    },
    {
      content: [
        {
          text: userPrompt,
          type: 'text',
        },
        ...formatImageContentParts(attachments),
      ],
      role: 'user',
    },
  ]
}

function createSystemMessageContent(
  systemPrompt: string,
  modelProfile: OpenRouterModelProfile,
) {
  if (!usesExplicitPromptCaching(modelProfile)) {
    return systemPrompt
  }

  return [
    {
      cache_control: {
        type: 'ephemeral',
      },
      text: systemPrompt,
      type: 'text',
    },
  ]
}

function usesExplicitPromptCaching(modelProfile: OpenRouterModelProfile) {
  return modelProfile === 'anthropic' || modelProfile === 'qwen'
}

function formatImageContentParts(attachments: readonly AgentImageAttachment[]) {
  return attachments.map((attachment) => ({
    image_url: {
      detail: getOpenRouterImageDetail(attachment),
      url: attachment.imageUrl,
    },
    type: 'image_url',
  }))
}

function getOpenRouterImageDetail(attachment: AgentImageAttachment) {
  return attachment.detail === 'low' || attachment.detail === 'high'
    ? attachment.detail
    : 'high'
}

function extractErrorMessage(value: unknown): string | null {
  return extractOpenRouterErrorMessage(value)
}

function extractOpenRouterErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  if (isRecord(value.error) && typeof value.error.message === 'string') {
    const rawProviderMessage = extractProviderRawErrorMessage(value.error.metadata)

    return rawProviderMessage
      ? `${value.error.message}: ${rawProviderMessage}`
      : value.error.message
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

function hasOpenRouterRawProviderDetails(value: unknown) {
  if (!isRecord(value) || !isRecord(value.error)) {
    return false
  }

  const metadata = value.error.metadata

  return (
    isRecord(metadata) &&
    ('raw' in metadata ||
      (Array.isArray(metadata.previous_errors) &&
        metadata.previous_errors.length > 0))
  )
}

function extractProviderRawErrorMessage(metadata: unknown): string | null {
  if (!isRecord(metadata) || !('raw' in metadata)) {
    return null
  }

  return summarizeRawError(metadata.raw)
}

function summarizeRawError(value: unknown): string | null {
  if (typeof value === 'string') {
    const parsed = parseJsonOrNull(value)

    if (parsed !== null && parsed !== value) {
      return summarizeRawError(parsed)
    }

    return summarizeText(value)
  }

  if (!isRecord(value)) {
    return value == null ? null : summarizeText(String(value))
  }

  const directMessage =
    typeof value.message === 'string'
      ? value.message
      : isRecord(value.error) && typeof value.error.message === 'string'
      ? value.error.message
      : null

  if (directMessage) {
    return summarizeText(directMessage)
  }

  try {
    return summarizeText(JSON.stringify(value))
  } catch {
    return String(value)
  }
}

function createOpenRouterCompatibleJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => createOpenRouterCompatibleJsonSchema(item))
  }

  if (!isRecord(value)) {
    return value
  }

  const result: Record<string, unknown> = {}

  for (const [key, childValue] of Object.entries(value)) {
    if (
      key === 'exclusiveMaximum' ||
      key === 'exclusiveMinimum' ||
      key === 'maximum' ||
      key === 'maxItems' ||
      key === 'minimum'
    ) {
      continue
    }

    result[key] =
      key === 'minItems' && typeof childValue === 'number' && childValue > 1
        ? 1
        : createOpenRouterCompatibleJsonSchema(childValue)
  }

  return result
}

function extractResponseId(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  return typeof value.id === 'string' ? value.id : null
}

function isOpenRouterChatCompletionResponse(value: unknown) {
  return isRecord(value) && Array.isArray(value.choices)
}

function createOpenRouterMissingContentMessage(value: unknown) {
  const details: string[] = []

  if (isRecord(value) && Array.isArray(value.choices)) {
    const choice = value.choices[0]

    if (isRecord(choice)) {
      if (typeof choice.finish_reason === 'string') {
        details.push(`finish_reason=${choice.finish_reason}`)
      }

      if (typeof choice.native_finish_reason === 'string') {
        details.push(`native_finish_reason=${choice.native_finish_reason}`)
      }

      if (isRecord(choice.message)) {
        const content = choice.message.content

        details.push(content === null ? 'message.content=null' : 'missing message.content')
      }
    }
  }

  return details.length > 0
    ? `The OpenRouter response did not contain assistant message content (${details.join(
        ', ',
      )}).`
    : 'The OpenRouter response did not contain assistant message content.'
}

function extractChatCompletionText(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    return null
  }

  const choice = value.choices[0]

  if (!isRecord(choice) || !isRecord(choice.message)) {
    return null
  }

  const content = choice.message.content

  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return null
  }

  return content
    .map((part) =>
      isRecord(part) && typeof part.text === 'string' ? part.text : '',
    )
    .join('')
    .trim()
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

function summarizeText(value: string) {
  return value.length > 1_000 ? `${value.slice(0, 997)}...` : value
}
