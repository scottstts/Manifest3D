import { describe, expect, it, vi } from 'vitest'
import { createValidValidationFixtureAsset } from '../examples/validationFixtures'
import { manifestAssetResponseJsonSchema } from '../schema/manifestContract'
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
    expect(body.reasoning).toEqual({ effort: 'high' })
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

  it('uses strict-compatible object schemas for the response format', () => {
    expect(findStrictRequiredMismatches(manifestAssetResponseJsonSchema)).toEqual([])
  })

  it('constrains generated vectors, geometry arrays, and bounded numbers', () => {
    const assetSchema = manifestAssetResponseJsonSchema
    const partSchema = getArrayItem(getProperty(assetSchema, 'parts'))
    const visualSchema = getArrayItem(getProperty(partSchema, 'visuals'))
    const geometrySchema = getProperty(visualSchema, 'geometry')
    const materialSchema = getArrayItem(getProperty(assetSchema, 'materials'))
    const controlSchema = getArrayItem(getProperty(assetSchema, 'controls'))
    const controlBindingSchema = getArrayItem(getProperty(controlSchema, 'joints'))
    const boxSchema = getAnyOfVariant(geometrySchema, 'box')
    const boxSizeSchema = getProperty(boxSchema, 'size')
    const roundedBoxSchema = getAnyOfVariant(geometrySchema, 'roundedBox')
    const capsuleSchema = getAnyOfVariant(geometrySchema, 'capsule')
    const latheSchema = getAnyOfVariant(geometrySchema, 'lathe')

    expect(getProperty(assetSchema, 'parts')).toMatchObject({ minItems: 1 })
    expect(getProperty(assetSchema, 'materials')).toMatchObject({ minItems: 1 })
    expect(getProperty(partSchema, 'visuals')).toMatchObject({ minItems: 1 })
    expect(getProperty(controlSchema, 'joints')).toMatchObject({ minItems: 1 })
    expect(getProperty(controlBindingSchema, 'scale')).toMatchObject({
      type: 'number',
    })
    expect(boxSizeSchema).toMatchObject({
      maxItems: 3,
      minItems: 3,
    })
    expect(getArrayItem(boxSizeSchema)).toMatchObject({
      exclusiveMinimum: 0,
      type: 'number',
    })
    expect(getProperty(roundedBoxSchema, 'segments')).toMatchObject({
      maximum: 32,
      minimum: 1,
      type: 'integer',
    })
    expect(getProperty(capsuleSchema, 'capSegments')).toMatchObject({
      maximum: 64,
      minimum: 1,
      type: 'integer',
    })
    expect(getProperty(latheSchema, 'points')).toMatchObject({ minItems: 2 })
    expect(getProperty(materialSchema, 'opacity')).toMatchObject({
      maximum: 1,
      minimum: 0,
    })
    expect(getProperty(materialSchema, 'side')).toMatchObject({
      enum: ['front', 'back', 'double'],
      type: 'string',
    })
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

function getProperty(schema: unknown, key: string) {
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    throw new Error(`Schema has no properties for key "${key}".`)
  }

  const property = schema.properties[key]

  if (!property) {
    throw new Error(`Missing schema property "${key}".`)
  }

  return property
}

function getArrayItem(schema: unknown) {
  if (!isRecord(schema) || !schema.items) {
    throw new Error('Schema is not an array schema.')
  }

  return schema.items
}

function getAnyOfVariant(schema: unknown, type: string) {
  if (!isRecord(schema) || !Array.isArray(schema.anyOf)) {
    throw new Error('Schema has no anyOf variants.')
  }

  const variant = schema.anyOf.find(
    (entry) =>
      isRecord(entry) &&
      isRecord(entry.properties) &&
      isRecord(entry.properties.type) &&
      Array.isArray(entry.properties.type.enum) &&
      entry.properties.type.enum.includes(type),
  )

  if (!variant) {
    throw new Error(`Missing schema variant "${type}".`)
  }

  return variant
}

function findStrictRequiredMismatches(
  schema: unknown,
  path = '$',
): string[] {
  if (!isRecord(schema)) {
    return []
  }

  const mismatches: string[] = []

  if (schema.type === 'object' && isRecord(schema.properties)) {
    const propertyKeys = Object.keys(schema.properties).sort()
    const requiredKeys = Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === 'string').sort()
      : []

    if (!arraysEqual(propertyKeys, requiredKeys)) {
      mismatches.push(
        `${path}: properties=[${propertyKeys.join(',')}] required=[${requiredKeys.join(',')}]`,
      )
    }
  }

  if (isRecord(schema.properties)) {
    for (const [key, value] of Object.entries(schema.properties)) {
      mismatches.push(
        ...findStrictRequiredMismatches(value, `${path}.properties.${key}`),
      )
    }
  }

  if (Array.isArray(schema.anyOf)) {
    schema.anyOf.forEach((value, index) => {
      mismatches.push(...findStrictRequiredMismatches(value, `${path}.anyOf.${index}`))
    })
  }

  if (Array.isArray(schema.oneOf)) {
    schema.oneOf.forEach((value, index) => {
      mismatches.push(...findStrictRequiredMismatches(value, `${path}.oneOf.${index}`))
    })
  }

  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((value, index) => {
      mismatches.push(...findStrictRequiredMismatches(value, `${path}.allOf.${index}`))
    })
  }

  if (schema.items) {
    mismatches.push(...findStrictRequiredMismatches(schema.items, `${path}.items`))
  }

  return mismatches
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
