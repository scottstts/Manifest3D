import { describe, expect, it, vi } from 'vitest'
import { createValidValidationFixtureAsset } from '../../../testing/validationFixtureAsset'
import { geminiModelConfig } from '../../../config/modelConfig'
import type { ManifestScene } from '../../../schema/manifestTypes'
import { compileManifestPrompt } from '../../prompt/promptCompiler'
import {
  buildGeminiCachedContentRequestBody,
  buildGeminiGenerateContentRequestBody,
  buildGeminiResponseJsonSchema,
  createGeminiManifestClient,
  parseGeminiManifestResponse,
} from './geminiManifestClient'

const emptyScene: ManifestScene = {
  assets: [],
  schemaVersion: 1,
  units: 'meters',
}

describe('Gemini cachedContent request builders', () => {
  it('builds Gemini cachedContent requests with stable prompt and media payloads', () => {
    const prompt = compileManifestPrompt({
      contextScope: 'stable_cache',
      mode: 'create',
      scene: emptyScene,
      userPrompt: 'Create a reference-based desk lamp.',
    })

    const body = buildGeminiCachedContentRequestBody({
      cacheKey: 'cache-key-1',
      sourceMediaIds: ['ref-lamp'],
      stableImageAttachments: [
        {
          id: 'ref-lamp',
          imageUrl: 'data:image/png;base64,abc123',
          mediaType: 'image/png',
          name: 'lamp reference',
        },
      ],
      stablePrompt: prompt,
    })

    expect(body).toMatchObject({
      displayName: 'manifest3d-cache-key-1',
      model: 'models/gemini-flash-latest',
      ttl: '3600s',
    })
    expect(body.systemInstruction.parts[0]).toEqual({ text: prompt.system })
    expect(body.contents[0].parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('Create a reference-based desk lamp.'),
        }),
        expect.objectContaining({
          inline_data: {
            data: 'abc123',
            mime_type: 'image/png',
          },
        }),
      ]),
    )
  })

  it('builds generateContent requests that reference cachedContent without resending the system prompt', () => {
    const prompt = compileManifestPrompt({
      contextScope: 'cached_delta',
      mode: 'repair',
      scene: emptyScene,
      userPrompt: 'Repair the candidate.',
      validationFeedback: 'Geometry is too small.',
    })

    const body = buildGeminiGenerateContentRequestBody(
      {
        prompt,
      },
      geminiModelConfig,
      {
        cachedContentName: 'cachedContents/cache-123',
      },
    )

    expect(body.cachedContent).toBe('cachedContents/cache-123')
    expect(body).not.toHaveProperty('systemInstruction')
    expect(body.contents[0].parts).toEqual([
      {
        text: expect.stringContaining('Geometry is too small.'),
      },
    ])
    expect(body.generationConfig).toMatchObject({
      maxOutputTokens: 64_000,
      responseMimeType: 'application/json',
      temperature: 1,
      thinkingConfig: {
        thinkingLevel: 'high',
      },
    })
    expect(body.generationConfig.responseJsonSchema).toMatchObject({
      properties: {
        operations: {
          type: 'array',
        },
      },
    })
  })

  it('uses a compact shared tool-call schema for Gemini requests', () => {
    const repairSchema = buildGeminiResponseJsonSchema('repair')
    const schemaJson = JSON.stringify(repairSchema)

    expect(repairSchema).toMatchObject({
      properties: {
        operations: {
          items: {
            properties: {
              valueJson: {
                type: 'string',
              },
            },
          },
          type: 'array',
        },
        tool: {
          enum: ['apply_manifest_patch'],
          type: 'string',
        },
      },
      required: ['tool', 'operations'],
      type: 'object',
    })
    expect(schemaJson).toContain('valueJson')
    expect(schemaJson).not.toContain('schemaVersion')
    expect(schemaJson.length).toBeLessThan(2_000)
  })

  it('normalizes the response schema to Gemini documented JSON Schema keys', () => {
    const schemaJson = JSON.stringify(buildGeminiResponseJsonSchema())

    expect(schemaJson).not.toContain('exclusiveMinimum')
    expect(schemaJson).toContain('additionalProperties')
  })

  it('keeps direct generateContent requests on the shared tool schema', () => {
    const prompt = compileManifestPrompt({
      candidateJson: createValidValidationFixtureAsset(),
      mode: 'repair',
      scene: emptyScene,
      userPrompt: 'Repair the candidate.',
      validationFeedback: 'Geometry is too small.',
    })

    const body = buildGeminiGenerateContentRequestBody({ prompt })
    const textPart = body.contents[0].parts[0]

    expect(textPart).toMatchObject({
      text: expect.not.stringContaining('<gemini_repair_transport>'),
    })
    expect(body.generationConfig.responseJsonSchema).toMatchObject({
      properties: {
        operations: {
          type: 'array',
        },
      },
    })
  })
})

describe('createGeminiManifestClient', () => {
  it('returns a controlled unavailable response when the API key is missing', async () => {
    const prompt = compileManifestPrompt({
      mode: 'create',
      scene: emptyScene,
      userPrompt: 'Create a small box.',
    })
    const fetcher = vi.fn()
    const client = createGeminiManifestClient({
      apiKey: '',
      fetcher,
    })

    const result = await client.generateAsset({ prompt })

    expect(result).toMatchObject({
      reason: 'missing_api_key',
      status: 'unavailable',
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('creates Gemini cachedContent before generateContent and persists the cache handle', async () => {
    const stablePrompt = compileManifestPrompt({
      contextScope: 'stable_cache',
      imageAttachments: [
        {
          id: 'ref-lamp',
          mediaType: 'image/png',
          name: 'lamp reference',
        },
      ],
      mode: 'create',
      scene: emptyScene,
      userPrompt: 'Create a reference-based desk lamp.',
    })
    const prompt = compileManifestPrompt({
      contextScope: 'cached_delta',
      mode: 'create',
      scene: emptyScene,
      userPrompt: 'Create a reference-based desk lamp.',
    })
    const candidate = createValidValidationFixtureAsset()
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            expireTime: '2026-06-12T13:00:00Z',
            name: 'cachedContents/cache-123',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify(candidate),
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
            responseId: 'gemini-response-123',
          }),
          { status: 200 },
        ),
      )
    const client = createGeminiManifestClient({
      apiKey: 'gemini-test',
      cacheEndpoint: 'https://example.test/v1beta/cachedContents',
      endpoint: 'https://example.test/v1beta',
      fetcher,
    })

    const result = await client.generateAsset({
      prompt,
      providerState: {
        geminiCachedContent: {
          cacheKey: 'cache-key-1',
          sourceMediaIds: ['ref-lamp'],
          stableImageAttachments: [
            {
              id: 'ref-lamp',
              imageUrl: 'data:image/png;base64,abc123',
              mediaType: 'image/png',
              name: 'lamp reference',
            },
          ],
          stablePrompt,
        },
      },
    })

    expect(result.status).toBe('ok')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://example.test/v1beta/cachedContents',
    )
    expect(readRequestBody(fetcher.mock.calls[0][1])).toMatchObject({
      contents: [
        {
          parts: expect.arrayContaining([
            expect.objectContaining({
              text: expect.stringContaining('Create a reference-based desk lamp.'),
            }),
            expect.objectContaining({
              inline_data: {
                data: 'abc123',
                mime_type: 'image/png',
              },
            }),
          ]),
        },
      ],
      model: 'models/gemini-flash-latest',
      ttl: '3600s',
    })
    expect(fetcher.mock.calls[1][0]).toBe(
      'https://example.test/v1beta/models/gemini-flash-latest:generateContent',
    )
    expect(readRequestBody(fetcher.mock.calls[1][1])).toMatchObject({
      cachedContent: 'cachedContents/cache-123',
    })
    expect(result).toMatchObject({
      providerState: {
        geminiCachedContent: {
          cacheExpiresAt: '2026-06-12T13:00:00Z',
          cachedContentName: 'cachedContents/cache-123',
          cacheKey: 'cache-key-1',
          modelId: 'gemini-flash-latest',
          provider: 'gemini',
          sourceMediaIds: ['ref-lamp'],
        },
      },
    })
  })

  it('normalizes invalid Gemini model errors', async () => {
    const prompt = compileManifestPrompt({
      mode: 'create',
      scene: emptyScene,
      userPrompt: 'Create a small box.',
    })
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            message:
              'models/gemini-missing is not found for API version v1beta, or is not supported for generateContent.',
          },
        }),
        { status: 404, statusText: 'not found' },
      ),
    )
    const client = createGeminiManifestClient({
      apiKey: 'gemini-test',
      fetcher,
      model: {
        ...geminiModelConfig,
        model: 'gemini-missing',
      },
    })

    const result = await client.generateAsset({ prompt })

    expect(result).toMatchObject({
      message:
        'Gemini could not use model "gemini-missing". Check the Model ID in Providers and try again.',
      status: 'error',
      statusCode: 404,
    })
  })
})

describe('parseGeminiManifestResponse', () => {
  it('parses JSON candidates from Gemini response parts', () => {
    const candidate = createValidValidationFixtureAsset()
    const result = parseGeminiManifestResponse({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify(candidate),
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      responseId: 'gemini-response-123',
    })

    expect(result.status).toBe('ok')

    if (result.status === 'ok') {
      expect(result.responseId).toBe('gemini-response-123')
      expect(result.candidate).toMatchObject({
        id: 'validation-crate',
        schemaVersion: 2,
      })
    }
  })

  it('parses JSON candidates from Gemini output arrays', () => {
    const result = parseGeminiManifestResponse({
      id: 'interaction-123',
      outputs: [
        {
          text: JSON.stringify({
            argumentsJson: JSON.stringify({
              operations: [
                {
                  op: 'replace',
                  path: '/transform/position',
                  valueJson: '[0,1,0]',
                },
              ],
            }),
            tool: 'apply_manifest_patch',
          }),
          type: 'text',
        },
      ],
      status: 'completed',
    })

    expect(result.status).toBe('ok')

    if (result.status === 'ok') {
      expect(result.responseId).toBe('interaction-123')
      expect(result.candidate).toMatchObject({
        tool: 'apply_manifest_patch',
      })
    }
  })
  it('reports malformed output as a parse error without throwing', () => {
    const result = parseGeminiManifestResponse({
      candidates: [
        {
          content: {
            parts: [
              {
                text: '{"schemaVersion":2',
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      responseId: 'gemini-response-bad',
    })

    expect(result).toMatchObject({
      responseId: 'gemini-response-bad',
      status: 'error',
    })
  })
})

function readRequestBody(init: RequestInit | undefined) {
  if (typeof init?.body !== 'string') {
    throw new Error('Expected request body to be a JSON string.')
  }

  return JSON.parse(init.body) as unknown
}
