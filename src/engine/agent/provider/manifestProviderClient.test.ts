import { describe, expect, it, vi } from 'vitest'
import type { ManifestScene } from '../../schema/manifestTypes'
import { compileManifestPrompt } from '../prompt/promptCompiler'
import { createManifestProviderClient } from './manifestProviderClient'

const emptyScene: ManifestScene = {
  assets: [],
  schemaVersion: 1,
  units: 'meters',
}

describe('createManifestProviderClient', () => {
  it('routes OpenAI provider requests to the OpenAI endpoint', async () => {
    const fetchInputs: Array<RequestInfo | URL> = []
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      fetchInputs.push(input)

      return new Response(
        JSON.stringify({
          output_text: '{"schemaVersion":2}',
        }),
        { status: 200 },
      )
    })
    const client = createManifestProviderClient({
      apiKey: 'sk-test',
      fetcher,
      provider: 'openai',
    })

    await client.generateAsset({
      prompt: compileManifestPrompt({
        mode: 'create',
        scene: emptyScene,
        userPrompt: 'Create a box.',
      }),
    })

    expect(String(fetchInputs[0])).toBe('https://api.openai.com/v1/responses')
  })

  it('passes custom OpenAI model settings into the request body', async () => {
    const bodies: unknown[] = []
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as unknown)

      return new Response(
        JSON.stringify({
          output_text: '{"schemaVersion":2}',
          status: 'completed',
        }),
        { status: 200 },
      )
    })
    const client = createManifestProviderClient({
      apiKey: 'sk-test',
      fetcher,
      modelSettings: {
        modelId: 'gpt-custom',
        reasoningEffort: 'low',
      },
      provider: 'openai',
    })

    await client.generateAsset({
      prompt: compileManifestPrompt({
        mode: 'create',
        scene: emptyScene,
        userPrompt: 'Create a box.',
      }),
    })

    expect(bodies[0]).toMatchObject({
      model: 'gpt-custom',
      reasoning: {
        effort: 'low',
      },
    })
  })

  it('routes Gemini provider requests to the Gemini endpoint', async () => {
    const fetchInputs: Array<RequestInfo | URL> = []
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      fetchInputs.push(input)

      return new Response(
        JSON.stringify({
          id: 'interaction-test',
          outputs: [
            {
              text: '{"schemaVersion":2}',
              type: 'text',
            },
          ],
          status: 'completed',
        }),
        { status: 200 },
      )
    })
    const client = createManifestProviderClient({
      apiKey: 'gemini-test',
      fetcher,
      provider: 'gemini',
    })

    await client.generateAsset({
      prompt: compileManifestPrompt({
        mode: 'create',
        scene: emptyScene,
        userPrompt: 'Create a box.',
      }),
    })

    expect(String(fetchInputs[0])).toContain(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
    )
  })

  it('passes custom Gemini model settings into the interaction request body', async () => {
    const fetchInputs: Array<RequestInfo | URL> = []
    const bodies: unknown[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchInputs.push(input)
      bodies.push(JSON.parse(String(init?.body)) as unknown)

      return new Response(
        JSON.stringify({
          id: 'interaction-test',
          outputs: [
            {
              text: '{"schemaVersion":2}',
              type: 'text',
            },
          ],
          status: 'completed',
        }),
        { status: 200 },
      )
    })
    const client = createManifestProviderClient({
      apiKey: 'gemini-test',
      fetcher,
      modelSettings: {
        modelId: 'gemini-custom',
        reasoningEffort: 'medium',
      },
      provider: 'gemini',
    })

    await client.generateAsset({
      prompt: compileManifestPrompt({
        mode: 'create',
        scene: emptyScene,
        userPrompt: 'Create a box.',
      }),
    })

    expect(String(fetchInputs[0])).toContain('/v1beta/interactions')
    expect(bodies[0]).toMatchObject({
      generation_config: {
        thinking_level: 'medium',
      },
      model: 'gemini-custom',
    })
  })

  it('routes OpenRouter provider requests to the OpenRouter endpoint', async () => {
    const fetchInputs: Array<RequestInfo | URL> = []
    const bodies: unknown[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchInputs.push(input)
      bodies.push(JSON.parse(String(init?.body)) as unknown)

      return new Response(
        JSON.stringify({
          output_text: '{"schemaVersion":2}',
          status: 'completed',
        }),
        { status: 200 },
      )
    })
    const client = createManifestProviderClient({
      apiKey: 'sk-or-test',
      fetcher,
      modelSettings: {
        modelId: 'openai/gpt-custom',
        reasoningEffort: 'custom-high',
      },
      provider: 'openrouter',
    })

    await client.generateAsset({
      prompt: compileManifestPrompt({
        mode: 'create',
        scene: emptyScene,
        userPrompt: 'Create a box.',
      }),
    })

    expect(String(fetchInputs[0])).toBe(
      'https://openrouter.ai/api/v1/chat/completions',
    )
    expect(bodies[0]).toMatchObject({
      model: 'openai/gpt-custom',
      provider: {
        require_parameters: true,
      },
      reasoning: {
        exclude: true,
        effort: 'custom-high',
      },
      response_format: {
        json_schema: {
          name: 'manifest3d_asset',
          strict: true,
        },
        type: 'json_schema',
      },
    })
  })
})
