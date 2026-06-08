/*
TS types are inferred from zod validation model
*/

import type { z } from 'zod'
import type {
  manifestAllowanceSchema,
  manifestAssetMetadataSchema,
  manifestAssetSchema,
  manifestAxesSchema,
  manifestAxisSchema,
  manifestCheckSchema,
  manifestGeometrySchema,
  manifestJointControlBindingSchema,
  manifestJointControlLimitsSchema,
  manifestJointControlSchema,
  manifestJointLimitsSchema,
  manifestJointPoseSchema,
  manifestJointSchema,
  manifestJointTypeSchema,
  manifestMaterialEmissionAnimationSchema,
  manifestMaterialEmissionInterpolationSchema,
  manifestMaterialEmissionKeyframeSchema,
  manifestMaterialEmissionSchema,
  manifestMaterialSchema,
  manifestMaterialSideSchema,
  manifestPartAttachmentSchema,
  manifestPartRoleSchema,
  manifestPartSchema,
  manifestPathContactTargetSchema,
  manifestPoseSpecSchema,
  manifestSceneSchema,
  manifestTransformSchema,
  manifestVector2Schema,
  manifestVector3Schema,
  manifestVisualSchema,
} from './manifestSchema'

// Public manifest types are derived from the canonical Zod schemas. Most of the
// app works with authorable manifest input shapes so legacy/defaultable fields
// such as material.side and asset.controls stay assignable before parsing.
export type ManifestVector3 = z.input<typeof manifestVector3Schema>
export type ManifestVector2 = z.input<typeof manifestVector2Schema>
export type ManifestAxis = z.input<typeof manifestAxisSchema>
export type ManifestAxes = z.input<typeof manifestAxesSchema>
export type ManifestTransform = z.input<typeof manifestTransformSchema>
export type ManifestPartAttachment = z.input<typeof manifestPartAttachmentSchema>
export type ManifestGeometry = z.input<typeof manifestGeometrySchema>
export type ManifestMaterialSide = z.input<typeof manifestMaterialSideSchema>
export type ManifestMaterialEmission = z.input<
  typeof manifestMaterialEmissionSchema
>
export type ManifestMaterialEmissionInterpolation = z.input<
  typeof manifestMaterialEmissionInterpolationSchema
>
export type ManifestMaterialEmissionKeyframe = z.input<
  typeof manifestMaterialEmissionKeyframeSchema
>
export type ManifestMaterialEmissionAnimation = z.input<
  typeof manifestMaterialEmissionAnimationSchema
>
export type ManifestMaterial = z.input<typeof manifestMaterialSchema>
export type ManifestVisual = z.input<typeof manifestVisualSchema>
export type ManifestPartRole = z.input<typeof manifestPartRoleSchema>
export type ManifestPart = z.input<typeof manifestPartSchema>
export type ManifestJointType = z.input<typeof manifestJointTypeSchema>
export type ManifestJointLimits = z.input<typeof manifestJointLimitsSchema>
export type ManifestJoint = z.input<typeof manifestJointSchema>
export type ManifestJointPose = z.input<typeof manifestJointPoseSchema>
export type ManifestJointControlBinding = z.input<
  typeof manifestJointControlBindingSchema
>
export type ManifestJointControlLimits = z.input<
  typeof manifestJointControlLimitsSchema
>
export type ManifestJointControl = z.input<typeof manifestJointControlSchema>
export type ManifestPoseSpec = Omit<
  z.input<typeof manifestPoseSpecSchema>,
  'joints'
> & {
  joints: readonly ManifestJointPose[]
}
export type ManifestPathContactTarget = z.input<
  typeof manifestPathContactTargetSchema
>
export type ManifestCheck = z.input<typeof manifestCheckSchema>
export type ManifestAllowance = z.input<typeof manifestAllowanceSchema>
export type ManifestAssetMetadata = z.input<typeof manifestAssetMetadataSchema>
export type ManifestAsset = Omit<
  z.input<typeof manifestAssetSchema>,
  'controls' | 'materials'
> & {
  controls: ManifestJointControl[]
  materials: ManifestMaterial[]
}
export type ManifestScene = Omit<
  z.input<typeof manifestSceneSchema>,
  'assets'
> & {
  assets: ManifestAsset[]
}

export type ParsedManifestAsset = z.output<typeof manifestAssetSchema>
export type ParsedManifestScene = z.output<typeof manifestSceneSchema>
