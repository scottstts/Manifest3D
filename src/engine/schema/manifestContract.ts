type JsonSchema = Record<string, unknown>

const transformSchema = objectSchema(
  {
    position: vector3Schema(
      'Three finite numbers [x, y, z] in local meters.',
    ),
    rotation: vector3Schema(
      'Three Euler rotation values [x, y, z] in radians.',
    ),
    scale: vector3Schema('Three positive scale values [x, y, z].'),
  },
  ['position', 'rotation', 'scale'],
)

const materialSchema = objectSchema(
  {
    id: stringSchema('Stable material id.'),
    name: stringSchema('Human-readable material name.'),
    color: stringSchema('Hex color, for example #a8a0ff.'),
    metalness: boundedNumberSchema('Number from 0 to 1.', 0, 1),
    roughness: boundedNumberSchema('Number from 0 to 1.', 0, 1),
    opacity: boundedNumberSchema(
      'Number from 0 to 1. Use 1 for opaque materials.',
      0,
      1,
    ),
  },
  ['id', 'name', 'color', 'metalness', 'roughness', 'opacity'],
)

const visualSchema = objectSchema(
  {
    id: stringSchema('Stable visual id used by checks and allowances.'),
    name: stringSchema('Human-readable visual name.'),
    geometry: {
      anyOf: [
        objectSchema(
          {
            type: literalSchema('box'),
            size: positiveVector3Schema('Box dimensions [width, height, depth].'),
          },
          ['type', 'size'],
        ),
        objectSchema(
          {
            type: literalSchema('cylinder'),
            radiusTop: positiveNumberSchema('Positive top radius.'),
            radiusBottom: positiveNumberSchema('Positive bottom radius.'),
            height: positiveNumberSchema('Positive height.'),
            radialSegments: segmentCountSchema(),
          },
          ['type', 'radiusTop', 'radiusBottom', 'height', 'radialSegments'],
        ),
        objectSchema(
          {
            type: literalSchema('sphere'),
            radius: positiveNumberSchema('Positive radius.'),
            widthSegments: segmentCountSchema(),
            heightSegments: segmentCountSchema(),
          },
          ['type', 'radius', 'widthSegments', 'heightSegments'],
        ),
        objectSchema(
          {
            type: literalSchema('cone'),
            radius: positiveNumberSchema('Positive base radius.'),
            height: positiveNumberSchema('Positive height.'),
            radialSegments: segmentCountSchema(),
          },
          ['type', 'radius', 'height', 'radialSegments'],
        ),
        objectSchema(
          {
            type: literalSchema('torus'),
            radius: positiveNumberSchema('Positive major radius.'),
            tube: positiveNumberSchema('Positive tube radius.'),
            radialSegments: segmentCountSchema(),
            tubularSegments: segmentCountSchema(),
          },
          ['type', 'radius', 'tube', 'radialSegments', 'tubularSegments'],
        ),
        objectSchema(
          {
            type: literalSchema('lathe'),
            points: arraySchema(vector2Schema('Lathe profile point [x, y].'), {
              minItems: 2,
            }),
            segments: segmentCountSchema(),
            phiStart: numberSchema('Start angle in radians. Use 0 by default.'),
            phiLength: positiveNumberSchema('Positive sweep angle in radians.'),
          },
          ['type', 'points', 'segments', 'phiStart', 'phiLength'],
        ),
        objectSchema(
          {
            type: literalSchema('extrude'),
            shape: arraySchema(vector2Schema('Closed 2D shape point [x, y].'), {
              minItems: 3,
            }),
            depth: positiveNumberSchema('Positive extrusion depth.'),
            bevelEnabled: booleanSchema('Whether beveling is enabled.'),
            bevelSize: positiveNumberSchema('Positive bevel size. Use 0.001 for nearly sharp edges.'),
            bevelThickness: positiveNumberSchema('Positive bevel thickness. Use 0.001 for nearly sharp edges.'),
            bevelSegments: integerSchema('Integer bevel segment count from 0 to 24.', {
              maximum: 24,
              minimum: 0,
            }),
          },
          [
            'type',
            'shape',
            'depth',
            'bevelEnabled',
            'bevelSize',
            'bevelThickness',
            'bevelSegments',
          ],
        ),
        objectSchema(
          {
            type: literalSchema('tube'),
            points: arraySchema(vector3Schema('Tube path point [x, y, z].'), {
              minItems: 2,
            }),
            radius: positiveNumberSchema('Positive tube radius.'),
            tubularSegments: segmentCountSchema(),
            radialSegments: segmentCountSchema(),
            closed: booleanSchema('Whether the tube path is closed.'),
          },
          [
            'type',
            'points',
            'radius',
            'tubularSegments',
            'radialSegments',
            'closed',
          ],
        ),
      ],
    },
    transform: transformSchema,
    materialId: stringSchema('Existing material id.'),
  },
  ['id', 'name', 'geometry', 'transform', 'materialId'],
)

const partSchema = objectSchema(
  {
    id: stringSchema('Stable part id.'),
    name: stringSchema('Human-readable part name.'),
    role: enumSchema([
      'base',
      'housing',
      'handle',
      'wheel',
      'hinge',
      'control',
      'decor',
      'support',
      'fastener',
      'mechanism',
    ]),
    description: stringSchema('Concise description of this part.'),
    visuals: arraySchema(visualSchema, { minItems: 1 }),
  },
  ['id', 'name', 'role', 'description', 'visuals'],
)

const fixedJointSchema = objectSchema(
  {
    id: stringSchema('Stable joint id.'),
    name: stringSchema('Human-readable joint name.'),
    type: literalSchema('fixed'),
    parentPartId: stringSchema('Existing parent part id.'),
    childPartId: stringSchema('Existing child part id.'),
    origin: transformSchema,
  },
  ['id', 'name', 'type', 'parentPartId', 'childPartId', 'origin'],
)

const limitedJointLimitsSchema = objectSchema(
  {
    lower: numberSchema('Lower joint limit.'),
    upper: numberSchema('Upper joint limit.'),
    effort: positiveNumberSchema('Positive effort value.'),
    velocity: positiveNumberSchema('Positive velocity value.'),
  },
  ['lower', 'upper', 'effort', 'velocity'],
)

const revoluteJointSchema = limitedJointSchema('revolute')
const prismaticJointSchema = limitedJointSchema('prismatic')

const continuousJointSchema = objectSchema(
  {
    id: stringSchema('Stable joint id.'),
    name: stringSchema('Human-readable joint name.'),
    type: literalSchema('continuous'),
    parentPartId: stringSchema('Existing parent part id.'),
    childPartId: stringSchema('Existing child part id.'),
    origin: transformSchema,
    axis: vector3Schema('Nonzero finite axis.'),
    limits: objectSchema(
      {
        effort: positiveNumberSchema('Positive effort value.'),
        velocity: positiveNumberSchema('Positive velocity value.'),
      },
      ['effort', 'velocity'],
    ),
  },
  [
    'id',
    'name',
    'type',
    'parentPartId',
    'childPartId',
    'origin',
    'axis',
    'limits',
  ],
)

const jointSchema = {
  anyOf: [
    fixedJointSchema,
    revoluteJointSchema,
    prismaticJointSchema,
    continuousJointSchema,
  ],
}

const poseSpecSchema = objectSchema(
  {
    name: stringSchema('Short pose name, for example open or extended.'),
    joints: arraySchema(
      objectSchema(
        {
          jointId: stringSchema('Existing movable joint id.'),
          value: numberSchema(
            'Joint value: radians for revolute/continuous, meters for prismatic.',
          ),
        },
        ['jointId', 'value'],
      ),
      { minItems: 1 },
    ),
  },
  ['name', 'joints'],
)

const checkSchema = {
  anyOf: [
    ...checkSchemaVariants(
      {
        type: literalSchema('part_exists'),
        partId: stringSchema('Existing part id.'),
      },
      ['type', 'partId'],
    ),
    ...checkSchemaVariants(
      {
        type: literalSchema('joint_exists'),
        jointId: stringSchema('Existing joint id.'),
        jointType: enumSchema(['fixed', 'revolute', 'prismatic', 'continuous']),
      },
      ['type', 'jointId', 'jointType'],
    ),
    ...checkSchemaVariants(
      {
        type: literalSchema('expect_contact'),
        partAId: stringSchema('Existing part id.'),
        partBId: stringSchema('Existing part id.'),
        visualAId: stringSchema('Existing visual id on part A.'),
        visualBId: stringSchema('Existing visual id on part B.'),
        contactTolerance: nonNegativeNumberSchema(
          'Nonnegative contact tolerance in meters.',
        ),
      },
      [
        'type',
        'partAId',
        'partBId',
        'visualAId',
        'visualBId',
        'contactTolerance',
      ],
    ),
    ...checkSchemaVariants(
      {
        type: literalSchema('expect_gap'),
        positivePartId: stringSchema('Existing part id.'),
        negativePartId: stringSchema('Existing part id.'),
        axis: enumSchema(['x', 'y', 'z']),
        minGap: numberSchema('Minimum expected gap in meters.'),
        maxGap: numberSchema('Maximum expected gap in meters.'),
        maxPenetration: nonNegativeNumberSchema(
          'Maximum allowed penetration in meters.',
        ),
        positiveVisualId: stringSchema('Existing visual id on positive part.'),
        negativeVisualId: stringSchema('Existing visual id on negative part.'),
      },
      [
        'type',
        'positivePartId',
        'negativePartId',
        'axis',
        'minGap',
        'maxGap',
        'maxPenetration',
        'positiveVisualId',
        'negativeVisualId',
      ],
    ),
    ...checkSchemaVariants(
      {
        type: literalSchema('expect_overlap'),
        partAId: stringSchema('Existing part id.'),
        partBId: stringSchema('Existing part id.'),
        axes: enumSchema(['x', 'y', 'z', 'xy', 'xz', 'yz', 'xyz']),
        minOverlap: nonNegativeNumberSchema('Minimum projected overlap in meters.'),
        visualAId: stringSchema('Existing visual id on part A.'),
        visualBId: stringSchema('Existing visual id on part B.'),
      },
      [
        'type',
        'partAId',
        'partBId',
        'axes',
        'minOverlap',
        'visualAId',
        'visualBId',
      ],
    ),
    ...checkSchemaVariants(
      {
        type: literalSchema('expect_within'),
        innerPartId: stringSchema('Existing inner part id.'),
        outerPartId: stringSchema('Existing outer part id.'),
        axes: enumSchema(['x', 'y', 'z', 'xy', 'xz', 'yz', 'xyz']),
        margin: nonNegativeNumberSchema('Containment margin in meters.'),
        innerVisualId: stringSchema('Existing visual id on inner part.'),
        outerVisualId: stringSchema('Existing visual id on outer part.'),
      },
      [
        'type',
        'innerPartId',
        'outerPartId',
        'axes',
        'margin',
        'innerVisualId',
        'outerVisualId',
      ],
    ),
  ],
}

const allowanceSchema = {
  anyOf: [
    objectSchema(
      {
        type: literalSchema('allow_overlap'),
        partAId: stringSchema('Existing part id.'),
        partBId: stringSchema('Existing part id.'),
        visualAId: stringSchema('Existing visual id on part A.'),
        visualBId: stringSchema('Existing visual id on part B.'),
        reason: stringSchema('Concrete reason this overlap is intentional.'),
      },
      ['type', 'partAId', 'partBId', 'visualAId', 'visualBId', 'reason'],
    ),
    objectSchema(
      {
        type: literalSchema('allow_isolated_part'),
        partId: stringSchema('Existing part id.'),
        reason: stringSchema('Concrete reason this part is intentionally isolated.'),
      },
      ['type', 'partId', 'reason'],
    ),
  ],
}

export const manifestAssetResponseFormatName = 'manifest3d_asset'

export const manifestAssetResponseJsonSchema = objectSchema(
  {
    schemaVersion: {
      type: 'integer',
      enum: [2],
    },
    id: stringSchema('Stable asset id.'),
    name: stringSchema('Human-readable asset name.'),
    prompt: stringSchema('Short prompt summary for this asset.'),
    units: {
      type: 'string',
      enum: ['meters'],
    },
    parts: arraySchema(partSchema, { minItems: 1 }),
    joints: arraySchema(jointSchema),
    materials: arraySchema(materialSchema, { minItems: 1 }),
    checks: arraySchema(checkSchema),
    allowances: arraySchema(allowanceSchema),
    metadata: objectSchema(
      {
        createdAt: dateTimeStringSchema('ISO-8601 datetime.'),
        updatedAt: dateTimeStringSchema('ISO-8601 datetime.'),
        sourceImageIds: arraySchema(stringSchema('Reference image id.')),
        generationStatus: {
          type: 'string',
          enum: ['ready'],
        },
      },
      ['createdAt', 'updatedAt', 'sourceImageIds', 'generationStatus'],
    ),
  },
  [
    'schemaVersion',
    'id',
    'name',
    'prompt',
    'units',
    'parts',
    'joints',
    'materials',
    'checks',
    'allowances',
    'metadata',
  ],
)

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

function checkSchemaVariants(
  properties: Record<string, JsonSchema>,
  required: readonly string[],
) {
  return [
    objectSchema(properties, required),
    objectSchema(
      {
        ...properties,
        pose: poseSpecSchema,
      },
      [...required, 'pose'],
    ),
  ]
}

function vector2Schema(description: string): JsonSchema {
  return arraySchema(numberSchema(description), { maxItems: 2, minItems: 2 })
}

function vector3Schema(description: string): JsonSchema {
  return arraySchema(numberSchema(description), { maxItems: 3, minItems: 3 })
}

function positiveVector3Schema(description: string): JsonSchema {
  return arraySchema(positiveNumberSchema(description), {
    maxItems: 3,
    minItems: 3,
  })
}

function literalSchema(value: string): JsonSchema {
  return {
    type: 'string',
    enum: [value],
  }
}

function enumSchema(values: readonly string[]): JsonSchema {
  return {
    type: 'string',
    enum: [...values],
  }
}

function stringSchema(description: string): JsonSchema {
  return {
    type: 'string',
    description,
  }
}

function dateTimeStringSchema(description: string): JsonSchema {
  return {
    ...stringSchema(description),
    format: 'date-time',
  }
}

function numberSchema(description: string): JsonSchema {
  return {
    type: 'number',
    description,
  }
}

function boundedNumberSchema(
  description: string,
  minimum: number,
  maximum: number,
): JsonSchema {
  return {
    ...numberSchema(description),
    maximum,
    minimum,
  }
}

function nonNegativeNumberSchema(description: string): JsonSchema {
  return {
    ...numberSchema(description),
    minimum: 0,
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
    ...(options.maximum !== undefined ? { maximum: options.maximum } : {}),
    ...(options.minimum !== undefined ? { minimum: options.minimum } : {}),
  }
}

function segmentCountSchema(): JsonSchema {
  return integerSchema('Integer segment count from 3 to 192.', {
    maximum: 192,
    minimum: 3,
  })
}

function booleanSchema(description: string): JsonSchema {
  return {
    type: 'boolean',
    description,
  }
}

function limitedJointSchema(type: 'revolute' | 'prismatic'): JsonSchema {
  return objectSchema(
    {
      id: stringSchema('Stable joint id.'),
      name: stringSchema('Human-readable joint name.'),
      type: literalSchema(type),
      parentPartId: stringSchema('Existing parent part id.'),
      childPartId: stringSchema('Existing child part id.'),
      origin: transformSchema,
      axis: vector3Schema('Nonzero finite axis.'),
      limits: limitedJointLimitsSchema,
    },
    [
      'id',
      'name',
      'type',
      'parentPartId',
      'childPartId',
      'origin',
      'axis',
      'limits',
    ],
  )
}
