import { describe, expect, it, vi } from 'vitest'
import type { AgentRequest } from './providerClient'
import {
  buildOpenRouterResponsesRequestBody,
  createOpenRouterManifestClient,
  openRouterResponsesEndpoint,
} from './openRouterManifestClient'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

describe('openRouterManifestClient', () => {
  it('builds an OpenRouter Responses request from the shared app path', () => {
    const body = buildOpenRouterResponsesRequestBody({
      ...createAgentRequest('create'),
      previousResponseId: 'resp_previous_should_not_chain',
      sessionId: 'openrouter-run:session:1',
    })

    expect(body).toMatchObject({
      background: false,
      max_output_tokens: 64_000,
      model: 'openai/gpt-5.5',
      reasoning: {
        effort: 'high',
      },
      session_id: 'openrouter-run:session:1',
      store: false,
      temperature: 1,
      text: {
        format: {
          name: 'manifest3d_tool_call',
          strict: true,
          type: 'json_schema',
        },
      },
    })
    expect(body).not.toHaveProperty('previous_response_id')
    expect(body.input[0]?.content[0]).toEqual({
      text: 'Create a small asset.',
      type: 'input_text',
    })
  })

  it('posts to the OpenRouter Responses endpoint and parses output_text JSON', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input
      void init

      return createJsonResponse({
        id: 'resp_test',
        output: [
          {
            content: [
              {
                text: '{"schemaVersion":2,"id":"smoke"}',
                type: 'output_text',
              },
            ],
            role: 'assistant',
            type: 'message',
          },
        ],
        status: 'completed',
      })
    })
    const client = createOpenRouterManifestClient({
      apiKey: 'or-test-key',
      fetcher,
    })

    const response = await client.generateAsset(createAgentRequest('create'))

    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0]?.[0]).toBe(openRouterResponsesEndpoint)

    const requestInit = fetcher.mock.calls[0]?.[1]
    const requestBody =
      typeof requestInit?.body === 'string'
        ? (JSON.parse(requestInit.body) as Record<string, unknown>)
        : null

    expect(requestInit).toMatchObject({
      headers: {
        Authorization: 'Bearer or-test-key',
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
    expect(requestBody).toMatchObject({
      background: false,
      model: 'openai/gpt-5.5',
      reasoning: {
        effort: 'high',
      },
      store: false,
    })
    expect(response).toEqual({
      candidate: {
        id: 'smoke',
        schemaVersion: 2,
      },
      rawText: '{"schemaVersion":2,"id":"smoke"}',
      responseId: 'resp_test',
      status: 'ok',
    })
  })

  it('falls back to chat-completion text if OpenRouter returns that shape', async () => {
    const fetcher = vi.fn(async () =>
      createJsonResponse({
        choices: [
          {
            message: {
              content: '{"ok":true}',
            },
          },
        ],
        id: 'chatcmpl_test',
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
      responseId: 'chatcmpl_test',
      status: 'ok',
    })
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
