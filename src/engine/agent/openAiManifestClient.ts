import { modelConfig, type ModelConfig } from '../config/modelConfig'
import {
  manifestAssetResponseFormatName,
  manifestAssetResponseJsonSchema,
} from '../schema/manifestContract'
import type {
  AgentImageAttachment,
  AgentRequest,
  AgentResponse,
  OpenAIManifestClient,
} from './providerClient'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type CreateOpenAIManifestClientOptions = {
  apiKey?: string
  endpoint?: string
  fetcher?: FetchLike
  model?: ModelConfig
}

export type OpenAIResponsesRequestBody = ReturnType<
  typeof buildOpenAIResponsesRequestBody
>

const defaultEndpoint = 'https://api.openai.com/v1/responses'

export function createOpenAIManifestClient(
  options: CreateOpenAIManifestClientOptions = {},
): OpenAIManifestClient {
  const endpoint = options.endpoint ?? defaultEndpoint
  const fetcher = options.fetcher ?? fetch
  const config = options.model ?? modelConfig
  const apiKey = options.apiKey ?? ''

  return {
    async generateAsset(request) {
      if (!apiKey) {
        return {
          message: 'Generation is unavailable because no OpenAI API key is loaded.',
          reason: 'missing_api_key',
          status: 'unavailable',
        }
      }

      const body = buildOpenAIResponsesRequestBody(request, config)
      let response: Response

      try {
        response = await fetcher(endpoint, {
          body: JSON.stringify(body),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
          signal: request.signal,
        })
      } catch (error) {
        return {
          message:
            error instanceof Error
              ? error.message
              : 'The OpenAI request could not be sent.',
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
          message: extractErrorMessage(json) ?? response.statusText,
          responseId: extractResponseId(json),
          status: 'error',
          statusCode: response.status,
        }
      }

      return parseOpenAIManifestResponse(json)
    },
  }
}

export function buildOpenAIResponsesRequestBody(
  request: AgentRequest,
  config: ModelConfig = modelConfig,
) {
  return {
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
    store: false,
    temperature: config.temperature,
    text: {
      format: {
        name: manifestAssetResponseFormatName,
        schema: manifestAssetResponseJsonSchema,
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

  if (value.status === 'failed' && isRecord(value.incomplete_details)) {
    const reason = value.incomplete_details.reason

    if (typeof reason === 'string') {
      return `The OpenAI response failed: ${reason}.`
    }
  }

  return null
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
