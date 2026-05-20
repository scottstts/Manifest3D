import { describe, expect, it, vi } from 'vitest'
import { createValidValidationFixtureAsset } from '../examples/validationFixtures'
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

  it('normalizes the response schema to Gemini documented JSON Schema keys', () => {
    const schemaJson = JSON.stringify(buildGeminiResponseJsonSchema())

    expect(schemaJson).not.toContain('exclusiveMinimum')
    expect(schemaJson).toContain('"minimum":0')
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
