import { describe, expect, it, vi } from 'vitest'
import type { AgentRequest } from '../../src/engine/agent/providerClient'
import {
  buildOpenRouterHeadlessResponsesRequestBody,
  buildOpenRouterHeadlessSmokeRequestBody,
  createOpenRouterHeadlessManifestClient,
  openRouterHeadlessModelConfig,
  openRouterHeadlessResponsesEndpoint,
  runOpenRouterHeadlessSmokeRequest,
} from './openRouterHeadlessClient'

describe('openRouterHeadlessClient', () => {
  it('builds an OpenRouter Responses request that mirrors the OpenAI manifest path', () => {
    const body = buildOpenRouterHeadlessResponsesRequestBody(
      createAgentRequest('create'),
    )

    expect(body).toMatchObject({
      background: false,
      max_output_tokens: openRouterHeadlessModelConfig.maxOutputTokens,
      model: 'openai/gpt-5.5',
      reasoning: {
        effort: 'high',
      },
      store: false,
      temperature: openRouterHeadlessModelConfig.temperature,
      text: {
        format: {
          strict: true,
          type: 'json_schema',
        },
      },
    })
    expect(body.input[0]?.content[0]).toEqual({
      text: 'Create a small asset.',
      type: 'input_text',
    })
  })

  it('posts to the OpenRouter Responses endpoint and parses output_text JSON', async () => {
    const fetcher = vi.fn(async () =>
      createJsonResponse({
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
      }),
    )
    const client = createOpenRouterHeadlessManifestClient({
      apiKey: 'or-test-key',
      fetcher,
    })

    const response = await client.generateAsset(createAgentRequest('create'))

    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0]?.[0]).toBe(openRouterHeadlessResponsesEndpoint)

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
    const client = createOpenRouterHeadlessManifestClient({
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
    const client = createOpenRouterHeadlessManifestClient({ fetcher })

    const response = await client.generateAsset(createAgentRequest('create'))

    expect(fetcher).not.toHaveBeenCalled()
    expect(response).toEqual({
      message:
        'Generation is unavailable because no OpenRouter API key is loaded.',
      reason: 'missing_api_key',
      status: 'unavailable',
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
    const client = createOpenRouterHeadlessManifestClient({
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

  it('builds and sends a small structured smoke request', async () => {
    const smokeBody = buildOpenRouterHeadlessSmokeRequestBody({
      label: 'client-only',
      prompt: 'Return ok true.',
    })

    expect(smokeBody).toMatchObject({
      background: false,
      max_output_tokens: 200,
      model: 'openai/gpt-5.5',
      reasoning: {
        effort: 'high',
      },
      store: false,
      text: {
        format: {
          name: 'openrouter_headless_client_smoke',
          strict: true,
          type: 'json_schema',
        },
      },
      user: 'client-only',
    })

    const fetcher = vi.fn(async () =>
      createJsonResponse({
        id: 'resp_smoke',
        output_text: '{"ok":true,"label":"client-only"}',
        status: 'completed',
      }),
    )
    const response = await runOpenRouterHeadlessSmokeRequest({
      apiKey: 'or-test-key',
      fetcher,
      label: 'client-only',
      prompt: 'Return ok true.',
    })

    expect(fetcher).toHaveBeenCalledOnce()
    expect(response).toEqual({
      candidate: {
        label: 'client-only',
        ok: true,
      },
      rawText: '{"ok":true,"label":"client-only"}',
      responseId: 'resp_smoke',
      status: 'ok',
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
      system: 'You are a Manifest3D generator.',
      user: 'Create a small asset.',
    },
  }
}

function createJsonResponse(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
    status: init.status ?? 200,
    statusText: init.statusText,
  })
}
