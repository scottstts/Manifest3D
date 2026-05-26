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
  allowedContactPartIds?: readonly string[]
  bounds: THREE.Box3
  partId: string
  visualId: string
}

type EndpointContactPartIds = {
  end?: string
  start?: string
}

const maxPolylineProxyLengthMeters = 0.08
const maxPolylineProxySubdivisions = 96
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
        proxyA.partId === proxyB.partId ||
        isAllowedConnectorEndpointContact(proxyA, proxyB)
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
      builtAsset,
      geometry: visual.geometry,
      mesh,
      partId,
      visualId,
    })
  })
}

function createGeometryOverlapProxies({
  bounds,
  builtAsset,
  geometry,
  mesh,
  partId,
  visualId,
}: {
  bounds: THREE.Box3
  builtAsset: BuiltManifestAsset
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
	    case 'connectorTube': {
	      const connector = builtAsset.connectorVisuals.find(
	        (candidate) => candidate.visualId === visualId,
	      )
	
	      return createPolylineOverlapProxies({
	        closed: false,
	        endpointContactPartIds: {
	          end: geometry.end.partId,
	          start: geometry.start.partId,
	        },
	        points: connector?.centerlinePoints ?? [],
	        radius: geometry.radius,
	        mesh,
        partId,
        visualId,
      })
    }
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
  endpointContactPartIds,
  points,
  radius,
  mesh,
  partId,
  visualId,
}: {
  closed: boolean
  endpointContactPartIds?: EndpointContactPartIds
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
	  const subdivisions = getPolylineProxySubdivisionCount(start, end)

	  for (let subdivision = 0; subdivision < subdivisions; subdivision += 1) {
	    const subStart = start.clone().lerp(end, subdivision / subdivisions)
	    const subEnd = start.clone().lerp(end, (subdivision + 1) / subdivisions)
	    const bounds = new THREE.Box3().setFromPoints([subStart, subEnd])
	    const allowedContactPartIds = getPolylineProxyEndpointContactPartIds({
	      closed,
	      endpointContactPartIds,
	      segmentCount,
	      segmentIndex: index,
	      subdivision,
	      subdivisions,
	    })

	    bounds.expandByScalar(worldRadius)
	    proxies.push({
	      ...(allowedContactPartIds.length > 0 ? { allowedContactPartIds } : {}),
	      bounds,
	      partId,
	      visualId,
	    })
	  }
	}
	
	return proxies
}

function isAllowedConnectorEndpointContact(
  left: VisualOverlapProxy,
  right: VisualOverlapProxy,
) {
  return (
    left.allowedContactPartIds?.includes(right.partId) === true ||
    right.allowedContactPartIds?.includes(left.partId) === true
  )
}

function getPolylineProxySubdivisionCount(
  start: THREE.Vector3,
  end: THREE.Vector3,
) {
  const length = start.distanceTo(end)

  if (!Number.isFinite(length) || length <= maxPolylineProxyLengthMeters) {
    return 1
  }

  return Math.min(
    maxPolylineProxySubdivisions,
    Math.ceil(length / maxPolylineProxyLengthMeters),
  )
}

function getPolylineProxyEndpointContactPartIds({
  closed,
  endpointContactPartIds,
  segmentCount,
  segmentIndex,
  subdivision,
  subdivisions,
}: {
  closed: boolean
  endpointContactPartIds?: EndpointContactPartIds
  segmentCount: number
  segmentIndex: number
  subdivision: number
  subdivisions: number
}) {
  if (closed || !endpointContactPartIds) {
    return []
  }

  const partIds: string[] = []

  if (segmentIndex === 0 && subdivision === 0 && endpointContactPartIds.start) {
    partIds.push(endpointContactPartIds.start)
  }

  if (
    segmentIndex === segmentCount - 1 &&
    subdivision === subdivisions - 1 &&
    endpointContactPartIds.end
  ) {
    partIds.push(endpointContactPartIds.end)
  }

  return partIds
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
