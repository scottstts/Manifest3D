import { z } from 'zod'
import type { ManifestAsset, ManifestScene } from './manifestTypes'

const finiteNumber = z.number().finite()
const positiveNumber = finiteNumber.positive()
const nonEmptyId = z.string().trim().min(1)
const segmentCount = z.number().int().min(3).max(192)
const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)

export const manifestVector2Schema = z.tuple([finiteNumber, finiteNumber])
export const manifestVector3Schema = z.tuple([
  finiteNumber,
  finiteNumber,
  finiteNumber,
])

export const manifestTransformSchema = z
  .object({
    position: manifestVector3Schema.optional(),
    rotation: manifestVector3Schema.optional(),
    scale: manifestVector3Schema.optional(),
  })
  .strict()

export const manifestGeometrySchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('box'),
      size: manifestVector3Schema,
    })
    .strict(),
  z
    .object({
      type: z.literal('cylinder'),
      radiusTop: positiveNumber,
      radiusBottom: positiveNumber,
      height: positiveNumber,
      radialSegments: segmentCount.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('sphere'),
      radius: positiveNumber,
      widthSegments: segmentCount.optional(),
      heightSegments: segmentCount.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('torus'),
      radius: positiveNumber,
      tube: positiveNumber,
      radialSegments: segmentCount.optional(),
      tubularSegments: segmentCount.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('cone'),
      radius: positiveNumber,
      height: positiveNumber,
      radialSegments: segmentCount.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('lathe'),
      points: z.array(manifestVector2Schema).min(2),
      segments: segmentCount.optional(),
      phiStart: finiteNumber.optional(),
      phiLength: positiveNumber.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('extrude'),
      shape: z.array(manifestVector2Schema).min(3),
      depth: positiveNumber,
      bevelEnabled: z.boolean().optional(),
      bevelSize: positiveNumber.optional(),
      bevelThickness: positiveNumber.optional(),
      bevelSegments: z.number().int().min(0).max(24).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('tube'),
      points: z.array(manifestVector3Schema).min(2),
      radius: positiveNumber,
      tubularSegments: segmentCount.optional(),
      radialSegments: segmentCount.optional(),
      closed: z.boolean().optional(),
    })
    .strict(),
])

export const manifestMaterialSchema = z
  .object({
    id: nonEmptyId,
    name: z.string().trim().min(1),
    color: hexColor,
    metalness: finiteNumber.min(0).max(1),
    roughness: finiteNumber.min(0).max(1),
    opacity: finiteNumber.min(0).max(1).optional(),
  })
  .strict()

export const manifestVisualSchema = z
  .object({
    id: nonEmptyId,
    geometry: manifestGeometrySchema,
    transform: manifestTransformSchema,
    materialId: nonEmptyId,
  })
  .strict()

export const manifestPartRoleSchema = z.enum([
  'base',
  'housing',
  'handle',
  'wheel',
  'hinge',
  'control',
  'decor',
])

export const manifestPartSchema = z
  .object({
    id: nonEmptyId,
    name: z.string().trim().min(1),
    parentId: nonEmptyId.nullable(),
    visuals: z.array(manifestVisualSchema),
    role: manifestPartRoleSchema.optional(),
  })
  .strict()

export const manifestJointTypeSchema = z.enum([
  'fixed',
  'revolute',
  'prismatic',
  'continuous',
])

export const manifestJointSchema = z
  .object({
    id: nonEmptyId,
    name: z.string().trim().min(1),
    type: manifestJointTypeSchema,
    parentPartId: nonEmptyId,
    childPartId: nonEmptyId,
    origin: manifestTransformSchema.optional(),
    axis: manifestVector3Schema.optional(),
    limits: z
      .object({
        lower: finiteNumber.optional(),
        upper: finiteNumber.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const promptTestSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('part_exists'),
      partName: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('joint_exists'),
      jointName: z.string().trim().min(1),
      jointType: manifestJointTypeSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('part_count_min'),
      count: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('material_exists'),
      materialName: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('bbox_min'),
      target: z.string().trim().min(1),
      axis: z.enum(['x', 'y', 'z']),
      min: positiveNumber,
    })
    .strict(),
  z
    .object({
      type: z.literal('connected'),
      partA: z.string().trim().min(1),
      partB: z.string().trim().min(1),
    })
    .strict(),
])

export const manifestAssetSchema = z
  .object({
    id: nonEmptyId,
    name: z.string().trim().min(1),
    prompt: z.string(),
    parts: z.array(manifestPartSchema).min(1),
    joints: z.array(manifestJointSchema),
    materials: z.array(manifestMaterialSchema).min(1),
    tests: z.array(promptTestSchema),
    metadata: z
      .object({
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
        sourceImageIds: z.array(z.string()),
        generationStatus: z.enum(['draft', 'validating', 'ready', 'failed']),
      })
      .strict(),
  })
  .strict()

export const manifestSceneSchema = z
  .object({
    schemaVersion: z.literal(1),
    units: z.literal('meters'),
    assets: z.array(manifestAssetSchema),
  })
  .strict()

export function parseManifestAsset(candidate: unknown): ManifestAsset {
  return manifestAssetSchema.parse(candidate) as ManifestAsset
}

export function parseManifestScene(candidate: unknown): ManifestScene {
  return manifestSceneSchema.parse(candidate) as ManifestScene
}

export function safeParseManifestScene(candidate: unknown) {
  return manifestSceneSchema.safeParse(candidate)
}
