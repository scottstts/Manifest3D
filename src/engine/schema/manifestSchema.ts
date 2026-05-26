import { z } from 'zod'
import type { ManifestAsset, ManifestScene } from './manifestTypes'

const finiteNumber = z.number().finite()
const positiveNumber = finiteNumber.positive()
const nonNegativeNumber = finiteNumber.min(0)
const nonEmptyId = z.string().trim().min(1)
const segmentCount = z.number().int().min(3).max(192)
const roundedBoxSegmentCount = z.number().int().min(1).max(32)
const capsuleCapSegmentCount = z.number().int().min(1).max(64)
const capsuleHeightSegmentCount = z.number().int().min(1).max(64)
const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
const materialEmissionIntensity = finiteNumber.min(0).max(100)
const materialEmissionKeyframeTime = finiteNumber.min(0).max(120)

export const manifestVector2Schema = z.tuple([finiteNumber, finiteNumber])
export const manifestVector3Schema = z.tuple([
  finiteNumber,
  finiteNumber,
  finiteNumber,
])
const manifestPositiveVector3Schema = z.tuple([
  positiveNumber,
  positiveNumber,
  positiveNumber,
])
const manifestPartAttachmentSchema = z
  .object({
    partId: nonEmptyId,
    position: manifestVector3Schema,
  })
  .strict()

export const manifestTransformSchema = z
  .object({
    position: manifestVector3Schema.optional(),
    rotation: manifestVector3Schema.optional(),
    scale: manifestVector3Schema.optional(),
  })
  .strict()

export const manifestMaterialSideSchema = z.enum(['front', 'back', 'double'])

export const manifestGeometrySchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('box'),
      size: manifestPositiveVector3Schema,
    })
    .strict(),
  z
    .object({
      type: z.literal('roundedBox'),
      size: manifestPositiveVector3Schema,
      radius: positiveNumber,
      segments: roundedBoxSegmentCount.optional(),
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
      type: z.literal('capsule'),
      radius: positiveNumber,
      height: positiveNumber,
      capSegments: capsuleCapSegmentCount.optional(),
      radialSegments: segmentCount.optional(),
      heightSegments: capsuleHeightSegmentCount.optional(),
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
  z
    .object({
      type: z.literal('connectorTube'),
      start: manifestPartAttachmentSchema,
      end: manifestPartAttachmentSchema,
      radius: positiveNumber,
      sag: nonNegativeNumber.optional(),
      tubularSegments: segmentCount.optional(),
      radialSegments: segmentCount.optional(),
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
    side: manifestMaterialSideSchema.default('front'),
    emission: z
      .object({
        hasEmission: z.boolean(),
        color: hexColor,
        intensity: materialEmissionIntensity,
      })
      .strict()
      .nullable()
      .optional(),
    emissionAnimation: z
      .object({
        id: nonEmptyId,
        name: z.string().trim().min(1),
        interpolation: z.enum(['linear', 'step']),
        keyframes: z
          .array(
            z
              .object({
                time: materialEmissionKeyframeTime,
                hasEmission: z.boolean(),
                color: hexColor,
                intensity: materialEmissionIntensity,
              })
              .strict(),
          )
          .min(2),
        loop: z.boolean(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()

export const manifestVisualSchema = z
  .object({
    id: nonEmptyId,
    name: z.string().trim().min(1).optional(),
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
  'support',
  'fastener',
  'mechanism',
])

export const manifestPartSchema = z
  .object({
    id: nonEmptyId,
    name: z.string().trim().min(1),
    role: manifestPartRoleSchema.optional(),
    description: z.string().trim().min(1).optional(),
    visuals: z.array(manifestVisualSchema),
  })
  .strict()

export const manifestJointTypeSchema = z.enum([
  'fixed',
  'revolute',
  'prismatic',
  'continuous',
])

export const manifestJointLimitsSchema = z
  .object({
    lower: finiteNumber.optional(),
    upper: finiteNumber.optional(),
    effort: positiveNumber.optional(),
    velocity: positiveNumber.optional(),
  })
  .strict()

export const manifestJointSchema = z
  .object({
    id: nonEmptyId,
    name: z.string().trim().min(1),
    type: manifestJointTypeSchema,
    parentPartId: nonEmptyId,
    childPartId: nonEmptyId,
    origin: manifestTransformSchema,
    axis: manifestVector3Schema.optional(),
    limits: manifestJointLimitsSchema.optional(),
  })
  .strict()

export const manifestJointControlBindingSchema = z
  .object({
    jointId: nonEmptyId,
    scale: finiteNumber,
    offset: finiteNumber,
  })
  .strict()

export const manifestJointControlSchema = z
  .object({
    id: nonEmptyId,
    name: z.string().trim().min(1),
    joints: z.array(manifestJointControlBindingSchema).min(1),
    limits: z
      .object({
        lower: finiteNumber,
        upper: finiteNumber,
      })
      .strict(),
  })
  .strict()

const manifestAxesSchema = z.enum(['x', 'y', 'z', 'xy', 'xz', 'yz', 'xyz'])

export const manifestPoseSpecSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    joints: z
      .array(
        z
          .object({
            jointId: nonEmptyId,
            value: finiteNumber,
          })
          .strict(),
      )
      .min(1),
  })
  .strict()

const manifestCheckSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('part_exists'),
      partId: nonEmptyId,
      pose: manifestPoseSpecSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('joint_exists'),
      jointId: nonEmptyId,
      jointType: manifestJointTypeSchema.optional(),
      pose: manifestPoseSpecSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('expect_material_side'),
      visualId: nonEmptyId,
      side: manifestMaterialSideSchema,
      pose: manifestPoseSpecSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('expect_contact'),
      partAId: nonEmptyId,
      partBId: nonEmptyId,
      visualAId: nonEmptyId.optional(),
      visualBId: nonEmptyId.optional(),
      contactTolerance: nonNegativeNumber.optional(),
      pose: manifestPoseSpecSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('expect_gap'),
      positivePartId: nonEmptyId,
      negativePartId: nonEmptyId,
      axis: z.enum(['x', 'y', 'z']),
      minGap: finiteNumber.optional(),
      maxGap: finiteNumber.optional(),
      maxPenetration: nonNegativeNumber.optional(),
      positiveVisualId: nonEmptyId.optional(),
      negativeVisualId: nonEmptyId.optional(),
      pose: manifestPoseSpecSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('expect_overlap'),
      partAId: nonEmptyId,
      partBId: nonEmptyId,
      axes: manifestAxesSchema,
      minOverlap: nonNegativeNumber.optional(),
      visualAId: nonEmptyId.optional(),
      visualBId: nonEmptyId.optional(),
      pose: manifestPoseSpecSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('expect_within'),
      innerPartId: nonEmptyId,
      outerPartId: nonEmptyId,
      axes: manifestAxesSchema,
      margin: nonNegativeNumber.optional(),
      innerVisualId: nonEmptyId.optional(),
      outerVisualId: nonEmptyId.optional(),
      pose: manifestPoseSpecSchema.optional(),
    })
    .strict(),
])

const manifestAllowanceSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('allow_overlap'),
      partAId: nonEmptyId,
      partBId: nonEmptyId,
      visualAId: nonEmptyId.optional(),
      visualBId: nonEmptyId.optional(),
      reason: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('allow_isolated_part'),
      partId: nonEmptyId,
      reason: z.string().trim().min(1),
    })
    .strict(),
])

export const manifestAssetSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: nonEmptyId,
    name: z.string().trim().min(1),
    prompt: z.string(),
    units: z.literal('meters'),
    parts: z.array(manifestPartSchema).min(1),
    joints: z.array(manifestJointSchema),
    controls: z.array(manifestJointControlSchema).default([]),
    materials: z.array(manifestMaterialSchema).min(1),
    checks: z.array(manifestCheckSchema),
    allowances: z.array(manifestAllowanceSchema),
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

export function safeParseManifestAsset(candidate: unknown) {
  return manifestAssetSchema.safeParse(candidate)
}

export function parseManifestScene(candidate: unknown): ManifestScene {
  return manifestSceneSchema.parse(candidate) as ManifestScene
}

export function safeParseManifestScene(candidate: unknown) {
  return manifestSceneSchema.safeParse(candidate)
}
