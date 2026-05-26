import * as THREE from 'three/webgpu'
import type { BuiltManifestAsset } from '../geometry/assetBuilder'
import { getNormalizedJointAxis } from '../geometry/jointPoses'
import type {
  ManifestAsset,
  ManifestGeometry,
  ManifestVector3,
} from '../schema/manifestTypes'

export type BoundsProbe = {
  center: ManifestVector3
  max: ManifestVector3
  min: ManifestVector3
  size: ManifestVector3
}

export type PartProbe = {
  bounds: BoundsProbe | null
  id: string
  name: string
  role: string | null
  visualCount: number
}

export type JointProbe = {
  axis: ManifestVector3 | null
  childDistanceToOrigin: number | null
  childPartId: string
  id: string
  originWorld: ManifestVector3 | null
  parentDistanceToOrigin: number | null
  parentPartId: string
  type: string
}

export type ConnectorProbe = {
  endPartId: string
  endWorld: ManifestVector3 | null
  id: string
  length: number | null
  ownerPartId: string
  radius: number
  startPartId: string
  startWorld: ManifestVector3 | null
}

export type ManifestProbeReport = {
  assetBounds: BoundsProbe | null
  assetId: string
  assetName: string
  connectors: ConnectorProbe[]
  joints: JointProbe[]
  parts: PartProbe[]
}

export function createManifestProbeReport(
  asset: ManifestAsset,
  builtAsset: BuiltManifestAsset,
): ManifestProbeReport {
  return {
    assetBounds: serializeBounds(builtAsset.bounds),
    assetId: asset.id,
    assetName: asset.name,
    connectors: createConnectorProbes(asset, builtAsset),
    joints: createJointProbes(asset, builtAsset),
    parts: asset.parts.map((part) => ({
      bounds: serializeBounds(builtAsset.partBounds.get(part.id) ?? null),
      id: part.id,
      name: part.name,
      role: part.role ?? null,
      visualCount: part.visuals.length,
    })),
  }
}

function createJointProbes(
  asset: ManifestAsset,
  builtAsset: BuiltManifestAsset,
): JointProbe[] {
  return asset.joints.map((joint) => {
    const jointGroup = builtAsset.jointGroups.get(joint.id)
    const originWorld = jointGroup
      ? jointGroup.localToWorld(new THREE.Vector3(0, 0, 0))
      : null
    const parentBounds = builtAsset.partBounds.get(joint.parentPartId)
    const childBounds = builtAsset.partBounds.get(joint.childPartId)
    const axis = getNormalizedJointAxis(joint)

    return {
      axis: axis ? serializeVector(axis) : null,
      childDistanceToOrigin:
        originWorld && childBounds ? roundMetric(childBounds.distanceToPoint(originWorld)) : null,
      childPartId: joint.childPartId,
      id: joint.id,
      originWorld: originWorld ? serializeVector(originWorld) : null,
      parentDistanceToOrigin:
        originWorld && parentBounds ? roundMetric(parentBounds.distanceToPoint(originWorld)) : null,
      parentPartId: joint.parentPartId,
      type: joint.type,
    }
  })
}

function createConnectorProbes(
  asset: ManifestAsset,
  builtAsset: BuiltManifestAsset,
): ConnectorProbe[] {
  const probes: ConnectorProbe[] = []

  for (const part of asset.parts) {
    for (const visual of part.visuals) {
      if (!isConnectorGeometry(visual.geometry)) {
        continue
      }

      const startWorld = resolveLocalPointWorld(
        builtAsset,
        visual.geometry.start.partId,
        visual.geometry.start.position,
      )
      const endWorld = resolveLocalPointWorld(
        builtAsset,
        visual.geometry.end.partId,
        visual.geometry.end.position,
      )

      probes.push({
        endPartId: visual.geometry.end.partId,
        endWorld: endWorld ? serializeVector(endWorld) : null,
        id: visual.id,
        length: startWorld && endWorld ? roundMetric(startWorld.distanceTo(endWorld)) : null,
        ownerPartId: part.id,
        radius: visual.geometry.radius,
        startPartId: visual.geometry.start.partId,
        startWorld: startWorld ? serializeVector(startWorld) : null,
      })
    }
  }

  return probes
}

function resolveLocalPointWorld(
  builtAsset: BuiltManifestAsset,
  partId: string,
  position: ManifestVector3,
) {
  const group = builtAsset.partGroups.get(partId)

  return group
    ? group.localToWorld(new THREE.Vector3(...position))
    : null
}

function serializeBounds(bounds: THREE.Box3 | null): BoundsProbe | null {
  if (!bounds || bounds.isEmpty()) {
    return null
  }

  const center = new THREE.Vector3()
  const size = new THREE.Vector3()

  bounds.getCenter(center)
  bounds.getSize(size)

  return {
    center: serializeVector(center),
    max: serializeVector(bounds.max),
    min: serializeVector(bounds.min),
    size: serializeVector(size),
  }
}

function serializeVector(vector: THREE.Vector3): ManifestVector3 {
  return [
    roundMetric(vector.x),
    roundMetric(vector.y),
    roundMetric(vector.z),
  ]
}

function roundMetric(value: number) {
  return Number(value.toFixed(5))
}

function isConnectorGeometry(
  geometry: ManifestGeometry,
): geometry is Extract<ManifestGeometry, { type: 'connectorTube' }> {
  return geometry.type === 'connectorTube'
}
