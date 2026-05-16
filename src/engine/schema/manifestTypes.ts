export type ManifestVector3 = readonly [number, number, number]

export type ManifestTransform = {
  position?: ManifestVector3
  rotation?: ManifestVector3
  scale?: ManifestVector3
}

export type ManifestPrimitiveGeometry =
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
  geometry: ManifestPrimitiveGeometry
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

export type ManifestAsset = {
  id: string
  name: string
  prompt: string
  parts: ManifestPart[]
  materials: ManifestMaterial[]
  metadata: {
    createdAt: string
    updatedAt: string
    sourceImageIds: string[]
    generationStatus: 'draft' | 'validating' | 'ready' | 'failed'
  }
}
