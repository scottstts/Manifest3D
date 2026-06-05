import { describe, expect, it, vi } from 'vitest'
import { createValidValidationFixtureAsset } from '../testing/validationFixtureAsset'
import { geminiModelConfig } from '../config/modelConfig'
import type { ManifestScene } from '../schema/manifestTypes'
import { compileManifestPrompt } from './promptCompiler'
import {
  buildGeminiGenerateContentRequestBody,
  buildGeminiInteractionsRequestBody,
  buildGeminiResponseJsonSchema,
  createGeminiManifestClient,
  parseGeminiManifestResponse,
} from './geminiManifestClient'

const emptyScene: ManifestScene = {
  assets: [],
  schemaVersion: 1,
  units: 'meters',
}

describe('buildGeminiInteractionsRequestBody', () => {
  it('builds Gemini Interactions structured-output requests with image payloads', () => {
    const prompt = compileManifestPrompt({
      mode: 'create',
      scene: emptyScene,
      userPrompt: 'Create a reference-based desk lamp.',
    })

    const body = buildGeminiInteractionsRequestBody({
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

    expect(body.generation_config).toMatchObject({
      max_output_tokens: 64_000,
      temperature: 1,
      thinking_level: 'high',
    })
    expect(body.response_format).toMatchObject({
      type: 'object',
    })
    expect(body.system_instruction).toBe(prompt.system)
    expect(body.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('Create a reference-based desk lamp.'),
          type: 'text',
        }),
        expect.objectContaining({
          data: 'abc123',
          mime_type: 'image/png',
          type: 'image',
        }),
      ]),
    )
  })

  it('uses a compact shared tool-call schema for Gemini requests', () => {
    const repairSchema = buildGeminiResponseJsonSchema('repair')
    const schemaJson = JSON.stringify(repairSchema)

    expect(repairSchema).toMatchObject({
      properties: {
        argumentsJson: {
          type: 'string',
        },
        tool: {
          enum: ['submit_manifest_asset', 'apply_manifest_patch'],
          type: 'string',
        },
      },
      required: ['tool', 'argumentsJson'],
      type: 'object',
    })
    expect(schemaJson).not.toContain('anyOf')
    expect(schemaJson).not.toContain('schemaVersion')
    expect(schemaJson.length).toBeLessThan(1_500)
  })

  it('normalizes the response schema to Gemini documented JSON Schema keys', () => {
    const schemaJson = JSON.stringify(buildGeminiResponseJsonSchema())

    expect(schemaJson).not.toContain('exclusiveMinimum')
    expect(schemaJson).toContain('additionalProperties')
  })

  it('keeps the legacy generateContent helper on the shared tool schema', () => {
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
        argumentsJson: {
          type: 'string',
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

  it('parses JSON candidates from Gemini Interactions outputs', () => {
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
