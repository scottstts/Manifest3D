import { describe, expect, it, vi } from 'vitest'
import { createValidValidationFixtureAsset } from '../examples/validationFixtures'
import type { ManifestScene } from '../schema/manifestTypes'
import { compileManifestPrompt } from './promptCompiler'
import {
  buildOpenAIResponsesRequestBody,
  createOpenAIManifestClient,
  parseOpenAIManifestResponse,
} from './openAiManifestClient'

const emptyScene: ManifestScene = {
  assets: [],
  schemaVersion: 1,
  units: 'meters',
}

describe('buildOpenAIResponsesRequestBody', () => {
  it('builds Responses API structured-output requests with image payloads', () => {
    const prompt = compileManifestPrompt({
      mode: 'create',
      scene: emptyScene,
      userPrompt: 'Create a reference-based desk lamp.',
    })

    const body = buildOpenAIResponsesRequestBody({
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

    expect(body.model).toBe('gpt-5.5')
    expect(body.reasoning).toEqual({ effort: 'medium' })
    expect(body.temperature).toBe(1)
    expect(body.max_output_tokens).toBe(64_000)
    expect(body.text.format).toMatchObject({
      name: 'manifest3d_asset',
      strict: true,
      type: 'json_schema',
    })
    expect(body.input[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('Create a reference-based desk lamp.'),
          type: 'input_text',
        }),
        expect.objectContaining({
          detail: 'auto',
          image_url: 'data:image/png;base64,abc123',
          type: 'input_image',
        }),
      ]),
    )
  })
})

describe('createOpenAIManifestClient', () => {
  it('returns a controlled unavailable response when the API key is missing', async () => {
    const prompt = compileManifestPrompt({
      mode: 'create',
      scene: emptyScene,
      userPrompt: 'Create a small box.',
    })
    const fetcher = vi.fn()
    const client = createOpenAIManifestClient({
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

  it('parses JSON candidates from Responses API output content', () => {
    const candidate = createValidValidationFixtureAsset()
    const result = parseOpenAIManifestResponse({
      id: 'resp_123',
      output: [
        {
          content: [
            {
              text: JSON.stringify(candidate),
              type: 'output_text',
            },
          ],
        },
      ],
    })

    expect(result.status).toBe('ok')

    if (result.status === 'ok') {
      expect(result.responseId).toBe('resp_123')
      expect(result.candidate).toMatchObject({
        id: 'validation-crate',
        schemaVersion: 2,
      })
    }
  })

  it('reports malformed output as a parse error without throwing', () => {
    const result = parseOpenAIManifestResponse({
      id: 'resp_bad',
      output_text: '{"schemaVersion":2',
    })

    expect(result).toMatchObject({
      responseId: 'resp_bad',
      status: 'error',
    })
  })
})
