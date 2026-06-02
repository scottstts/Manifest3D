import { describe, expect, it, vi } from 'vitest'
import { createValidValidationFixtureAsset } from '../testing/validationFixtureAsset'
import { geminiModelConfig } from '../config/modelConfig'
import type { ManifestScene } from '../schema/manifestTypes'
import { compileManifestPrompt } from './promptCompiler'
import {
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

describe('buildGeminiGenerateContentRequestBody', () => {
  it('builds Gemini structured-output requests with image payloads', () => {
    const prompt = compileManifestPrompt({
      mode: 'create',
      scene: emptyScene,
      userPrompt: 'Create a reference-based desk lamp.',
    })

    const body = buildGeminiGenerateContentRequestBody({
      imageAttachments: [
        {
          id: 'ref-lamp',
          imageUrl: 'data:image/png;base64,abc123',
          mediaType: 'image/png',
          name: 'lamp reference',
        },
      ],
      prompt,
    })

    expect(body.generationConfig).toMatchObject({
      maxOutputTokens: 64_000,
      responseMimeType: 'application/json',
      temperature: 1,
      thinkingConfig: {
        thinkingLevel: 'high',
      },
    })
    expect(body.generationConfig.responseJsonSchema).toMatchObject({
      type: 'object',
    })
    expect(body.systemInstruction.parts[0].text).toBe(prompt.system)
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

  it('uses a compact transport schema for Gemini repair requests', () => {
    const repairSchema = buildGeminiResponseJsonSchema('repair')
    const schemaJson = JSON.stringify(repairSchema)

    expect(repairSchema).toMatchObject({
      properties: {
        patch: {
          items: {
            properties: {
              op: {
                enum: ['add', 'replace', 'remove'],
                type: 'string',
              },
              path: {
                type: 'string',
              },
              valueJson: {
                type: 'string',
              },
            },
            required: ['op', 'path'],
            type: 'object',
          },
          minItems: 1,
          type: 'array',
        },
      },
      required: ['patch'],
      type: 'object',
    })
    expect(schemaJson).not.toContain('anyOf')
    expect(schemaJson).not.toContain('schemaVersion')
    expect(schemaJson.length).toBeLessThan(1_500)
  })
  it('normalizes the response schema to Gemini documented JSON Schema keys', () => {
    const schemaJson = JSON.stringify(buildGeminiResponseJsonSchema())

    expect(schemaJson).not.toContain('exclusiveMinimum')
    expect(schemaJson).toContain('"minimum":0')
  })

  it('adds Gemini-only repair transport instructions without changing the shared prompt contract', () => {
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
      text: expect.stringContaining('<gemini_repair_transport>'),
    })
    expect(textPart).toMatchObject({
      text: expect.stringContaining('valueJson'),
    })
    expect(body.generationConfig.responseJsonSchema).toMatchObject({
      properties: {
        patch: {
          items: {
            properties: {
              valueJson: {
                type: 'string',
              },
            },
          },
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

  it('converts Gemini repair valueJson transport back into canonical JSON Patch', () => {
    const result = parseGeminiManifestResponse(
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    patch: [
                      {
                        op: 'replace',
                        path: '/transform/position',
                        valueJson: '[0,1,0]',
                      },
                      {
                        op: 'add',
                        path: '/tags/0',
                        valueJson: '"hero"',
                      },
                      {
                        op: 'remove',
                        path: '/checks/0',
                      },
                    ],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        responseId: 'gemini-repair-123',
      },
      'repair',
    )

    expect(result.status).toBe('ok')

    if (result.status === 'ok') {
      expect(result.candidate).toEqual({
        patch: [
          {
            op: 'replace',
            path: '/transform/position',
            value: [0, 1, 0],
          },
          {
            op: 'add',
            path: '/tags/0',
            value: 'hero',
          },
          {
            op: 'remove',
            path: '/checks/0',
          },
        ],
      })
    }
  })

  it('accepts legacy canonical patch values from Gemini repair responses', () => {
    const result = parseGeminiManifestResponse(
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    patch: [
                      {
                        op: 'replace',
                        path: '/transform/position',
                        value: [0, 1, 0],
                      },
                    ],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        responseId: 'gemini-repair-legacy',
      },
      'repair',
    )

    expect(result.status).toBe('ok')

    if (result.status === 'ok') {
      expect(result.candidate).toEqual({
        patch: [
          {
            op: 'replace',
            path: '/transform/position',
            value: [0, 1, 0],
          },
        ],
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
