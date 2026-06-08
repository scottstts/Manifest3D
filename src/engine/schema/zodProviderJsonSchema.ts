import { z } from 'zod'

export type JsonSchema = Record<string, unknown>

type ProviderJsonSchemaPath = readonly string[]

export type ProviderJsonSchemaOptions = {
  /**
   * OpenAI strict structured outputs require every object property to appear in
   * `required`. Runtime-optional fields can still be represented by expanding
   * an object into variants with and without selected optional properties.
   */
  optionalProperties?: readonly ProviderOptionalPropertySpec[]
  /** Provider-facing descriptions and examples that should not live on the app runtime schema. */
  descriptions?: Readonly<Record<string, string>>
  /** Provider-only constraints that are stricter than the persisted/runtime manifest. */
  overrides?: readonly ProviderJsonSchemaOverride[]
}

export type ProviderOptionalPropertySpec = {
  path: string
  property: string
}

export type ProviderJsonSchemaOverride = {
  path: string
  apply(schema: JsonSchema): JsonSchema
}

export function createProviderJsonSchema(
  schema: z.ZodType,
  options: ProviderJsonSchemaOptions = {},
): JsonSchema {
  const rawSchema = z.toJSONSchema(schema, { io: 'output' }) as JsonSchema
  const normalizedSchema = normalizeZodJsonSchema(rawSchema, [], options)

  return applyProviderOverrides(normalizedSchema, [], options)
}

function normalizeZodJsonSchema(
  schema: unknown,
  path: ProviderJsonSchemaPath,
  options: ProviderJsonSchemaOptions,
): unknown {
  if (Array.isArray(schema)) {
    return schema.map((entry, index) =>
      normalizeZodJsonSchema(entry, [...path, String(index)], options),
    )
  }

  if (!isRecord(schema)) {
    return schema
  }

  const result: JsonSchema = {}

  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema' || key === 'default' || key === 'pattern') {
      continue
    }

    if (key === 'oneOf') {
      result.anyOf = normalizeZodJsonSchema(value, [...path, 'anyOf'], options)
      continue
    }

    if (key === 'const') {
      result.enum = [value]
      continue
    }

    if (key === 'prefixItems' && Array.isArray(value)) {
      const itemsSchema = createTupleItemsSchema(value, path, options)
      result.items = itemsSchema
      result.minItems = value.length
      result.maxItems = value.length
      continue
    }

    result[key] = normalizeZodJsonSchema(value, [...path, key], options)
  }

  normalizeObjectRequired(result, path, options)
  applyDescription(result, path, options)

  if (Array.isArray(result.anyOf)) {
    result.anyOf = result.anyOf.flatMap((entry) =>
      expandProviderOptionalProperties(entry, path, options),
    )
  }

  return result
}

function createTupleItemsSchema(
  entries: readonly unknown[],
  path: ProviderJsonSchemaPath,
  options: ProviderJsonSchemaOptions,
) {
  if (entries.length === 0) {
    return {}
  }

  const normalizedEntries = entries.map((entry) =>
    normalizeZodJsonSchema(entry, [...path, 'items'], options),
  )

  const [firstEntry] = normalizedEntries
  const firstEntryJson = JSON.stringify(firstEntry)
  const isHomogeneous = normalizedEntries.every(
    (entry) => JSON.stringify(entry) === firstEntryJson,
  )

  return isHomogeneous ? firstEntry : { anyOf: normalizedEntries }
}

function normalizeObjectRequired(
  schema: JsonSchema,
  path: ProviderJsonSchemaPath,
  options: ProviderJsonSchemaOptions,
) {
  if (schema.type !== 'object' || !isRecord(schema.properties)) {
    return
  }

  const required = Object.keys(schema.properties).filter(
    (property) => !shouldPreserveOptionalProperty(path, property, options),
  )

  schema.required = required
}

function expandProviderOptionalProperties(
  schema: unknown,
  path: ProviderJsonSchemaPath,
  options: ProviderJsonSchemaOptions,
): unknown[] {
  if (!isRecord(schema) || schema.type !== 'object' || !isRecord(schema.properties)) {
    return [schema]
  }

  const preservedProperties = Object.keys(schema.properties).filter((property) =>
    shouldPreserveOptionalProperty(path, property, options),
  )

  if (preservedProperties.length === 0) {
    return [schema]
  }

  return createOptionalPropertyCombinations(preservedProperties).map(
    (includedProperties) => {
      const included = new Set(includedProperties)
      const properties = Object.fromEntries(
        Object.entries(schema.properties as Record<string, unknown>).filter(
          ([property]) => !preservedProperties.includes(property) || included.has(property),
        ),
      )
      const required = Object.keys(properties)
      const variant: JsonSchema = {
        ...schema,
        properties,
        required,
      }

      return variant
    },
  )
}

function createOptionalPropertyCombinations(properties: readonly string[]) {
  return properties.reduce<string[][]>(
    (combinations, property) => [
      ...combinations,
      ...combinations.map((combination) => [...combination, property]),
    ],
    [[]],
  )
}

function shouldPreserveOptionalProperty(
  path: ProviderJsonSchemaPath,
  property: string,
  options: ProviderJsonSchemaOptions,
) {
  return (options.optionalProperties ?? []).some(
    (spec) => spec.property === property && pathMatches(path, spec.path),
  )
}

function applyProviderOverrides(
  schema: unknown,
  path: ProviderJsonSchemaPath,
  options: ProviderJsonSchemaOptions,
): JsonSchema {
  if (!isRecord(schema)) {
    return schema as JsonSchema
  }

  let result: JsonSchema = {}

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'properties' && isRecord(value)) {
      result.properties = Object.fromEntries(
        Object.entries(value).map(([property, propertySchema]) => [
          property,
          applyProviderOverrides(propertySchema, [...path, property], options),
        ]),
      )
      continue
    }

    if (key === 'items') {
      result.items = applyProviderOverrides(value, [...path, '*'], options)
      continue
    }

    if (key === 'anyOf' && Array.isArray(value)) {
      result.anyOf = value.map((entry) => applyProviderOverrides(entry, path, options))
      continue
    }

    if (key === 'allOf' && Array.isArray(value)) {
      result.allOf = value.map((entry) => applyProviderOverrides(entry, path, options))
      continue
    }

    result[key] = value
  }

  for (const override of options.overrides ?? []) {
    if (pathMatches(path, override.path)) {
      result = override.apply(result)
    }
  }

  return result
}

function applyDescription(
  schema: JsonSchema,
  path: ProviderJsonSchemaPath,
  options: ProviderJsonSchemaOptions,
) {
  const description = options.descriptions?.[formatPath(path)]

  if (description) {
    schema.description = description
  }
}

function pathMatches(path: ProviderJsonSchemaPath, pattern: string) {
  const pathParts = path.map((part) => (isNumericString(part) ? '*' : part))
  const patternParts = pattern.split('.').filter(Boolean)

  if (pathParts.length !== patternParts.length) {
    return false
  }

  return patternParts.every(
    (part, index) => part === '*' || pathParts[index] === part,
  )
}

function formatPath(path: ProviderJsonSchemaPath) {
  return path.map((part) => (isNumericString(part) ? '*' : part)).join('.')
}

function isNumericString(value: string) {
  return /^\d+$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
