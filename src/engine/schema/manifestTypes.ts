export type ManifestVector3 = readonly [number, number, number]
export type ManifestVector2 = readonly [number, number]

export type ManifestAxis = 'x' | 'y' | 'z'
export type ManifestAxes = ManifestAxis | 'xy' | 'xz' | 'yz' | 'xyz'

export type ManifestTransform = {
  position?: ManifestVector3
  rotation?: ManifestVector3
  scale?: ManifestVector3
}

export type ManifestPartAttachment = {
  partId: string
  position: ManifestVector3
}

export type ManifestGeometry =
  | {
      type: 'box'
      size: ManifestVector3
    }
  | {
      type: 'roundedBox'
      size: ManifestVector3
      radius: number
      segments?: number
    }
  | {
      type: 'cylinder'
      radiusTop: number
      radiusBottom: number
      height: number
      radialSegments?: number
    }
  | {
      type: 'sphere'
      radius: number
      widthSegments?: number
      heightSegments?: number
    }
  | {
      type: 'torus'
      radius: number
      tube: number
      radialSegments?: number
      tubularSegments?: number
    }
  | {
      type: 'cone'
      radius: number
      height: number
      radialSegments?: number
    }
  | {
      type: 'capsule'
      radius: number
      height: number
      capSegments?: number
      radialSegments?: number
      heightSegments?: number
    }
  | {
      type: 'lathe'
      points: readonly ManifestVector2[]
      segments?: number
      phiStart?: number
      phiLength?: number
    }
  | {
      type: 'extrude'
      shape: readonly ManifestVector2[]
      depth: number
      bevelEnabled?: boolean
      bevelSize?: number
      bevelThickness?: number
      bevelSegments?: number
    }
  | {
      type: 'tube'
      points: readonly ManifestVector3[]
      radius: number
      tubularSegments?: number
      radialSegments?: number
      closed?: boolean
    }
  | {
      type: 'connectorTube'
      start: ManifestPartAttachment
      end: ManifestPartAttachment
      radius: number
      sag?: number
      tubularSegments?: number
      radialSegments?: number
    }

export type ManifestMaterialSide = 'front' | 'back' | 'double'

export type ManifestMaterial = {
  id: string
  name: string
  color: string
  metalness: number
  roughness: number
  opacity?: number
  side?: ManifestMaterialSide
  emission?: ManifestMaterialEmission | null
  emissionAnimation?: ManifestMaterialEmissionAnimation | null
}

export type ManifestMaterialEmission = {
  hasEmission: boolean
  color: string
  intensity: number
}

export type ManifestMaterialEmissionInterpolation = 'linear' | 'step'

export type ManifestMaterialEmissionKeyframe = ManifestMaterialEmission & {
  time: number
}

export type ManifestMaterialEmissionAnimation = {
  id: string
  name: string
  interpolation: ManifestMaterialEmissionInterpolation
  keyframes: ManifestMaterialEmissionKeyframe[]
  loop: boolean
}

export type ManifestVisual = {
  id: string
  name?: string
  geometry: ManifestGeometry
  transform: ManifestTransform
  materialId: string
}

export type ManifestPartRole =
  | 'base'
  | 'housing'
  | 'handle'
  | 'wheel'
  | 'hinge'
  | 'control'
  | 'decor'
  | 'support'
  | 'fastener'
  | 'mechanism'

export type ManifestPart = {
  id: string
  name: string
  role?: ManifestPartRole
  description?: string
  visuals: ManifestVisual[]
}

export type ManifestJointType = 'fixed' | 'revolute' | 'prismatic' | 'continuous'

export type ManifestJointLimits = {
  lower?: number
  upper?: number
  effort?: number
  velocity?: number
}

export type ManifestJoint = {
  id: string
  name: string
  type: ManifestJointType
  parentPartId: string
  childPartId: string
  origin: ManifestTransform
  axis?: ManifestVector3
  limits?: ManifestJointLimits
}

export type ManifestJointPose = {
  jointId: string
  value: number
}

export type ManifestJointControlBinding = {
  jointId: string
  scale: number
  offset: number
}

export type ManifestJointControlLimits = {
  lower: number
  upper: number
}

export type ManifestJointControl = {
  id: string
  name: string
  joints: ManifestJointControlBinding[]
  limits: ManifestJointControlLimits
}

export type ManifestPoseSpec = {
  name?: string
  joints: readonly ManifestJointPose[]
}

type ManifestCheckPoseField = {
  pose?: ManifestPoseSpec
}

export type ManifestCheck =
  | ({ type: 'part_exists'; partId: string } & ManifestCheckPoseField)
  | ({
      type: 'joint_exists'
      jointId: string
      jointType?: ManifestJointType
    } & ManifestCheckPoseField)
  | ({
      type: 'expect_material_side'
      visualId: string
      side: ManifestMaterialSide
    } & ManifestCheckPoseField)
  | ({
      type: 'expect_contact'
      partAId: string
      partBId: string
      visualAId?: string
      visualBId?: string
      contactTolerance?: number
      maxPenetration?: number
    } & ManifestCheckPoseField)
  | ({
      type: 'expect_gap'
      positivePartId: string
      negativePartId: string
      axis: ManifestAxis
      minGap?: number
      maxGap?: number
      maxPenetration?: number
      positiveVisualId?: string
      negativeVisualId?: string
    } & ManifestCheckPoseField)
  | ({
      type: 'expect_overlap'
      partAId: string
      partBId: string
      axes: ManifestAxes
      minOverlap?: number
      visualAId?: string
      visualBId?: string
    } & ManifestCheckPoseField)
  | ({
      type: 'expect_within'
      innerPartId: string
      outerPartId: string
      axes: ManifestAxes
      margin?: number
      innerVisualId?: string
      outerVisualId?: string
    } & ManifestCheckPoseField)

export type ManifestAllowance =
  | {
      type: 'allow_overlap'
      partAId: string
      partBId: string
      visualAId?: string
      visualBId?: string
      reason: string
    }
  | { type: 'allow_isolated_part'; partId: string; reason: string }

export type ManifestAssetMetadata = {
  createdAt: string
  updatedAt: string
  sourceImageIds: string[]
  generationStatus: 'draft' | 'validating' | 'ready' | 'failed'
}

export type ManifestAsset = {
  schemaVersion: 2
  id: string
  name: string
  prompt: string
  units: 'meters'
  parts: ManifestPart[]
  joints: ManifestJoint[]
  controls: ManifestJointControl[]
  materials: ManifestMaterial[]
  checks: ManifestCheck[]
  allowances: ManifestAllowance[]
  metadata: ManifestAssetMetadata
}

export type ManifestScene = {
  schemaVersion: 1
  units: 'meters'
  assets: ManifestAsset[]
}
