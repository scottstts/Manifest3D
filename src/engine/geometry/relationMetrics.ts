import * as THREE from 'three/webgpu'
import type { BuiltManifestAsset } from './assetBuilder'
import {
  boxDistance,
  boxesOverlap,
  getOverlapDepth,
  getPositiveOverlapVolume,
} from './measurements'
import {
  createMeshRelationIndex,
  type MeshRelationIndex,
  type MeshRelationOptions,
} from './meshRelations'
import type { ManifestGeometry, ManifestVisual } from '../schema/manifestTypes'

export type VisualRelationProxy = {
  allowedContactPartIds?: readonly string[]
  bounds: THREE.Box3
  partId: string
  visualId: string
}

export type VisualPairRelation = {
  distance: number
  maxOverlapDepth: number
  overlapDepth: THREE.Vector3
  overlapVolume: number
  penetrationDepth: number
  partAId: string
  partBId: string
  visualAId: string
  visualBId: string
}

export type VisualRelationPairCandidate = {
  partAId: string
  partBId: string
  visualAId: string
  visualBId: string
}

export type VisualRelationOptions = {
  meshRelationIndex?: MeshRelationIndex
  proxies?: readonly VisualRelationProxy[]
  shouldConsiderPair?: (pair: VisualRelationPairCandidate) => boolean
}

type EndpointContactPartIds = {
  end?: string
  start?: string
}

const maxPolylineProxyLengthMeters = 0.08
const maxPolylineProxySubdivisions = 96
const maxSolidProxyLengthMeters = 0.16
const maxSolidProxySubdivisions = 32
const latheSurfaceProxyThicknessMeters = 0.003
const minLatheAngularProxySegments = 8
const maxLatheAngularProxyLengthMeters = 0.12
const maxLatheAngularProxySegments = 32
const meshDistanceRefineDistanceMeters = 0.12
const fullLatheSweep = Math.PI * 2
const latheSweepEpsilon = 0.0001
const latheAxisEpsilon = 0.000001
const torusProxySegments = 48

export function createVisualRelationProxies(
  builtAsset: BuiltManifestAsset,
): VisualRelationProxy[] {
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

    return createGeometryRelationProxies({
      bounds,
      builtAsset,
      geometry: visual.geometry,
      mesh,
      partId,
      visualId,
    })
  })
}

export function findClosestVisualRelation(
  builtAsset: BuiltManifestAsset,
  target: {
    partAId: string
    partBId: string
    visualAId?: string
    visualBId?: string
  },
  options: VisualRelationOptions = {},
): VisualPairRelation | null {
  const relations = findVisualRelations(builtAsset, {
    partAId: target.partAId,
    partBId: target.partBId,
    visualAId: target.visualAId,
    visualBId: target.visualBId,
  }, options)

  return relations.reduce<VisualPairRelation | null>((closest, relation) => {
    if (!closest) {
      return relation
    }

    if (relation.distance !== closest.distance) {
      return relation.distance < closest.distance ? relation : closest
    }

    return relation.overlapVolume > closest.overlapVolume ? relation : closest
  }, null)
}

export function findVisualRelations(
  builtAsset: BuiltManifestAsset,
  target: {
    partAId: string
    partBId: string
    visualAId?: string
    visualBId?: string
  },
  options: VisualRelationOptions = {},
): VisualPairRelation[] {
  const proxies = options.proxies ?? createVisualRelationProxies(builtAsset)
  const leftProxies = proxies.filter(
    (proxy) =>
      proxy.partId === target.partAId &&
      (!target.visualAId || proxy.visualId === target.visualAId),
  )
  const rightProxies = proxies.filter(
    (proxy) =>
      proxy.partId === target.partBId &&
      (!target.visualBId || proxy.visualId === target.visualBId),
  )
  const relationsByVisualPair = new Map<string, VisualPairRelation>()
  const meshRelationIndex = options.meshRelationIndex ?? createMeshRelationIndex(builtAsset)

  try {
    for (const left of leftProxies) {
      for (const right of rightProxies) {
        if (
          left.visualId === right.visualId ||
          isAllowedConnectorEndpointContact(left, right)
        ) {
          continue
        }

        if (!shouldConsiderVisualPair(left, right, options.shouldConsiderPair)) {
          continue
        }

        const relation = refineRelationWithMesh(
          createProxyRelation(left, right),
          meshRelationIndex,
        )
        const key = getVisualPairKey(relation)
        const existing = relationsByVisualPair.get(key)

        if (!existing || isMoreRelevantRelation(relation, existing)) {
          relationsByVisualPair.set(key, relation)
        }
      }
    }
  } finally {
    if (!options.meshRelationIndex) {
      meshRelationIndex.dispose()
    }
  }

  return [...relationsByVisualPair.values()]
}

export function findOverlappingVisualRelations(
  builtAsset: BuiltManifestAsset,
  options: {
    overlapTolerance: number
    volumeTolerance: number
  } & VisualRelationOptions,
): VisualPairRelation[] {
  const proxies = options.proxies ?? createVisualRelationProxies(builtAsset)
  const findingsByPair = new Map<string, VisualPairRelation>()
  const meshRelationIndex = options.meshRelationIndex ?? createMeshRelationIndex(builtAsset)

  try {
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

        if (!shouldConsiderVisualPair(proxyA, proxyB, options.shouldConsiderPair)) {
          continue
        }

        if (!boxesOverlap(proxyA.bounds, proxyB.bounds, options.overlapTolerance)) {
          continue
        }

        const relation = refineRelationWithMesh(
          createProxyRelation(proxyA, proxyB),
          meshRelationIndex,
          { includeDistance: false },
        )

        if (relation.overlapVolume <= options.volumeTolerance) {
          continue
        }

        const pairKey = getVisualPairKey(relation)
        const existingFinding = findingsByPair.get(pairKey)

        if (!existingFinding || relation.overlapVolume > existingFinding.overlapVolume) {
          findingsByPair.set(pairKey, relation)
        }
      }
    }
  } finally {
    if (!options.meshRelationIndex) {
      meshRelationIndex.dispose()
    }
  }

  return [...findingsByPair.values()]
}

function shouldConsiderVisualPair(
  proxyA: VisualRelationProxy,
  proxyB: VisualRelationProxy,
  shouldConsiderPair: VisualRelationOptions['shouldConsiderPair'],
) {
  return shouldConsiderPair
    ? shouldConsiderPair({
        partAId: proxyA.partId,
        partBId: proxyB.partId,
        visualAId: proxyA.visualId,
        visualBId: proxyB.visualId,
      })
    : true
}

function createGeometryRelationProxies({
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
}): VisualRelationProxy[] {
  switch (geometry.type) {
    case 'torus':
      return createPolylineRelationProxies({
        closed: true,
        points: createTorusPolylinePoints(geometry.radius, torusProxySegments),
        radius: geometry.tube,
        mesh,
        partId,
        visualId,
      })
    case 'tube':
      return createPolylineRelationProxies({
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

      return createPolylineRelationProxies({
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
    case 'lathe':
      if (isOpenOrCutawayLatheGeometry(geometry)) {
        return createLatheSurfaceRelationProxies({
          geometry,
          mesh,
          partId,
          visualId,
        })
      }

      return createSegmentedSolidRelationProxies({
        fallbackBounds: bounds,
        mesh,
        partId,
        visualId,
      })
    default:
      return createSegmentedSolidRelationProxies({
        fallbackBounds: bounds,
        mesh,
        partId,
        visualId,
      })
  }
}

function createLatheSurfaceRelationProxies({
  geometry,
  mesh,
  partId,
  visualId,
}: {
  geometry: Extract<ManifestGeometry, { type: 'lathe' }>
  mesh: THREE.Object3D
  partId: string
  visualId: string
}): VisualRelationProxy[] {
  if (geometry.points.length < 2) {
    return []
  }

  const phiStart = geometry.phiStart ?? 0
  const phiLength = geometry.phiLength ?? fullLatheSweep
  const maxRadius = Math.max(
    ...geometry.points.map(([radius]) => Math.abs(radius)),
  )
  const angularSegments = getLatheAngularSegmentCount(
    maxRadius,
    phiLength,
  )
  const proxies: VisualRelationProxy[] = []

  for (
    let profileIndex = 0;
    profileIndex < geometry.points.length - 1;
    profileIndex += 1
  ) {
    const startPoint = geometry.points[profileIndex]
    const endPoint = geometry.points[profileIndex + 1]

    if (!startPoint || !endPoint) {
      continue
    }

    for (
      let segmentIndex = 0;
      segmentIndex < angularSegments;
      segmentIndex += 1
    ) {
      const angleA = phiStart + phiLength * segmentIndex / angularSegments
      const angleB = phiStart + phiLength * (segmentIndex + 1) / angularSegments
      const surfaceCorners = [
        createLatheSurfacePoint(startPoint, angleA),
        createLatheSurfacePoint(startPoint, angleB),
        createLatheSurfacePoint(endPoint, angleA),
        createLatheSurfacePoint(endPoint, angleB),
      ].map((point) => point.applyMatrix4(mesh.matrixWorld))
      const bounds = new THREE.Box3().setFromPoints(surfaceCorners)

      if (bounds.isEmpty()) {
        continue
      }

      bounds.expandByScalar(latheSurfaceProxyThicknessMeters)
      proxies.push({
        bounds,
        partId,
        visualId,
      })
    }
  }

  return proxies
}

function createLatheSurfacePoint(
  [radius, height]: readonly [number, number],
  angle: number,
) {
  return new THREE.Vector3(
    Math.sin(angle) * radius,
    height,
    Math.cos(angle) * radius,
  )
}

function getLatheAngularSegmentCount(
  maxRadius: number,
  phiLength: number,
) {
  const arcLength = Math.abs(maxRadius * phiLength)
  const arcDrivenSegments = arcLength > 0
    ? Math.ceil(arcLength / maxLatheAngularProxyLengthMeters)
    : 1

  return Math.min(
    maxLatheAngularProxySegments,
    Math.max(minLatheAngularProxySegments, arcDrivenSegments),
  )
}

function isOpenOrCutawayLatheGeometry(
  geometry: Extract<ManifestGeometry, { type: 'lathe' }>,
) {
  const firstPoint = geometry.points[0]
  const lastPoint = geometry.points[geometry.points.length - 1]

  if (!firstPoint || !lastPoint) {
    return false
  }

  const phiLength = geometry.phiLength ?? fullLatheSweep
  const hasFullSweep =
    Math.abs(Math.abs(phiLength) - fullLatheSweep) <= latheSweepEpsilon
  const profileTouchesAxisAtEnds =
    Math.abs(firstPoint[0]) <= latheAxisEpsilon &&
    Math.abs(lastPoint[0]) <= latheAxisEpsilon

  return !hasFullSweep || !profileTouchesAxisAtEnds
}

function createSegmentedSolidRelationProxies({
  fallbackBounds,
  mesh,
  partId,
  visualId,
}: {
  fallbackBounds: THREE.Box3
  mesh: THREE.Object3D
  partId: string
  visualId: string
}): VisualRelationProxy[] {
  if (!isMesh(mesh)) {
    return [{ bounds: fallbackBounds, partId, visualId }]
  }

  mesh.geometry.computeBoundingBox()
  const localBounds = mesh.geometry.boundingBox

  if (!localBounds || localBounds.isEmpty()) {
    return [{ bounds: fallbackBounds, partId, visualId }]
  }

  const localSize = new THREE.Vector3()
  localBounds.getSize(localSize)

  const axis = getLargestAxis(localSize)
  const subdivisions = getSolidProxySubdivisionCount(
    getWorldAxisSpan(mesh.matrixWorld, axis, localSize[axis]),
  )

  if (subdivisions <= 1) {
    return [
      {
        bounds: transformLocalBox(localBounds, mesh.matrixWorld),
        partId,
        visualId,
      },
    ]
  }

  const proxies: VisualRelationProxy[] = []
  const step = localSize[axis] / subdivisions

  for (let index = 0; index < subdivisions; index += 1) {
    const min = localBounds.min.clone()
    const max = localBounds.max.clone()

    min[axis] = localBounds.min[axis] + step * index
    max[axis] = index === subdivisions - 1
      ? localBounds.max[axis]
      : localBounds.min[axis] + step * (index + 1)

    proxies.push({
      bounds: transformLocalBox(new THREE.Box3(min, max), mesh.matrixWorld),
      partId,
      visualId,
    })
  }

  return proxies
}

function createPolylineRelationProxies({
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
}): VisualRelationProxy[] {
  if (points.length < 2) {
    return []
  }

  const worldScale = new THREE.Vector3()
  mesh.getWorldScale(worldScale)
  const worldRadius = radius * Math.max(worldScale.x, worldScale.y, worldScale.z)
  const segmentCount = closed ? points.length : points.length - 1
  const proxies: VisualRelationProxy[] = []

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

function createProxyRelation(
  proxyA: VisualRelationProxy,
  proxyB: VisualRelationProxy,
): VisualPairRelation {
  const overlapDepth = getOverlapDepth(proxyA.bounds, proxyB.bounds)
  const overlapVolume = getPositiveOverlapVolume(proxyA.bounds, proxyB.bounds)
  const penetrationDepth = overlapVolume > 0
    ? Math.min(overlapDepth.x, overlapDepth.y, overlapDepth.z)
    : 0

  return {
    distance: boxDistance(proxyA.bounds, proxyB.bounds),
    maxOverlapDepth: Math.max(0, overlapDepth.x, overlapDepth.y, overlapDepth.z),
    overlapDepth,
    overlapVolume,
    penetrationDepth,
    partAId: proxyA.partId,
    partBId: proxyB.partId,
    visualAId: proxyA.visualId,
    visualBId: proxyB.visualId,
  }
}

function refineRelationWithMesh(
  relation: VisualPairRelation,
  meshRelationIndex: ReturnType<typeof createMeshRelationIndex>,
  options: MeshRelationOptions = {},
): VisualPairRelation {
  if (!shouldRefineRelationWithMesh(relation)) {
    return relation
  }

  const meshRelation = meshRelationIndex.getRelation(
    relation.visualAId,
    relation.visualBId,
    options,
  )

  if (!meshRelation) {
    return relation
  }

  if (!meshRelation.intersects) {
    return {
      ...relation,
      distance: meshRelation.distance,
      maxOverlapDepth: 0,
      overlapDepth: new THREE.Vector3(0, 0, 0),
      overlapVolume: 0,
      penetrationDepth: 0,
    }
  }

  return {
    ...relation,
    distance: 0,
  }
}

function shouldRefineRelationWithMesh(relation: VisualPairRelation) {
  return (
    relation.overlapVolume > 0 ||
    relation.distance <= meshDistanceRefineDistanceMeters
  )
}

function isMoreRelevantRelation(
  relation: VisualPairRelation,
  existing: VisualPairRelation,
) {
  if (relation.distance !== existing.distance) {
    return relation.distance < existing.distance
  }

  if (relation.overlapVolume !== existing.overlapVolume) {
    return relation.overlapVolume > existing.overlapVolume
  }

  return relation.maxOverlapDepth > existing.maxOverlapDepth
}

function isAllowedConnectorEndpointContact(
  left: VisualRelationProxy,
  right: VisualRelationProxy,
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

function getSolidProxySubdivisionCount(worldAxisSpan: number) {
  if (
    !Number.isFinite(worldAxisSpan) ||
    worldAxisSpan <= maxSolidProxyLengthMeters
  ) {
    return 1
  }

  return Math.min(
    maxSolidProxySubdivisions,
    Math.ceil(worldAxisSpan / maxSolidProxyLengthMeters),
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

function transformLocalBox(bounds: THREE.Box3, matrixWorld: THREE.Matrix4) {
  const { max, min } = bounds
  const points = [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ].map((point) => point.applyMatrix4(matrixWorld))

  return new THREE.Box3().setFromPoints(points)
}

function getLargestAxis(size: THREE.Vector3): 'x' | 'y' | 'z' {
  if (size.x >= size.y && size.x >= size.z) {
    return 'x'
  }

  if (size.y >= size.x && size.y >= size.z) {
    return 'y'
  }

  return 'z'
}

function getWorldAxisSpan(
  matrixWorld: THREE.Matrix4,
  axis: 'x' | 'y' | 'z',
  localSpan: number,
) {
  const scale = new THREE.Vector3()
  matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale)

  return Math.abs(localSpan * scale[axis])
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

function getVisualPairKey(finding: VisualPairRelation) {
  return [finding.visualAId, finding.visualBId].sort().join('|')
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true
}
