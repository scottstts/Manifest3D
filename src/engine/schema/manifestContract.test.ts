import { describe, expect, it } from 'vitest'
import { manifestAssetResponseJsonSchema } from './manifestContract'
import { parseManifestAsset } from './manifestSchema'

describe('manifestContract provider JSON schema', () => {
  it('derives runtime Zod constraints while keeping provider-only output constraints', () => {
    const materialSchema = getArrayItem(getProperty(manifestAssetResponseJsonSchema, 'materials'))
    const metadataSchema = getProperty(manifestAssetResponseJsonSchema, 'metadata')
    const generationStatusSchema = getProperty(metadataSchema, 'generationStatus')

    expect(getProperty(materialSchema, 'id')).toMatchObject({ minLength: 1 })
    expect(getProperty(materialSchema, 'side')).toMatchObject({
      enum: ['front', 'back', 'double'],
      type: 'string',
    })
    expect(materialSchema).toMatchObject({
      required: expect.arrayContaining(['emission', 'emissionAnimation', 'opacity', 'side']),
    })
    expect(generationStatusSchema).toMatchObject({ enum: ['ready'] })

    const parsedAsset = parseManifestAsset({
      allowances: [],
      checks: [],
      controls: [],
      id: 'runtime-defaults',
      joints: [],
      materials: [
        {
          color: '#ffffff',
          id: 'mat-white',
          metalness: 0,
          name: 'White',
          roughness: 1,
        },
      ],
      metadata: {
        createdAt: '2026-05-16T00:00:00.000Z',
        generationStatus: 'draft',
        sourceImageIds: [],
        updatedAt: '2026-05-16T00:00:00.000Z',
      },
      name: 'Runtime Defaults',
      parts: [
        {
          id: 'base',
          name: 'Base',
          visuals: [
            {
              geometry: {
                size: [1, 1, 1],
                type: 'box',
              },
              id: 'base-visual',
              materialId: 'mat-white',
              transform: {},
            },
          ],
        },
      ],
      prompt: 'runtime/default test',
      schemaVersion: 2,
      units: 'meters',
    })

    expect(parsedAsset.materials[0].side).toBe('front')
    expect(parsedAsset.metadata.generationStatus).toBe('draft')
  })

  it('uses provider-side joint variants instead of weakening the central joint schema', () => {
    const jointSchema = getArrayItem(getProperty(manifestAssetResponseJsonSchema, 'joints'))
    const fixedJointSchema = getAnyOfVariant(jointSchema, 'fixed')
    const revoluteJointSchema = getAnyOfVariant(jointSchema, 'revolute')
    const continuousJointSchema = getAnyOfVariant(jointSchema, 'continuous')

    expect(Object.keys(getProperties(fixedJointSchema))).toEqual([
      'id',
      'name',
      'parentPartId',
      'childPartId',
      'origin',
      'type',
    ])
    expect(getProperty(revoluteJointSchema, 'axis')).toMatchObject({
      maxItems: 3,
      minItems: 3,
      type: 'array',
    })
    expect(getProperty(getProperty(revoluteJointSchema, 'limits'), 'lower')).toMatchObject({
      type: 'number',
    })
    expect(() => getProperty(getProperty(continuousJointSchema, 'limits'), 'lower')).toThrow()
    expect(getProperty(getProperty(continuousJointSchema, 'limits'), 'effort')).toMatchObject({
      exclusiveMinimum: 0,
    })
  })

  it('represents optional check poses as strict-compatible anyOf variants', () => {
    const checkSchema = getArrayItem(getProperty(manifestAssetResponseJsonSchema, 'checks'))
    const partExistsVariants = getAnyOfVariants(checkSchema, 'part_exists')

    expect(partExistsVariants).toHaveLength(2)
    expect(partExistsVariants.map((variant) => 'pose' in getProperties(variant)).sort()).toEqual([
      false,
      true,
    ])
    expect(findStrictRequiredMismatches(checkSchema)).toEqual([])
  })
})

function getProperty(schema: unknown, key: string) {
  const properties = getProperties(schema)
  const property = properties[key]

  if (!property) {
    throw new Error(`Missing schema property "${key}".`)
  }

  return property
}

function getProperties(schema: unknown) {
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    throw new Error('Schema has no object properties.')
  }

  return schema.properties
}

function getArrayItem(schema: unknown) {
  if (!isRecord(schema) || !schema.items) {
    throw new Error('Schema is not an array schema.')
  }

  return schema.items
}

function getAnyOfVariant(schema: unknown, type: string) {
  const variants = getAnyOfVariants(schema, type)

  if (variants.length === 0) {
    throw new Error(`Missing schema variant "${type}".`)
  }

  return variants[0]
}

function getAnyOfVariants(schema: unknown, type: string) {
  if (!isRecord(schema) || !Array.isArray(schema.anyOf)) {
    throw new Error('Schema has no anyOf variants.')
  }

  return schema.anyOf.filter(
    (entry) =>
      isRecord(entry) &&
      isRecord(entry.properties) &&
      isRecord(entry.properties.type) &&
      Array.isArray(entry.properties.type.enum) &&
      entry.properties.type.enum.includes(type),
  )
}

function findStrictRequiredMismatches(schema: unknown, path = '$'): string[] {
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
      mismatches.push(...findStrictRequiredMismatches(value, `${path}.${key}`))
    }
  }

  if (Array.isArray(schema.anyOf)) {
    schema.anyOf.forEach((value, index) => {
      mismatches.push(...findStrictRequiredMismatches(value, `${path}.anyOf.${index}`))
    })
  }

  if (schema.items) {
    mismatches.push(...findStrictRequiredMismatches(schema.items, `${path}.*`))
  }

  return mismatches
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
