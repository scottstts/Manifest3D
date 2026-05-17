import * as THREE from 'three/webgpu'
import type {
  ManifestAsset,
  ManifestJoint,
  ManifestMaterial,
  ManifestPart,
  ManifestVisual,
} from '../schema/manifestTypes'
import { buildPrimitiveGeometry } from './primitiveBuilders'
import { boundsFromObject, unionBounds } from './bounds'
import {
  applyJointPosesToBuiltGroups,
  applyJointTransform,
  applyManifestTransform,
  type JointPoseValues,
} from './jointPoses'

export type ManifestObjectKind = 'asset' | 'part' | 'visual' | 'joint'

export type ManifestObjectUserData = {
  kind: ManifestObjectKind
  assetId: string
  partId?: string
  visualId?: string
  jointId?: string
}

export type BuiltManifestAsset = {
  asset: ManifestAsset
  bounds: THREE.Box3
  group: THREE.Group
  jointGroups: Map<string, THREE.Group>
  partBounds: Map<string, THREE.Box3>
  partGroups: Map<string, THREE.Group>
  visualBounds: Map<string, THREE.Box3>
  visualMeshes: Map<string, THREE.Mesh>
  visualPartIds: Map<string, string>
}

export type BuildManifestAssetOptions = {
  jointPoses?: JointPoseValues
}

export function buildManifestAsset(
  asset: ManifestAsset,
  options: BuildManifestAssetOptions = {},
): BuiltManifestAsset {
  const group = new THREE.Group()
  const materialById = buildMaterialMap(asset.materials)
  const partGroups = new Map<string, THREE.Group>()
  const visualMeshes = new Map<string, THREE.Mesh>()
  const visualPartIds = new Map<string, string>()
  const jointGroups = new Map<string, THREE.Group>()

  group.name = asset.name
  setManifestUserData(group, {
    kind: 'asset',
    assetId: asset.id,
  })

  for (const part of asset.parts) {
    const partGroup = buildPartGroup(
      asset,
      part,
      materialById,
      visualMeshes,
      visualPartIds,
    )

    partGroups.set(part.id, partGroup)
  }

  for (const joint of asset.joints) {
    const jointGroup = new THREE.Group()

    jointGroup.name = joint.name
    applyJointTransform(jointGroup, joint, options.jointPoses?.[joint.id])
    setManifestUserData(jointGroup, {
      kind: 'joint',
      assetId: asset.id,
      jointId: joint.id,
    })
    jointGroups.set(joint.id, jointGroup)
  }

  attachJointDrivenHierarchy(asset, group, partGroups, jointGroups)
  group.updateMatrixWorld(true)

  const visualBounds = new Map<string, THREE.Box3>()

  for (const [visualId, mesh] of visualMeshes) {
    visualBounds.set(visualId, boundsFromObject(mesh))
  }

  const partBounds = new Map<string, THREE.Box3>()

  for (const part of asset.parts) {
    const bounds = unionBounds(
      part.visuals
        .map((visual) => visualBounds.get(visual.id))
        .filter((bounds): bounds is THREE.Box3 => Boolean(bounds)),
    )

    partBounds.set(part.id, bounds)

    const partGroup = partGroups.get(part.id)

    if (partGroup) {
      partGroup.userData.manifest3dBounds = serializeBounds(bounds)
      partGroup.userData.manifest3dPartId = part.id
    }
  }

  const bounds = unionBounds(visualBounds.values())

  group.userData.manifest3dBounds = serializeBounds(bounds)

  return {
    asset,
    bounds,
    group,
    jointGroups,
    partBounds,
    partGroups,
    visualBounds,
    visualMeshes,
    visualPartIds,
  }
}

export function applyBuiltManifestJointPoses(
  builtAsset: BuiltManifestAsset,
  jointPoses: JointPoseValues,
) {
  applyJointPosesToBuiltGroups(builtAsset.asset, builtAsset.jointGroups, jointPoses)
  builtAsset.group.updateMatrixWorld(true)
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

function attachJointDrivenHierarchy(
  asset: ManifestAsset,
  assetGroup: THREE.Group,
  partGroups: Map<string, THREE.Group>,
  jointGroups: Map<string, THREE.Group>,
) {
  const partIds = new Set(asset.parts.map((part) => part.id))
  const childPartIds = new Set(asset.joints.map((joint) => joint.childPartId))
  const roots = asset.parts.filter((part) => !childPartIds.has(part.id))
  const jointsByParent = new Map<string, ManifestJoint[]>()

  for (const joint of asset.joints) {
    if (!partIds.has(joint.parentPartId) || !partIds.has(joint.childPartId)) {
      throw new Error(
        `Joint ${joint.id} references missing parent or child part.`,
      )
    }

    const joints = jointsByParent.get(joint.parentPartId) ?? []

    joints.push(joint)
    jointsByParent.set(joint.parentPartId, joints)
  }

  if (roots.length !== 1) {
    throw new Error(`Asset ${asset.id} must have exactly one root part.`)
  }

  const rootGroup = partGroups.get(roots[0].id)

  if (!rootGroup) {
    throw new Error(`Root part ${roots[0].id} was not built.`)
  }

  const attachedPartIds = new Set<string>([roots[0].id])

  assetGroup.add(rootGroup)
  attachChildren(roots[0].id, attachedPartIds, jointsByParent, partGroups, jointGroups)

  for (const part of asset.parts) {
    if (!attachedPartIds.has(part.id)) {
      throw new Error(`Part ${part.id} is unreachable from the root joint tree.`)
    }
  }
}

function attachChildren(
  parentPartId: string,
  attachedPartIds: Set<string>,
  jointsByParent: Map<string, ManifestJoint[]>,
  partGroups: Map<string, THREE.Group>,
  jointGroups: Map<string, THREE.Group>,
) {
  const parentGroup = partGroups.get(parentPartId)

  if (!parentGroup) {
    throw new Error(`Parent part ${parentPartId} was not built.`)
  }

  for (const joint of jointsByParent.get(parentPartId) ?? []) {
    if (attachedPartIds.has(joint.childPartId)) {
      throw new Error(`Joint tree cycle or duplicate child: ${joint.childPartId}.`)
    }

    const jointGroup = jointGroups.get(joint.id)
    const childGroup = partGroups.get(joint.childPartId)

    if (!jointGroup || !childGroup) {
      throw new Error(`Joint ${joint.id} could not attach its child part.`)
    }

    parentGroup.add(jointGroup)
    jointGroup.add(childGroup)
    attachedPartIds.add(joint.childPartId)
    attachChildren(
      joint.childPartId,
      attachedPartIds,
      jointsByParent,
      partGroups,
      jointGroups,
    )
  }
}

function buildPartGroup(
  asset: ManifestAsset,
  part: ManifestPart,
  materialById: Map<string, THREE.Material>,
  visualMeshes: Map<string, THREE.Mesh>,
  visualPartIds: Map<string, string>,
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
    visualPartIds.set(visual.id, part.id)
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

  mesh.name = visual.name ?? visual.id
  mesh.castShadow = true
  mesh.receiveShadow = true
  applyManifestTransform(mesh, visual.transform)
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
