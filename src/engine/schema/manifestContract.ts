/*
This is the canonical provider facing asset json schema
which is derived from zod validation model with additional
specifications needed for asset generation
*/

import {
  manifestAllowanceSchema,
  manifestAssetSchema,
  manifestCheckSchema,
  manifestGeometrySchema,
  manifestVisualSchema,
} from './manifestSchema'
import {
  createProviderJsonSchema,
  type JsonSchema,
  type ProviderJsonSchemaOptions,
} from './zodProviderJsonSchema'

export const manifestAssetResponseFormatName = 'manifest3d_asset'
export const manifestRepairPatchResponseFormatName = 'manifest3d_repair_patch'
export const manifestToolCallResponseFormatName = 'manifest3d_tool_call'

const manifestProviderJsonSchemaOptions: ProviderJsonSchemaOptions = {
  descriptions: {
    id: 'Stable asset id.',
    name: 'Human-readable asset name.',
    prompt: 'Short prompt summary for this asset.',
    'parts.*.id': 'Stable part id.',
    'parts.*.name': 'Human-readable part name.',
    'parts.*.description': 'Concise description of this part.',
    'parts.*.visuals.*.id': 'Stable visual id used by checks and allowances.',
    'parts.*.visuals.*.name': 'Human-readable visual name.',
    'parts.*.visuals.*.materialId': 'Existing material id.',
    'parts.*.visuals.*.transform.position': 'Three finite numbers [x, y, z] in local meters.',
    'parts.*.visuals.*.transform.rotation': 'Three Euler rotation values [x, y, z] in radians.',
    'parts.*.visuals.*.transform.scale': 'Three positive scale values [x, y, z].',
    'joints.*.id': 'Stable joint id.',
    'joints.*.name': 'Human-readable joint name.',
    'joints.*.parentPartId': 'Existing parent part id.',
    'joints.*.childPartId': 'Existing child part id.',
    'joints.*.origin.position': 'Three finite numbers [x, y, z] in local meters.',
    'joints.*.origin.rotation': 'Three Euler rotation values [x, y, z] in radians.',
    'joints.*.origin.scale': 'Three positive scale values [x, y, z].',
    'joints.*.axis': 'Nonzero finite axis.',
    'controls.*.id': 'Stable control id.',
    'controls.*.name': 'Human-readable control dial name.',
    'controls.*.joints.*.jointId': 'Existing movable joint id controlled by this dial.',
    'controls.*.joints.*.scale': 'Multiplier from dial value to joint value; use 1 for same direction and -1 for mirrored motion.',
    'controls.*.joints.*.offset': 'Offset added after scale; use 0 unless a joint needs a phase shift.',
    'materials.*.id': 'Stable material id.',
    'materials.*.name': 'Human-readable material name.',
    'materials.*.color': 'Hex color, for example #a8a0ff.',
    'materials.*.opacity': 'Number from 0 to 1. Use 1 for opaque materials.',
    'materials.*.side': 'Which side of the material renders: front-facing triangles, back-facing triangles, or both sides. Use double for intentional paper-thin or open surfaces that should remain visible from either side.',
    'checks.*.pose.name': 'Short pose name, for example open or extended.',
    'checks.*.pose.joints.*.jointId': 'Existing movable joint id.',
    'checks.*.pose.joints.*.value': 'Joint value: radians for revolute/continuous, meters for prismatic.',
    'allowances.*.reason': 'Concrete reason this allowance is intentional. Also include matching exact proof checks when applicable.',
    'metadata.createdAt': 'ISO-8601 datetime.',
    'metadata.updatedAt': 'ISO-8601 datetime.',
    'metadata.sourceImageIds.*': 'Reference image id.',
  },
  overrides: [
    {
      path: 'schemaVersion',
      apply: (schema) => ({ ...schema, type: 'integer', enum: [2] }),
    },
    {
      path: 'parts.*.visuals',
      apply: (schema) => ({ ...schema, minItems: 1 }),
    },
    {
      path: 'joints.*',
      apply: createProviderJointSchema,
    },
    {
      path: 'checks.*',
      apply: createProviderCheckSchema,
    },
    {
      path: '',
      apply: createProviderCheckSchema,
    },
    {
      path: 'metadata.generationStatus',
      apply: (schema) => ({ ...schema, enum: ['ready'] }),
    },
  ],
}

export const manifestAssetResponseJsonSchema = createProviderJsonSchema(
  manifestAssetSchema,
  manifestProviderJsonSchemaOptions,
)

const geometrySchema = createProviderJsonSchema(
  manifestGeometrySchema,
  manifestProviderJsonSchemaOptions,
)
const visualSchema = createProviderJsonSchema(
  manifestVisualSchema,
  manifestProviderJsonSchemaOptions,
)
const checkSchema = createProviderJsonSchema(
  manifestCheckSchema,
  manifestProviderJsonSchemaOptions,
)
const allowanceSchema = createProviderJsonSchema(
  manifestAllowanceSchema,
  manifestProviderJsonSchemaOptions,
)

export const manifestToolCallResponseJsonSchema = objectSchema(
  {
    tool: {
      type: 'string',
      enum: ['apply_manifest_patch'],
      description: 'Tool to invoke for repair and edit turns.',
    },
    operations: arraySchema(
      objectSchema(
        {
          op: enumSchema(['add', 'replace', 'remove']),
          path: stringSchema(
            'Focused nested RFC 6901 JSON Pointer path into the current canonical asset. Do not use root path "" or wrappers such as /asset, /assets, /manifest, or /candidate.',
          ),
          valueJson: stringSchema(
            'JSON.stringify of the exact add/replace value. For remove operations, set this to "null"; the harness ignores it.',
          ),
        },
        ['op', 'path', 'valueJson'],
      ),
      { minItems: 1 },
    ),
  },
  ['tool', 'operations'],
)

const patchPathSchema = stringSchema(
  'RFC 6901 JSON Pointer path into the current candidate asset.',
)
const patchCheckPathSchema = {
  ...patchPathSchema,
  pattern: '^/checks(?:$|/(?:-|[0-9]+)$)',
}
const patchAllowancePathSchema = {
  ...patchPathSchema,
  pattern: '^/allowances(?:$|/(?:-|[0-9]+)$)',
}
const patchVisualPathSchema = {
  ...patchPathSchema,
  pattern: '^/parts/(?:[0-9]+)/visuals(?:$|/(?:-|[0-9]+)$)',
}
const patchVisualGeometryPathSchema = {
  ...patchPathSchema,
  pattern: '^/parts/(?:[0-9]+)/visuals/(?:[0-9]+)/geometry$',
}
const patchGenericValueSchema = {
  anyOf: [
    stringSchema('String replacement value.'),
    numberSchema('Number replacement value.'),
    integerSchema('Integer replacement value.'),
    booleanSchema('Boolean replacement value.'),
    {
      type: 'null',
    },
    arraySchema(
      {
        anyOf: [
          stringSchema('Array string item.'),
          numberSchema('Array number item.'),
          booleanSchema('Array boolean item.'),
          {
            type: 'null',
          },
        ],
      },
      { maxItems: 64 },
    ),
  ],
}
const patchCheckValueSchema = checkSchema
const patchAllowanceValueSchema = allowanceSchema
const patchVisualValueSchema = visualSchema

const patchAddSchema = objectSchema(
  {
    op: literalSchema('add'),
    path: patchPathSchema,
    value: patchGenericValueSchema,
  },
  ['op', 'path', 'value'],
)
const patchReplaceSchema = objectSchema(
  {
    op: literalSchema('replace'),
    path: patchPathSchema,
    value: patchGenericValueSchema,
  },
  ['op', 'path', 'value'],
)
const patchAddVisualSchema = objectSchema(
  {
    op: literalSchema('add'),
    path: patchVisualPathSchema,
    value: patchVisualValueSchema,
  },
  ['op', 'path', 'value'],
)
const patchReplaceVisualSchema = objectSchema(
  {
    op: literalSchema('replace'),
    path: patchVisualPathSchema,
    value: patchVisualValueSchema,
  },
  ['op', 'path', 'value'],
)
const patchReplaceVisualGeometrySchema = objectSchema(
  {
    op: literalSchema('replace'),
    path: patchVisualGeometryPathSchema,
    value: geometrySchema,
  },
  ['op', 'path', 'value'],
)
const patchAddVisualGeometrySchema = objectSchema(
  {
    op: literalSchema('add'),
    path: patchVisualGeometryPathSchema,
    value: geometrySchema,
  },
  ['op', 'path', 'value'],
)
const patchAddCheckSchema = objectSchema(
  {
    op: literalSchema('add'),
    path: patchCheckPathSchema,
    value: patchCheckValueSchema,
  },
  ['op', 'path', 'value'],
)
const patchReplaceCheckSchema = objectSchema(
  {
    op: literalSchema('replace'),
    path: patchCheckPathSchema,
    value: patchCheckValueSchema,
  },
  ['op', 'path', 'value'],
)
const patchAddAllowanceSchema = objectSchema(
  {
    op: literalSchema('add'),
    path: patchAllowancePathSchema,
    value: patchAllowanceValueSchema,
  },
  ['op', 'path', 'value'],
)
const patchReplaceAllowanceSchema = objectSchema(
  {
    op: literalSchema('replace'),
    path: patchAllowancePathSchema,
    value: patchAllowanceValueSchema,
  },
  ['op', 'path', 'value'],
)
const patchRemoveSchema = objectSchema(
  {
    op: literalSchema('remove'),
    path: patchPathSchema,
  },
  ['op', 'path'],
)

export const manifestRepairPatchResponseJsonSchema = objectSchema(
  {
    operations: arraySchema(
      {
        anyOf: [
          patchAddVisualSchema,
          patchReplaceVisualSchema,
          patchAddVisualGeometrySchema,
          patchReplaceVisualGeometrySchema,
          patchAddCheckSchema,
          patchReplaceCheckSchema,
          patchAddAllowanceSchema,
          patchReplaceAllowanceSchema,
          patchAddSchema,
          patchReplaceSchema,
          patchRemoveSchema,
        ],
      },
      { minItems: 1 },
    ),
  },
  ['operations'],
)

function createProviderJointSchema(schema: JsonSchema): JsonSchema {
  if (!isRecord(schema.properties)) {
    return schema
  }

  const properties = schema.properties as Record<string, JsonSchema>
  const commonProperties = pickProperties(properties, [
    'id',
    'name',
    'parentPartId',
    'childPartId',
    'origin',
  ])
  const axis = properties.axis ?? vector3Schema('Nonzero finite axis.')
  const limitedLimitsSchema = objectSchema(
    {
      lower: numberSchema('Lower joint limit.'),
      upper: numberSchema('Upper joint limit.'),
      effort: positiveNumberSchema('Positive effort value.'),
      velocity: positiveNumberSchema('Positive velocity value.'),
    },
    ['lower', 'upper', 'effort', 'velocity'],
  )
  const continuousLimitsSchema = objectSchema(
    {
      effort: positiveNumberSchema('Positive effort value.'),
      velocity: positiveNumberSchema('Positive velocity value.'),
    },
    ['effort', 'velocity'],
  )

  return {
    anyOf: [
      objectSchema(
        {
          ...commonProperties,
          type: literalSchema('fixed'),
        },
        ['id', 'name', 'parentPartId', 'childPartId', 'origin', 'type'],
      ),
      createLimitedJointProviderSchema('revolute', commonProperties, axis, limitedLimitsSchema),
      createLimitedJointProviderSchema('prismatic', commonProperties, axis, limitedLimitsSchema),
      objectSchema(
        {
          ...commonProperties,
          type: literalSchema('continuous'),
          axis,
          limits: continuousLimitsSchema,
        },
        [
          'id',
          'name',
          'parentPartId',
          'childPartId',
          'origin',
          'type',
          'axis',
          'limits',
        ],
      ),
    ],
  }
}

function createProviderCheckSchema(schema: JsonSchema): JsonSchema {
  if (!Array.isArray(schema.anyOf)) {
    return schema
  }

  return {
    ...schema,
    anyOf: schema.anyOf.flatMap((variant) => createCheckPoseVariants(variant)),
  }
}

function createCheckPoseVariants(schema: unknown): JsonSchema[] {
  if (!isRecord(schema) || schema.type !== 'object' || !isRecord(schema.properties)) {
    return [schema as JsonSchema]
  }

  if (!('pose' in schema.properties)) {
    return [schema]
  }

  const propertiesWithoutPose = { ...schema.properties }
  delete propertiesWithoutPose.pose

  return [
    {
      ...schema,
      properties: propertiesWithoutPose,
      required: Object.keys(propertiesWithoutPose),
    },
    {
      ...schema,
      required: Object.keys(schema.properties),
    },
  ]
}

function createLimitedJointProviderSchema(
  type: 'prismatic' | 'revolute',
  commonProperties: Record<string, JsonSchema>,
  axis: JsonSchema,
  limits: JsonSchema,
) {
  return objectSchema(
    {
      ...commonProperties,
      type: literalSchema(type),
      axis,
      limits,
    },
    [
      'id',
      'name',
      'parentPartId',
      'childPartId',
      'origin',
      'type',
      'axis',
      'limits',
    ],
  )
}

function pickProperties(
  properties: Record<string, JsonSchema>,
  keys: readonly string[],
) {
  return Object.fromEntries(
    keys.map((key) => {
      const property = properties[key]

      if (!property) {
        throw new Error(`Missing provider schema property "${key}".`)
      }

      return [key, property]
    }),
  )
}

function objectSchema(
  properties: Record<string, JsonSchema>,
  required: readonly string[],
): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: [...required],
  }
}

function arraySchema(
  items: JsonSchema,
  options: {
    maxItems?: number
    minItems?: number
  } = {},
): JsonSchema {
  return {
    type: 'array',
    items,
    ...(options.maxItems !== undefined ? { maxItems: options.maxItems } : {}),
    ...(options.minItems !== undefined ? { minItems: options.minItems } : {}),
  }
}

function literalSchema(value: string): JsonSchema {
  return {
    type: 'string',
    enum: [value],
  }
}

function enumSchema(values: readonly string[], description?: string): JsonSchema {
  return {
    type: 'string',
    enum: [...values],
    ...(description ? { description } : {}),
  }
}

function stringSchema(description: string): JsonSchema {
  return {
    type: 'string',
    description,
  }
}

function numberSchema(description: string): JsonSchema {
  return {
    type: 'number',
    description,
  }
}

function positiveNumberSchema(description: string): JsonSchema {
  return {
    ...numberSchema(description),
    exclusiveMinimum: 0,
  }
}

function integerSchema(
  description: string,
  options: {
    maximum?: number
    minimum?: number
  } = {},
): JsonSchema {
  return {
    type: 'integer',
    description,
    ...(options.minimum !== undefined ? { minimum: options.minimum } : {}),
    ...(options.maximum !== undefined ? { maximum: options.maximum } : {}),
  }
}

function booleanSchema(description: string): JsonSchema {
  return {
    type: 'boolean',
    description,
  }
}

function vector3Schema(description: string): JsonSchema {
  return arraySchema(numberSchema(description), { maxItems: 3, minItems: 3 })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
