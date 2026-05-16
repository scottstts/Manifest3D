import * as THREE from 'three/webgpu'
import type {
  ManifestAsset,
  ManifestMaterial,
  ManifestPart,
  ManifestTransform,
  ManifestVisual,
} from '../schema/manifestTypes'
import { buildPrimitiveGeometry } from './primitiveBuilders'

export type ManifestObjectKind = 'asset' | 'part' | 'visual'

export type ManifestObjectUserData = {
  kind: ManifestObjectKind
  assetId: string
  partId?: string
  visualId?: string
}

export type BuiltManifestAsset = {
  asset: ManifestAsset
  bounds: THREE.Box3
  group: THREE.Group
  partGroups: Map<string, THREE.Group>
  visualMeshes: Map<string, THREE.Mesh>
}

export function buildManifestAsset(asset: ManifestAsset): BuiltManifestAsset {
  const group = new THREE.Group()
  const materialById = buildMaterialMap(asset.materials)
  const partGroups = new Map<string, THREE.Group>()
  const visualMeshes = new Map<string, THREE.Mesh>()

  group.name = asset.name
  setManifestUserData(group, {
    kind: 'asset',
    assetId: asset.id,
  })

  for (const part of asset.parts) {
    const partGroup = buildPartGroup(asset, part, materialById, visualMeshes)

    partGroups.set(part.id, partGroup)
  }

  for (const part of asset.parts) {
    const partGroup = partGroups.get(part.id)

    if (!partGroup) {
      throw new Error(`Part ${part.id} was not built.`)
    }

    if (part.parentId === null) {
      group.add(partGroup)
      continue
    }

    const parentGroup = partGroups.get(part.parentId)

    if (!parentGroup) {
      throw new Error(
        `Part ${part.id} references missing parent ${part.parentId}.`,
      )
    }

    parentGroup.add(partGroup)
  }

  group.updateMatrixWorld(true)

  const bounds = new THREE.Box3().setFromObject(group)
  group.userData.manifest3dBounds = serializeBounds(bounds)

  for (const [partId, partGroup] of partGroups) {
    partGroup.userData.manifest3dBounds = serializeBounds(
      new THREE.Box3().setFromObject(partGroup),
    )
    partGroup.userData.manifest3dPartId = partId
  }

  return {
    asset,
    bounds,
    group,
    partGroups,
    visualMeshes,
  }
}

export function findManifestObjectData(
  object: THREE.Object3D,
): ManifestObjectUserData | null {
  let current: THREE.Object3D | null = object

  while (current) {
    const data = current.userData.manifest3d as
      | ManifestObjectUserData
      | undefined

    if (data) {
      return data
    }

    current = current.parent
  }

  return null
}

export function disposeManifestObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()

  object.traverse((child) => {
    if (!isMesh(child)) {
      return
    }

    geometries.add(child.geometry)

    if (Array.isArray(child.material)) {
      for (const material of child.material) {
        materials.add(material)
      }
    } else {
      materials.add(child.material)
    }
  })

  for (const geometry of geometries) {
    geometry.dispose()
  }

  for (const material of materials) {
    material.dispose()
  }
}

function buildPartGroup(
  asset: ManifestAsset,
  part: ManifestPart,
  materialById: Map<string, THREE.Material>,
  visualMeshes: Map<string, THREE.Mesh>,
) {
  const partGroup = new THREE.Group()

  partGroup.name = part.name
  setManifestUserData(partGroup, {
    kind: 'part',
    assetId: asset.id,
    partId: part.id,
  })

  for (const visual of part.visuals) {
    const mesh = buildVisualMesh(asset, part, visual, materialById)

    visualMeshes.set(visual.id, mesh)
    partGroup.add(mesh)
  }

  return partGroup
}

function buildVisualMesh(
  asset: ManifestAsset,
  part: ManifestPart,
  visual: ManifestVisual,
  materialById: Map<string, THREE.Material>,
) {
  const material = materialById.get(visual.materialId)

  if (!material) {
    throw new Error(
      `Visual ${visual.id} references missing material ${visual.materialId}.`,
    )
  }

  const mesh = new THREE.Mesh(buildPrimitiveGeometry(visual.geometry), material)

  mesh.name = visual.id
  mesh.castShadow = true
  mesh.receiveShadow = true
  applyTransform(mesh, visual.transform)
  setManifestUserData(mesh, {
    kind: 'visual',
    assetId: asset.id,
    partId: part.id,
    visualId: visual.id,
  })

  return mesh
}

function buildMaterialMap(materials: readonly ManifestMaterial[]) {
  const materialById = new Map<string, THREE.Material>()

  for (const material of materials) {
    materialById.set(material.id, createMaterial(material))
  }

  return materialById
}

function createMaterial(material: ManifestMaterial) {
  const opacity = material.opacity ?? 1

  return new THREE.MeshStandardNodeMaterial({
    color: material.color,
    metalness: material.metalness,
    opacity,
    roughness: material.roughness,
    transparent: opacity < 1,
  })
}

function applyTransform(object: THREE.Object3D, transform: ManifestTransform) {
  object.position.fromArray(transform.position ?? [0, 0, 0])
  object.rotation.set(...(transform.rotation ?? [0, 0, 0]))
  object.scale.fromArray(transform.scale ?? [1, 1, 1])
}

function setManifestUserData(
  object: THREE.Object3D,
  data: ManifestObjectUserData,
) {
  object.userData.manifest3d = data
}

function serializeBounds(bounds: THREE.Box3) {
  return {
    max: bounds.max.toArray(),
    min: bounds.min.toArray(),
  }
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true
}
