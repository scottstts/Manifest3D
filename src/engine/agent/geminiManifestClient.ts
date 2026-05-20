import {
  geminiModelConfig,
  type GeminiModelConfig,
} from '../config/modelConfig'
import { manifestAssetResponseJsonSchema } from '../schema/manifestContract'
import type {
  AgentImageAttachment,
  AgentRequest,
  AgentResponse,
  ManifestProviderClient,
} from './providerClient'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

type GeminiTextPart = {
  text: string
}

type GeminiInlineDataPart = {
  inline_data: {
    data: string
    mime_type: string
  }
}

type GeminiRequestPart = GeminiTextPart | GeminiInlineDataPart

export type CreateGeminiManifestClientOptions = {
  apiKey?: string
  endpoint?: string
  fetcher?: FetchLike
  model?: GeminiModelConfig
}

export type GeminiGenerateContentRequestBody = ReturnType<
  typeof buildGeminiGenerateContentRequestBody
>

const defaultEndpointBase =
  'https://generativelanguage.googleapis.com/v1beta/models'
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
  const endpoint =
    options.endpoint ??
    `${defaultEndpointBase}/${encodeURIComponent(config.model)}:generateContent`
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

      const body = buildGeminiGenerateContentRequestBody(request, config)
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
          message: extractGeminiErrorMessage(json) ?? response.statusText,
          responseId: extractGeminiResponseId(json),
          status: 'error',
          statusCode: response.status,
        }
      }

      return parseGeminiManifestResponse(json)
    },
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
            text: request.prompt.user,
          },
          ...formatImageParts(request.imageAttachments ?? []),
        ],
        role: 'user',
      },
    ],
    generationConfig: {
      maxOutputTokens: config.maxOutputTokens,
      responseJsonSchema: buildGeminiResponseJsonSchema(),
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

export function buildGeminiResponseJsonSchema() {
  return normalizeGeminiJsonSchema(manifestAssetResponseJsonSchema)
}

export function parseGeminiManifestResponse(response: unknown): AgentResponse {
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
): GeminiRequestPart[] {
  return attachments
    .map((attachment) => createInlineDataPart(attachment))
    .filter((part): part is GeminiInlineDataPart => part !== null)
}

function createInlineDataPart(
  attachment: AgentImageAttachment,
): GeminiInlineDataPart | null {
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

  return typeof value.responseId === 'string' ? value.responseId : null
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
