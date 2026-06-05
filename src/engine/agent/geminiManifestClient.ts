import {
  geminiModelConfig,
  type GeminiModelConfig,
} from '../config/modelConfig'
import { manifestToolCallResponseJsonSchema } from '../schema/manifestContract'
import type {
  AgentImageAttachment,
  AgentRequest,
  AgentResponse,
  ManifestProviderClient,
} from './providerClient'
import { createProviderModelHttpErrorMessage } from './providerModelErrors'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

type GeminiGenerateContentTextPart = {
  text: string
}

type GeminiGenerateContentInlineDataPart = {
  inline_data: {
    data: string
    mime_type: string
  }
}

type GeminiGenerateContentRequestPart =
  | GeminiGenerateContentTextPart
  | GeminiGenerateContentInlineDataPart

type GeminiInteractionTextContent = {
  text: string
  type: 'text'
}

type GeminiInteractionImageContent = {
  data: string
  mime_type: string
  type: 'image'
}

type GeminiInteractionContent =
  | GeminiInteractionImageContent
  | GeminiInteractionTextContent

export type CreateGeminiManifestClientOptions = {
  apiKey?: string
  endpoint?: string
  fetcher?: FetchLike
  model?: GeminiModelConfig
}

export type GeminiGenerateContentRequestBody = ReturnType<
  typeof buildGeminiGenerateContentRequestBody
>

const defaultInteractionsEndpoint =
  'https://generativelanguage.googleapis.com/v1beta/interactions'
const geminiJsonSchemaKeys = new Set([
  'additionalProperties',
  'anyOf',
  'description',
  'enum',
  'format',
  'items',
  'maxItems',
  'maximum',
  'minItems',
  'minimum',
  'prefixItems',
  'properties',
  'required',
  'title',
  'type',
])

export function createGeminiManifestClient(
  options: CreateGeminiManifestClientOptions = {},
): ManifestProviderClient {
  const config = options.model ?? geminiModelConfig
  const endpoint = options.endpoint ?? defaultInteractionsEndpoint
  const fetcher = options.fetcher ?? fetch
  const apiKey = options.apiKey ?? ''

  return {
    async generateAsset(request) {
      if (!apiKey) {
        return {
          message: 'Generation is unavailable because no Gemini API key is loaded.',
          reason: 'missing_api_key',
          status: 'unavailable',
        }
      }

      const body = buildGeminiInteractionsRequestBody(request, config)
      let response: Response

      try {
        response = await fetcher(endpoint, {
          body: JSON.stringify(body),
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          method: 'POST',
          signal: request.signal,
        })
      } catch (error) {
        return {
          message:
            error instanceof Error
              ? error.message
              : 'The Gemini request could not be sent.',
          responseId: null,
          status: 'error',
        }
      }

      let json: unknown

      try {
        json = await response.json()
      } catch {
        json = null
      }

      if (!response.ok) {
        return {
          message: createGeminiHttpErrorMessage(json, response, config.model),
          responseId: extractGeminiResponseId(json),
          status: 'error',
          statusCode: response.status,
        }
      }

      return parseGeminiManifestResponse(json, request.prompt.metadata.mode)
    },
  }
}

export function buildGeminiInteractionsRequestBody(
  request: AgentRequest,
  config: GeminiModelConfig = geminiModelConfig,
) {
  return {
    generation_config: {
      max_output_tokens: config.maxOutputTokens,
      temperature: config.temperature,
      thinking_level: config.thinkingLevel,
    },
    input: [
      {
        text: request.prompt.user,
        type: 'text',
      },
      ...formatInteractionImageContents(request.imageAttachments ?? []),
    ],
    model: config.model,
    ...(request.previousResponseId
      ? { previous_interaction_id: request.previousResponseId }
      : {}),
    response_format: buildGeminiResponseJsonSchema(),
    store: true,
    system_instruction: request.prompt.system,
  }
}

export function buildGeminiGenerateContentRequestBody(
  request: AgentRequest,
  config: GeminiModelConfig = geminiModelConfig,
) {
  return {
    contents: [
      {
        parts: [
          {
            text: buildGeminiUserPrompt(request),
          },
          ...formatImageParts(request.imageAttachments ?? []),
        ],
        role: 'user',
      },
    ],
    generationConfig: {
      maxOutputTokens: config.maxOutputTokens,
      responseJsonSchema: buildGeminiResponseJsonSchema(
        request.prompt.metadata.mode,
      ),
      responseMimeType: 'application/json',
      temperature: config.temperature,
      thinkingConfig: {
        thinkingLevel: config.thinkingLevel,
      },
    },
    store: false,
    systemInstruction: {
      parts: [
        {
          text: request.prompt.system,
        },
      ],
    },
  }
}

export function buildGeminiResponseJsonSchema(
  _mode: AgentRequest['prompt']['metadata']['mode'] = 'create',
) {
  void _mode

  return normalizeGeminiJsonSchema(manifestToolCallResponseJsonSchema)
}

function buildGeminiUserPrompt(request: AgentRequest) {
  return request.prompt.user
}

export function parseGeminiManifestResponse(
  response: unknown,
  _mode: AgentRequest['prompt']['metadata']['mode'] = 'create',
): AgentResponse {
  void _mode

  const responseId = extractGeminiResponseId(response)
  const errorMessage = extractGeminiErrorMessage(response)

  if (errorMessage) {
    return {
      message: errorMessage,
      responseId,
      status: 'error',
    }
  }

  const refusal = extractGeminiRefusal(response)

  if (refusal) {
    return {
      message: refusal,
      responseId,
      status: 'refused',
    }
  }

  const rawText = extractGeminiOutputText(response)

  if (!rawText) {
    return {
      message: 'The Gemini response did not contain candidate text.',
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
          ? `The Gemini response was not valid JSON: ${error.message}`
          : 'The Gemini response was not valid JSON.',
      responseId,
      status: 'error',
    }
  }
}

function formatImageParts(
  attachments: readonly AgentImageAttachment[],
): GeminiGenerateContentRequestPart[] {
  return attachments
    .map((attachment) => createInlineDataPart(attachment))
    .filter((part): part is GeminiGenerateContentInlineDataPart => part !== null)
}

function createInlineDataPart(
  attachment: AgentImageAttachment,
): GeminiGenerateContentInlineDataPart | null {
  const parsedDataUrl = parseDataUrl(attachment.imageUrl)

  if (!parsedDataUrl) {
    return null
  }

  return {
    inline_data: {
      data: parsedDataUrl.data,
      mime_type: parsedDataUrl.mimeType || attachment.mediaType,
    },
  }
}

function formatInteractionImageContents(
  attachments: readonly AgentImageAttachment[],
): GeminiInteractionContent[] {
  return attachments
    .map((attachment) => createInteractionImageContent(attachment))
    .filter((content): content is GeminiInteractionImageContent => content !== null)
}

function createInteractionImageContent(
  attachment: AgentImageAttachment,
): GeminiInteractionImageContent | null {
  const parsedDataUrl = parseDataUrl(attachment.imageUrl)

  if (!parsedDataUrl) {
    return null
  }

  return {
    data: parsedDataUrl.data,
    mime_type: parsedDataUrl.mimeType || attachment.mediaType,
    type: 'image',
  }
}

function parseDataUrl(imageUrl: string) {
  if (!imageUrl.startsWith('data:')) {
    return null
  }

  const commaIndex = imageUrl.indexOf(',')

  if (commaIndex < 0) {
    return null
  }

  const metadata = imageUrl.slice('data:'.length, commaIndex)
  const data = imageUrl.slice(commaIndex + 1)
  const metadataParts = metadata.split(';')
  const mimeType = metadataParts[0] ?? ''
  const isBase64 = metadataParts.includes('base64')

  if (!isBase64 || !data) {
    return null
  }

  return {
    data,
    mimeType,
  }
}

function normalizeGeminiJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeGeminiJsonSchema(item))
  }

  if (!isRecord(value)) {
    return value
  }

  const normalized: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(value)) {
    if (!geminiJsonSchemaKeys.has(key)) {
      continue
    }

    if (key === 'properties' && isRecord(entry)) {
      normalized.properties = Object.fromEntries(
        Object.entries(entry).map(([propertyKey, propertyValue]) => [
          propertyKey,
          normalizeGeminiJsonSchema(propertyValue),
        ]),
      )
      continue
    }

    normalized[key] = normalizeGeminiJsonSchema(entry)
  }

  if (
    normalized.minimum === undefined &&
    typeof value.exclusiveMinimum === 'number'
  ) {
    normalized.minimum = value.exclusiveMinimum
  }

  return normalized
}

function extractGeminiResponseId(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  return typeof value.id === 'string'
    ? value.id
    : typeof value.responseId === 'string'
    ? value.responseId
    : null
}

function extractGeminiErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  if (isRecord(value.error) && typeof value.error.message === 'string') {
    return value.error.message
  }

  return null
}

function createGeminiHttpErrorMessage(
  json: unknown,
  response: Response,
  modelId: string,
) {
  const extracted = extractGeminiErrorMessage(json)
  const modelErrorMessage = createProviderModelHttpErrorMessage({
    message: extracted ?? response.statusText,
    modelId,
    providerLabel: 'Gemini',
    statusCode: response.status,
  })

  if (modelErrorMessage) {
    return modelErrorMessage
  }

  return (
    extracted ||
    response.statusText ||
    `Gemini request failed with HTTP ${response.status}.`
  )
}

function extractGeminiRefusal(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  if (
    isRecord(value.promptFeedback) &&
    typeof value.promptFeedback.blockReason === 'string'
  ) {
    return `The Gemini request was blocked: ${value.promptFeedback.blockReason}.`
  }

  if (
    typeof value.status === 'string' &&
    value.status !== 'completed' &&
    value.status !== 'in_progress' &&
    value.status !== 'requires_action'
  ) {
    return `The Gemini interaction ended with status "${value.status}".`
  }

  const candidate = getFirstGeminiCandidate(value)

  if (
    candidate &&
    typeof candidate.finishReason === 'string' &&
    candidate.finishReason !== 'STOP' &&
    candidate.finishReason !== 'MAX_TOKENS'
  ) {
    return `The Gemini response stopped before returning a candidate: ${candidate.finishReason}.`
  }

  return null
}

function extractGeminiOutputText(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  if (typeof value.text === 'string') {
    return value.text
  }

  if (typeof value.output_text === 'string') {
    return value.output_text
  }

  const outputsText = extractGeminiTextContents(value.outputs)

  if (outputsText) {
    return outputsText
  }

  const stepsText = extractGeminiTextContents(value.steps)

  if (stepsText) {
    return stepsText
  }

  const candidate = getFirstGeminiCandidate(value)

  if (!candidate || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) {
    return null
  }

  const textSegments: string[] = []

  for (const part of candidate.content.parts) {
    if (
      isRecord(part) &&
      part.thought !== true &&
      typeof part.text === 'string'
    ) {
      textSegments.push(part.text)
    }
  }

  return textSegments.length > 0 ? textSegments.join('') : null
}

function extractGeminiTextContents(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null
  }

  const textSegments: string[] = []

  for (const item of value) {
    collectGeminiTextContent(item, textSegments)
  }

  return textSegments.length > 0 ? textSegments.join('') : null
}

function collectGeminiTextContent(value: unknown, textSegments: string[]) {
  if (!isRecord(value)) {
    return
  }

  if (value.thought === true) {
    return
  }

  if (
    typeof value.text === 'string' &&
    (value.type === 'text' ||
      value.type === 'model_output' ||
      value.type === undefined)
  ) {
    textSegments.push(value.text)
  }

  if (Array.isArray(value.content)) {
    for (const entry of value.content) {
      collectGeminiTextContent(entry, textSegments)
    }
  }

  if (Array.isArray(value.outputs)) {
    for (const entry of value.outputs) {
      collectGeminiTextContent(entry, textSegments)
    }
  }
}

function getFirstGeminiCandidate(value: Record<string, unknown>) {
  if (!Array.isArray(value.candidates)) {
    return null
  }

  const candidate = value.candidates[0]

  return isRecord(candidate) ? candidate : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
