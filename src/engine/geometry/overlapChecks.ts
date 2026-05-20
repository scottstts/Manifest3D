import * as THREE from 'three/webgpu'
import type { BuiltManifestAsset } from './assetBuilder'
import type { ManifestGeometry, ManifestVisual } from '../schema/manifestTypes'
import {
  boxesOverlap,
  getOverlapDepth,
  getPositiveOverlapVolume,
} from './measurements'

export type GeometryOverlapFinding = {
  partAId: string
  partBId: string
  visualAId: string
  visualBId: string
  depth: THREE.Vector3
  volume: number
}

type VisualOverlapProxy = {
  bounds: THREE.Box3
  partId: string
  visualId: string
}

const torusProxySegments = 48

export function findCurrentPoseVisualOverlaps(
  builtAsset: BuiltManifestAsset,
  options: {
    overlapTolerance: number
    volumeTolerance: number
  },
): GeometryOverlapFinding[] {
  const proxies = createVisualOverlapProxies(builtAsset)
  const findingsByPair = new Map<string, GeometryOverlapFinding>()

  for (let indexA = 0; indexA < proxies.length; indexA += 1) {
    const proxyA = proxies[indexA]

    for (let indexB = indexA + 1; indexB < proxies.length; indexB += 1) {
      const proxyB = proxies[indexB]

      if (
        proxyA.visualId === proxyB.visualId ||
        proxyA.partId === proxyB.partId
      ) {
        continue
      }

      if (!boxesOverlap(proxyA.bounds, proxyB.bounds, options.overlapTolerance)) {
        continue
      }

      const volume = getPositiveOverlapVolume(proxyA.bounds, proxyB.bounds)

      if (volume <= options.volumeTolerance) {
        continue
      }

      const finding = {
        depth: getOverlapDepth(proxyA.bounds, proxyB.bounds),
        partAId: proxyA.partId,
        partBId: proxyB.partId,
        visualAId: proxyA.visualId,
        visualBId: proxyB.visualId,
        volume,
      }
      const pairKey = getVisualPairKey(finding)
      const existingFinding = findingsByPair.get(pairKey)

      if (!existingFinding || finding.volume > existingFinding.volume) {
        findingsByPair.set(pairKey, finding)
      }
    }
  }

  return [...findingsByPair.values()]
}

function createVisualOverlapProxies(
  builtAsset: BuiltManifestAsset,
): VisualOverlapProxy[] {
  const visualsById = new Map<string, ManifestVisual>()

  for (const part of builtAsset.asset.parts) {
    for (const visual of part.visuals) {
      visualsById.set(visual.id, visual)
    }
  }

  return [...builtAsset.visualBounds.entries()].flatMap(([visualId, bounds]) => {
    const partId = builtAsset.visualPartIds.get(visualId)

    if (!partId) {
      return []
    }

    const mesh = builtAsset.visualMeshes.get(visualId)
    const visual = visualsById.get(visualId)

    if (!mesh || !visual) {
      return [
        {
          bounds,
          partId,
          visualId,
        },
      ]
    }

    return createGeometryOverlapProxies({
      bounds,
      geometry: visual.geometry,
      mesh,
      partId,
      visualId,
    })
  })
}

function createGeometryOverlapProxies({
  bounds,
  geometry,
  mesh,
  partId,
  visualId,
}: {
  bounds: THREE.Box3
  geometry: ManifestGeometry
  mesh: THREE.Object3D
  partId: string
  visualId: string
}): VisualOverlapProxy[] {
  switch (geometry.type) {
    case 'torus':
      return createPolylineOverlapProxies({
        closed: true,
        points: createTorusPolylinePoints(geometry.radius, torusProxySegments),
        radius: geometry.tube,
        mesh,
        partId,
        visualId,
      })
    case 'tube':
      return createPolylineOverlapProxies({
        closed: geometry.closed ?? false,
        points: geometry.points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
        radius: geometry.radius,
        mesh,
        partId,
        visualId,
      })
    default:
      return [
        {
          bounds,
          partId,
          visualId,
        },
      ]
  }
}

function createPolylineOverlapProxies({
  closed,
  points,
  radius,
  mesh,
  partId,
  visualId,
}: {
  closed: boolean
  points: readonly THREE.Vector3[]
  radius: number
  mesh: THREE.Object3D
  partId: string
  visualId: string
}): VisualOverlapProxy[] {
  if (points.length < 2) {
    return []
  }

  const worldScale = new THREE.Vector3()
  mesh.getWorldScale(worldScale)
  const worldRadius = radius * Math.max(worldScale.x, worldScale.y, worldScale.z)
  const segmentCount = closed ? points.length : points.length - 1
  const proxies: VisualOverlapProxy[] = []

  for (let index = 0; index < segmentCount; index += 1) {
    const start = points[index].clone().applyMatrix4(mesh.matrixWorld)
    const end = points[(index + 1) % points.length]
      .clone()
      .applyMatrix4(mesh.matrixWorld)
    const bounds = new THREE.Box3().setFromPoints([start, end])

    bounds.expandByScalar(worldRadius)
    proxies.push({
      bounds,
      partId,
      visualId,
    })
  }

  return proxies
}

function createTorusPolylinePoints(radius: number, segments: number) {
  return Array.from({ length: segments }, (_, index) => {
    const angle = index / segments * Math.PI * 2

    return new THREE.Vector3(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      0,
    )
  })
}

function getVisualPairKey(finding: GeometryOverlapFinding) {
  return [finding.visualAId, finding.visualBId].sort().join('|')
}
