export type ManifestVector3 = readonly [number, number, number]
export type ManifestVector2 = readonly [number, number]

export type ManifestTransform = {
  position?: ManifestVector3
  rotation?: ManifestVector3
  scale?: ManifestVector3
}

export type ManifestGeometry =
  | {
      type: 'box'
      size: ManifestVector3
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

export type ManifestMaterial = {
  id: string
  name: string
  color: string
  metalness: number
  roughness: number
  opacity?: number
}

export type ManifestVisual = {
  id: string
  geometry: ManifestGeometry
  transform: ManifestTransform
  materialId: string
}

export type ManifestPart = {
  id: string
  name: string
  parentId: string | null
  visuals: ManifestVisual[]
  role?: 'base' | 'housing' | 'handle' | 'wheel' | 'hinge' | 'control' | 'decor'
}

export type ManifestJointType = 'fixed' | 'revolute' | 'prismatic' | 'continuous'

export type ManifestJoint = {
  id: string
  name: string
  type: ManifestJointType
  parentPartId: string
  childPartId: string
  origin?: ManifestTransform
  axis?: ManifestVector3
  limits?: {
    lower?: number
    upper?: number
  }
}

export type ManifestTest =
  | { type: 'part_exists'; partName: string }
  | { type: 'joint_exists'; jointName: string; jointType?: ManifestJointType }
  | { type: 'part_count_min'; count: number }
  | { type: 'material_exists'; materialName: string }
  | {
      type: 'bbox_min'
      target: 'asset' | string
      axis: 'x' | 'y' | 'z'
      min: number
    }
  | { type: 'connected'; partA: string; partB: string }

export type ManifestAsset = {
  id: string
  name: string
  prompt: string
  parts: ManifestPart[]
  joints: ManifestJoint[]
  materials: ManifestMaterial[]
  tests: ManifestTest[]
  metadata: {
    createdAt: string
    updatedAt: string
    sourceImageIds: string[]
    generationStatus: 'draft' | 'validating' | 'ready' | 'failed'
  }
}

export type ManifestScene = {
  schemaVersion: 1
  units: 'meters'
  assets: ManifestAsset[]
}
