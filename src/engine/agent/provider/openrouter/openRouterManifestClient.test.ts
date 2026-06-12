import { describe, expect, it, vi } from 'vitest'
import type { AgentRequest } from '../providerClient'
import {
  buildOpenRouterChatCompletionsRequestBody,
  createOpenRouterManifestClient,
  openRouterChatCompletionsEndpoint,
} from './openRouterManifestClient'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

describe('openRouterManifestClient', () => {
  it('builds a vendor-neutral OpenRouter chat request from the shared app path', () => {
    const body = buildOpenRouterChatCompletionsRequestBody({
      ...createAgentRequest('create'),
      imageAttachments: [
        {
          detail: 'high',
          id: 'ref-1',
          imageUrl: 'data:image/png;base64,ref',
          mediaType: 'image/png',
        },
      ],
      previousResponseId: 'resp_previous_should_not_chain',
      sessionId: 'openrouter-run:session:1',
    })

    expect(body).toMatchObject({
      max_tokens: 64_000,
      messages: [
        {
          content: 'System instructions.',
          role: 'system',
        },
        {
          content: [
            {
              text: 'Create a small asset.',
              type: 'text',
            },
            {
              image_url: {
                detail: 'high',
                url: 'data:image/png;base64,ref',
              },
              type: 'image_url',
            },
          ],
          role: 'user',
        },
      ],
      model: 'openai/gpt-5.5',
      provider: {
        require_parameters: true,
      },
      reasoning: {
        exclude: true,
        effort: 'high',
      },
      response_format: {
        json_schema: {
          name: 'manifest3d_asset',
          strict: true,
        },
        type: 'json_schema',
      },
      session_id: 'openrouter-run:session:1',
    })
    expect(body).not.toHaveProperty('previous_response_id')
    expect(body).not.toHaveProperty('input')
    expect(body).not.toHaveProperty('instructions')
    expect(body).not.toHaveProperty('text')
    expect(body).not.toHaveProperty('max_output_tokens')
    expect(body).not.toHaveProperty('stream')
    expect(body).not.toHaveProperty('temperature')
    expect(body.provider).not.toHaveProperty('sort')
  })

  it('uses providerSessionId for OpenRouter sticky routing when present', () => {
    const body = buildOpenRouterChatCompletionsRequestBody({
      ...createAgentRequest('repair'),
      providerSessionId: 'parent-run:session:1',
      sessionId: 'edit-run:session:1',
    })

    expect(body.session_id).toBe('parent-run:session:1')
  })

  it('uses explicit high image detail for OpenRouter image attachments by default', () => {
    const body = buildOpenRouterChatCompletionsRequestBody({
      ...createAgentRequest('create'),
      imageAttachments: [
        {
          id: 'ref-1',
          imageUrl: 'data:image/png;base64,ref',
          mediaType: 'image/png',
        },
      ],
    })

    expect(body.messages[1]).toMatchObject({
      content: [
        {
          text: 'Create a small asset.',
          type: 'text',
        },
        {
          image_url: {
            detail: 'high',
            url: 'data:image/png;base64,ref',
          },
          type: 'image_url',
        },
      ],
    })
  })

  it('uses the compact patch response schema for OpenRouter repair requests', () => {
    const body = buildOpenRouterChatCompletionsRequestBody(
      createAgentRequest('repair'),
    )

    expect(body.response_format.json_schema).toMatchObject({
      name: 'manifest3d_tool_call',
      strict: true,
    })
  })

  it('uses JSON-object create mode for non-OpenAI OpenRouter models', () => {
    const createBody = buildOpenRouterChatCompletionsRequestBody(
      createAgentRequest('create'),
      {
        agentRunTimeoutMs: 60_000,
        maxOutputTokens: 1_024,
        model: 'anthropic/claude-opus-4.8',
        reasoningEffort: 'high',
        temperature: 1,
      },
    )
    const repairBody = buildOpenRouterChatCompletionsRequestBody(
      createAgentRequest('repair'),
      {
        agentRunTimeoutMs: 60_000,
        maxOutputTokens: 1_024,
        model: 'anthropic/claude-opus-4.8',
        reasoningEffort: 'high',
        temperature: 1,
      },
    )

    expect(createBody.response_format).toEqual({
      type: 'json_object',
    })
    expect(createBody.reasoning).toEqual({
      effort: 'high',
      exclude: true,
    })
    expect(repairBody.response_format).toMatchObject({
      json_schema: {
        name: 'manifest3d_tool_call',
        strict: true,
      },
      type: 'json_schema',
    })
  })

  it('uses JSON-object mode for general OpenRouter models', () => {
    const createBody = buildOpenRouterChatCompletionsRequestBody(
      createAgentRequest('create'),
      {
        agentRunTimeoutMs: 60_000,
        maxOutputTokens: 1_024,
        model: 'deepseek/deepseek-v4',
        reasoningEffort: 'high',
        temperature: 1,
      },
    )
    const repairBody = buildOpenRouterChatCompletionsRequestBody(
      createAgentRequest('repair'),
      {
        agentRunTimeoutMs: 60_000,
        maxOutputTokens: 1_024,
        model: 'deepseek/deepseek-v4',
        reasoningEffort: 'high',
        temperature: 1,
      },
    )

    expect(createBody.response_format).toEqual({
      type: 'json_object',
    })
    expect(createBody.reasoning).toEqual({
      exclude: true,
      max_tokens: 256,
    })
    expect(repairBody.response_format).toEqual({
      type: 'json_object',
    })
  })

  it('uses strict schema mode for Moonshot Kimi models', () => {
    const createBody = buildOpenRouterChatCompletionsRequestBody(
      createAgentRequest('create'),
      {
        agentRunTimeoutMs: 60_000,
        maxOutputTokens: 1_024,
        model: 'moonshotai/kimi-k2.6',
        reasoningEffort: 'high',
        temperature: 1,
      },
    )

    expect(createBody.response_format).toMatchObject({
      json_schema: {
        name: 'manifest3d_asset',
        strict: true,
      },
      type: 'json_schema',
    })
    expect(createBody.reasoning).toEqual({
      exclude: true,
      max_tokens: 256,
    })
  })

  it('disables reasoning for MiniMax because it can return null content otherwise', () => {
    const body = buildOpenRouterChatCompletionsRequestBody(
      createAgentRequest('create'),
      {
        agentRunTimeoutMs: 60_000,
        maxOutputTokens: 1_024,
        model: 'minimax/minimax-m3',
        reasoningEffort: 'high',
        temperature: 1,
      },
    )

    expect(body.response_format).toEqual({
      type: 'json_object',
    })
    expect(body.reasoning).toEqual({
      enabled: false,
      exclude: true,
    })
  })

  it('enables Anthropic top-level prompt caching for strict vendor routing', () => {
    const body = buildOpenRouterChatCompletionsRequestBody(
      createAgentRequest('create'),
      {
        agentRunTimeoutMs: 60_000,
        maxOutputTokens: 1_024,
        model: 'anthropic/claude-opus-4.8',
        reasoningEffort: 'high',
        temperature: 1,
      },
    )

    expect(body.cache_control).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    })
    expect(body.messages[0]).toEqual({
      content: 'System instructions.',
      role: 'system',
    })
  })

  it('serializes accumulated stateless replay as an OpenRouter chat prefix', () => {
    const body = buildOpenRouterChatCompletionsRequestBody({
      ...createAgentRequest('repair'),
      conversationMessages: [
        {
          content: 'Create a small asset.',
          imageAttachments: [
            {
              id: 'ref-1',
              imageUrl: 'data:image/png;base64,ref',
              mediaType: 'image/png',
            },
          ],
          role: 'user',
        },
        {
          content: '{"schemaVersion":2,"id":"asset"}',
          role: 'assistant',
        },
        {
          content: 'Repair the current candidate.',
          role: 'user',
        },
      ],
    })

    expect(body.messages).toEqual([
      {
        content: 'System instructions.',
        role: 'system',
      },
      {
        content: [
          {
            text: 'Create a small asset.',
            type: 'text',
          },
          {
            image_url: {
              detail: 'high',
              url: 'data:image/png;base64,ref',
            },
            type: 'image_url',
          },
        ],
        role: 'user',
      },
      {
        content: '{"schemaVersion":2,"id":"asset"}',
        role: 'assistant',
      },
      {
        content: [
          {
            text: 'Repair the current candidate.',
            type: 'text',
          },
        ],
        role: 'user',
      },
    ])
  })

  it('marks the latest user message as the moving cache breakpoint for explicit-cache OpenRouter models', () => {
    const body = buildOpenRouterChatCompletionsRequestBody(
      {
        ...createAgentRequest('repair'),
        conversationMessages: [
          {
            content: 'Create a small asset.',
            role: 'user',
          },
          {
            content: '{"schemaVersion":2,"id":"asset"}',
            role: 'assistant',
          },
          {
            content: 'Repair the current candidate.',
            role: 'user',
          },
        ],
      },
      {
        agentRunTimeoutMs: 60_000,
        maxOutputTokens: 1_024,
        model: 'qwen/qwen3-coder-plus',
        reasoningEffort: 'high',
        temperature: 1,
      },
    )

    expect(body.messages.at(-1)).toMatchObject({
      content: [
        {
          cache_control: {
            type: 'ephemeral',
          },
          text: 'Repair the current candidate.',
          type: 'text',
        },
      ],
      role: 'user',
    })
  })

  it('normalizes Manifest3D schemas for OpenRouter provider compatibility', () => {
    const createBody = buildOpenRouterChatCompletionsRequestBody(
      createAgentRequest('create'),
    )
    const repairBody = buildOpenRouterChatCompletionsRequestBody(
      createAgentRequest('repair'),
    )
    const createResponseFormat = createBody.response_format
    const repairResponseFormat = repairBody.response_format
    const createJsonSchema = createResponseFormat.json_schema
    const repairJsonSchema = repairResponseFormat.json_schema

    if (!createJsonSchema || !repairJsonSchema) {
      throw new Error('Expected OpenRouter schema response formats.')
    }

    expect(
      collectUnsupportedOpenRouterSchemaProperties(
        createJsonSchema.schema,
      ),
    ).toEqual([])
    expect(
      collectUnsupportedOpenRouterSchemaProperties(
        repairJsonSchema.schema,
      ),
    ).toEqual([])
  })

  it('posts to the OpenRouter chat endpoint and parses schema JSON', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input
      void init

      return createJsonResponse({
        choices: [
          {
            message: {
              content: '{"schemaVersion":2,"id":"smoke"}',
            },
          },
        ],
        id: 'chatcmpl_test',
      })
    })
    const client = createOpenRouterManifestClient({
      apiKey: 'or-test-key',
      fetcher,
    })

    const response = await client.generateAsset(createAgentRequest('create'))

    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0]?.[0]).toBe(openRouterChatCompletionsEndpoint)

    const requestInit = fetcher.mock.calls[0]?.[1]
    const requestBody =
      typeof requestInit?.body === 'string'
        ? (JSON.parse(requestInit.body) as Record<string, unknown>)
        : null

    expect(requestInit).toMatchObject({
      headers: {
        Authorization: 'Bearer or-test-key',
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://manifest3d.scottsun.io',
        'X-OpenRouter-Title': 'Manifest3D',
      },
      method: 'POST',
    })
    expect(requestBody).toMatchObject({
      max_tokens: 64_000,
      model: 'openai/gpt-5.5',
      provider: {
        require_parameters: true,
      },
      reasoning: {
        exclude: true,
        effort: 'high',
      },
      response_format: {
        json_schema: {
          name: 'manifest3d_asset',
          strict: true,
        },
        type: 'json_schema',
      },
    })
    expect(requestBody?.provider).not.toHaveProperty('sort')
    expect(response).toEqual({
      candidate: {
        id: 'smoke',
        schemaVersion: 2,
      },
      rawText: '{"schemaVersion":2,"id":"smoke"}',
      responseId: 'chatcmpl_test',
      status: 'ok',
    })
  })

  it('reports missing OpenRouter chat content without OpenAI wording', async () => {
    const fetcher = vi.fn(async () =>
      createJsonResponse({
        choices: [
          {
            finish_reason: 'length',
            message: {
              content: null,
            },
            native_finish_reason: 'max_tokens',
          },
        ],
        id: 'chatcmpl_empty',
      }),
    )
    const client = createOpenRouterManifestClient({
      apiKey: 'or-test-key',
      fetcher,
    })

    const response = await client.generateAsset(createAgentRequest('create'))

    expect(response).toEqual({
      message:
        'The OpenRouter response did not contain assistant message content (finish_reason=length, native_finish_reason=max_tokens, message.content=null).',
      responseId: 'chatcmpl_empty',
      status: 'error',
    })
  })

  it('passes recoverable invalid chat JSON to the harness as raw candidate text', async () => {
    const fetcher = vi.fn(async () =>
      createJsonResponse({
        choices: [
          {
            finish_reason: 'length',
            message: {
              content: '{"schemaVersion":2,"id":"truncated',
            },
            native_finish_reason: 'length',
          },
        ],
        id: 'chatcmpl_invalid',
      }),
    )
    const client = createOpenRouterManifestClient({
      apiKey: 'or-test-key',
      fetcher,
    })

    const response = await client.generateAsset(createAgentRequest('create'))

    expect(response).toEqual({
      candidate: {
        argumentsJson: '{"schemaVersion":2,"id":"truncated',
        tool: 'submit_manifest_asset',
      },
      rawText: '{"schemaVersion":2,"id":"truncated',
      responseId: 'chatcmpl_invalid',
      status: 'ok',
    })
  })

  it('parses JSON candidates wrapped in Markdown fences', async () => {
    const fetcher = vi.fn(async () =>
      createJsonResponse({
        choices: [
          {
            message: {
              content: '```json\n{"schemaVersion":2,"id":"fenced"}\n```',
            },
          },
        ],
        id: 'chatcmpl_fenced',
      }),
    )
    const client = createOpenRouterManifestClient({
      apiKey: 'or-test-key',
      fetcher,
    })

    const response = await client.generateAsset(createAgentRequest('create'))

    expect(response).toEqual({
      candidate: {
        id: 'fenced',
        schemaVersion: 2,
      },
      rawText: '```json\n{"schemaVersion":2,"id":"fenced"}\n```',
      responseId: 'chatcmpl_fenced',
      status: 'ok',
    })
  })

  it('parses the first balanced JSON object in prose-wrapped responses', async () => {
    const fetcher = vi.fn(async () =>
      createJsonResponse({
        choices: [
          {
            message: {
              content:
                'Here is the asset:\n{"schemaVersion":2,"id":"wrapped"}\nDone.',
            },
          },
        ],
        id: 'chatcmpl_wrapped',
      }),
    )
    const client = createOpenRouterManifestClient({
      apiKey: 'or-test-key',
      fetcher,
    })

    const response = await client.generateAsset(createAgentRequest('create'))

    expect(response).toEqual({
      candidate: {
        id: 'wrapped',
        schemaVersion: 2,
      },
      rawText:
        'Here is the asset:\n{"schemaVersion":2,"id":"wrapped"}\nDone.',
      responseId: 'chatcmpl_wrapped',
      status: 'ok',
    })
  })

  it('keeps legacy Responses-shaped parsing usable for captured diagnostics', async () => {
    const fetcher = vi.fn(async () =>
      createJsonResponse({
        id: 'resp_legacy',
        output: [
          {
            content: [
              {
                text: '{"ok":true}',
                type: 'output_text',
              },
            ],
            role: 'assistant',
            type: 'message',
          },
        ],
        status: 'completed',
      }),
    )
    const client = createOpenRouterManifestClient({
      apiKey: 'or-test-key',
      fetcher,
    })

    const response = await client.generateAsset(createAgentRequest('create'))

    expect(response).toEqual({
      candidate: {
        ok: true,
      },
      rawText: '{"ok":true}',
      responseId: 'resp_legacy',
      status: 'ok',
    })
  })

  it('brands malformed legacy Responses-shaped fallback errors as OpenRouter', async () => {
    const fetcher = vi.fn(async () =>
      createJsonResponse({
        id: 'resp_legacy_empty',
        output: [],
        status: 'completed',
      }),
    )
    const client = createOpenRouterManifestClient({
      apiKey: 'or-test-key',
      fetcher,
    })

    const response = await client.generateAsset(createAgentRequest('repair'))

    expect(response).toEqual({
      message: 'The OpenRouter response did not contain output_text content.',
      responseId: 'resp_legacy_empty',
      status: 'error',
    })
    if (response.status !== 'error') {
      throw new Error('Expected OpenRouter fallback response to fail.')
    }
    expect(response.message).not.toContain('OpenAI')
  })



  it('reports empty successful OpenRouter bodies as transport/context-like failures', async () => {
    const fetcher = vi.fn(async () =>
      new Response('', {
        headers: {
          'Content-Type': 'application/json',
        },
        status: 200,
      }),
    )
    const client = createOpenRouterManifestClient({
      apiKey: 'or-test-key',
      fetcher,
    })

    const response = await client.generateAsset(createAgentRequest('repair'))

    expect(response).toEqual({
      message:
        'OpenRouter returned an empty successful response body. This can happen when an upstream provider terminates a very large request or response; retry with a smaller prompt/candidate context.',
      responseId: null,
      status: 'error',
    })
  })

  it('reports unexpected successful OpenRouter payloads without OpenAI wording', async () => {
    const fetcher = vi.fn(async () =>
      createJsonResponse({
        id: 'or_unexpected_shape',
        object: 'not_chat_completion',
      }),
    )
    const client = createOpenRouterManifestClient({
      apiKey: 'or-test-key',
      fetcher,
    })

    const response = await client.generateAsset(createAgentRequest('repair'))

    expect(response).toEqual({
      message:
        'The OpenRouter response did not match the expected chat completion shape (object=not_chat_completion).',
      responseId: 'or_unexpected_shape',
      status: 'error',
    })
    if (response.status !== 'error') {
      throw new Error('Expected OpenRouter unexpected response to fail.')
    }
    expect(response.message).not.toContain('OpenAI')
  })

  it('reports missing OpenRouter keys without sending a request', async () => {
    const fetcher = vi.fn()
    const client = createOpenRouterManifestClient({ fetcher })

    const response = await client.generateAsset(createAgentRequest('create'))

    expect(fetcher).not.toHaveBeenCalled()
    expect(response).toEqual({
      message:
        'Generation is unavailable because no OpenRouter API key is loaded.',
      reason: 'missing_api_key',
      status: 'unavailable',
    })
  })

  it('retries transient response body failures once by default', async () => {
    const fetcher = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => {
          throw new TypeError('terminated')
        },
      } as unknown as Response)
      .mockResolvedValueOnce(
        createJsonResponse({
          id: 'resp_body_retry',
          output_text: '{"ok":true}',
          status: 'completed',
        }),
      )
    const client = createOpenRouterManifestClient({
      apiKey: 'or-test-key',
      fetcher,
      retryDelayMs: 0,
    })

    const response = await client.generateAsset(createAgentRequest('create'))

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(response).toEqual({
      candidate: {
        ok: true,
      },
      rawText: '{"ok":true}',
      responseId: 'resp_body_retry',
      status: 'ok',
    })
  })

  it('normalizes model-id HTTP errors with the OpenRouter provider label', async () => {
    const fetcher = vi.fn(async () =>
      createJsonResponse(
        {
          error: {
            message: 'model not found',
          },
        },
        { status: 404 },
      ),
    )
    const client = createOpenRouterManifestClient({
      apiKey: 'or-test-key',
      fetcher,
    })

    const response = await client.generateAsset(createAgentRequest('create'))

    expect(response).toEqual({
      message:
        'OpenRouter could not use model "openai/gpt-5.5". Check the Model ID in Providers and try again.',
      responseId: null,
      status: 'error',
      statusCode: 404,
    })
  })

  it('includes raw provider HTTP error details when OpenRouter forwards them', async () => {
    const fetcher = vi.fn(async () =>
      createJsonResponse(
        {
          error: {
            message: 'Provider returned error',
            metadata: {
              raw: JSON.stringify({
                error: {
                  message:
                    "output_config.format.schema: For 'array' type, 'minItems' values other than 0 or 1 are not supported",
                },
              }),
            },
          },
        },
        { status: 400 },
      ),
    )
    const client = createOpenRouterManifestClient({
      apiKey: 'or-test-key',
      fetcher,
    })

    const response = await client.generateAsset(createAgentRequest('create'))

    expect(response).toEqual({
      message:
        "Provider returned error: output_config.format.schema: For 'array' type, 'minItems' values other than 0 or 1 are not supported",
      responseId: null,
      status: 'error',
      statusCode: 400,
    })
  })
})

function createAgentRequest(
  mode: AgentRequest['prompt']['metadata']['mode'],
): AgentRequest {
  return {
    prompt: {
      metadata: {
        imageAttachmentCount: 0,
        mode,
        selectedAssetId: null,
      },
      system: 'System instructions.',
      user: 'Create a small asset.',
    },
  }
}

function collectUnsupportedOpenRouterSchemaProperties(
  value: unknown,
  path = '$',
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectUnsupportedOpenRouterSchemaProperties(item, `${path}[${index}]`),
    )
  }

  if (!isRecord(value)) {
    return []
  }

  return Object.entries(value).flatMap(([key, childValue]) => {
    const childPath = `${path}.${key}`

    if (
      key === 'minItems' &&
      typeof childValue === 'number' &&
      childValue > 1
    ) {
      return [childPath]
    }

    if (
      key === 'exclusiveMaximum' ||
      key === 'exclusiveMinimum' ||
      key === 'maximum' ||
      key === 'maxItems' ||
      key === 'minimum'
    ) {
      return [childPath]
    }

    return collectUnsupportedOpenRouterSchemaProperties(childValue, childPath)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function createJsonResponse(
  payload: unknown,
  init: ResponseInit = { status: 200 },
) {
  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
    },
    ...init,
  })
}
