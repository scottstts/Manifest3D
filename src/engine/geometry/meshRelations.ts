import * as THREE from 'three/webgpu'
import { MeshBVH } from 'three-mesh-bvh'
import type { BuiltManifestAsset } from './assetBuilder'
import type { ManifestGeometry, ManifestVisual } from '../schema/manifestTypes'

export type MeshRelationIndex = {
  dispose: () => void
  getRelation: (
    visualAId: string,
    visualBId: string,
    options?: MeshRelationOptions,
  ) => MeshVisualPairRelation | null
}

export type MeshVisualPairRelation = {
  distance: number
  intersects: boolean
}

export type MeshRelationOptions = {
  includeDistance?: boolean
}

type MeshRelationShape = {
  bvh: MeshBVH
  closed: boolean
  geometry: THREE.BufferGeometry
}

const identityMatrix = new THREE.Matrix4()
const insideRayDirection = new THREE.Vector3(1, 0.371390676, 0.184427779)
  .normalize()
const uniqueIntersectionDistanceTolerance = 1e-5
const pointInsideRayNear = 1e-7
const maxContainmentSamplePoints = 18

export function createMeshRelationIndex(
  builtAsset: BuiltManifestAsset,
): MeshRelationIndex {
  const visualsById = createVisualMap(builtAsset.asset.parts.flatMap((part) => part.visuals))
  const shapes = new Map<string, MeshRelationShape | null>()
  const relations = new Map<string, MeshVisualPairRelation | null>()

  return {
    dispose: () => {
      for (const shape of shapes.values()) {
        shape?.geometry.dispose()
      }

      shapes.clear()
      relations.clear()
    },
    getRelation: (visualAId, visualBId, options = {}) => {
      const includeDistance = options.includeDistance ?? true
      const key = createVisualPairKey(visualAId, visualBId, includeDistance)

      if (relations.has(key)) {
        return relations.get(key) ?? null
      }

      const shapeA = getShape(visualAId)
      const shapeB = getShape(visualBId)
      const relation = shapeA && shapeB
        ? createMeshRelation(shapeA, shapeB, { includeDistance })
        : null

      relations.set(key, relation)

      return relation
    },
  }

  function getShape(visualId: string) {
    if (shapes.has(visualId)) {
      return shapes.get(visualId) ?? null
    }

    const visual = visualsById.get(visualId)
    const mesh = builtAsset.visualMeshes.get(visualId)
    const shape = visual && mesh ? createShape(mesh, visual.geometry) : null

    shapes.set(visualId, shape)

    return shape
  }
}

function createVisualMap(visuals: readonly ManifestVisual[]) {
  const visualMap = new Map<string, ManifestVisual>()

  for (const visual of visuals) {
    visualMap.set(visual.id, visual)
  }

  return visualMap
}

function createShape(
  mesh: THREE.Mesh,
  manifestGeometry: ManifestGeometry,
): MeshRelationShape | null {
  const position = mesh.geometry.getAttribute('position')

  if (!position || position.count === 0) {
    return null
  }

  const geometry = mesh.geometry.clone()

  geometry.applyMatrix4(mesh.matrixWorld)
  geometry.computeBoundingBox()

  if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) {
    geometry.dispose()
    return null
  }

  return {
    bvh: new MeshBVH(geometry),
    closed: isClosedCollisionSurface(manifestGeometry),
    geometry,
  }
}

function createMeshRelation(
  shapeA: MeshRelationShape,
  shapeB: MeshRelationShape,
  options: Required<MeshRelationOptions>,
): MeshVisualPairRelation {
  const intersects = meshesIntersect(shapeA, shapeB)
  const distance = intersects
    ? 0
    : options.includeDistance
      ? getClosestDistance(shapeA, shapeB)
      : Infinity

  return {
    distance,
    intersects,
  }
}

function meshesIntersect(
  shapeA: MeshRelationShape,
  shapeB: MeshRelationShape,
) {
  if (shapeA.bvh.intersectsGeometry(shapeB.geometry, identityMatrix)) {
    return true
  }

  return (
    (shapeA.closed && containsAnyPoint(shapeA, shapeB.geometry)) ||
    (shapeB.closed && containsAnyPoint(shapeB, shapeA.geometry))
  )
}

function getClosestDistance(
  shapeA: MeshRelationShape,
  shapeB: MeshRelationShape,
) {
  const hit = shapeA.bvh.closestPointToGeometry(
    shapeB.geometry,
    identityMatrix,
  )

  return hit?.distance ?? Infinity
}

function containsAnyPoint(
  closedShape: MeshRelationShape,
  candidateGeometry: THREE.BufferGeometry,
) {
  for (const point of sampleGeometryPoints(candidateGeometry)) {
    if (isPointInsideClosedShape(closedShape, point)) {
      return true
    }
  }

  return false
}

function sampleGeometryPoints(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position')

  if (!position || position.count === 0) {
    return []
  }

  const points: THREE.Vector3[] = []

  geometry.computeBoundingBox()

  if (geometry.boundingBox && !geometry.boundingBox.isEmpty()) {
    points.push(geometry.boundingBox.getCenter(new THREE.Vector3()))
  }

  const stride = Math.max(
    1,
    Math.floor(position.count / maxContainmentSamplePoints),
  )

  for (
    let index = 0;
    index < position.count && points.length < maxContainmentSamplePoints;
    index += stride
  ) {
    points.push(
      new THREE.Vector3(
        position.getX(index),
        position.getY(index),
        position.getZ(index),
      ),
    )
  }

  return points
}

function isPointInsideClosedShape(
  shape: MeshRelationShape,
  point: THREE.Vector3,
) {
  const hits = shape.bvh.raycast(
    new THREE.Ray(point, insideRayDirection),
    THREE.DoubleSide,
    pointInsideRayNear,
  )

  return countUniqueDistances(hits.map((hit) => hit.distance)) % 2 === 1
}

function countUniqueDistances(distances: readonly number[]) {
  const orderedDistances = [...distances]
    .filter((distance) => Number.isFinite(distance))
    .sort((left, right) => left - right)
  let count = 0
  let previousDistance = -Infinity

  for (const distance of orderedDistances) {
    if (
      count === 0 ||
      Math.abs(distance - previousDistance) > uniqueIntersectionDistanceTolerance
    ) {
      count += 1
      previousDistance = distance
    }
  }

  return count
}

function isClosedCollisionSurface(geometry: ManifestGeometry) {
  switch (geometry.type) {
    case 'box':
    case 'roundedBox':
    case 'cylinder':
    case 'sphere':
    case 'torus':
    case 'cone':
    case 'capsule':
    case 'extrude':
      return true
    case 'lathe':
      return isClosedLathe(geometry)
    case 'tube':
    case 'connectorTube':
      return false
    default:
      return assertNever(geometry)
  }
}

function isClosedLathe(geometry: Extract<ManifestGeometry, { type: 'lathe' }>) {
  const firstPoint = geometry.points[0]
  const lastPoint = geometry.points[geometry.points.length - 1]

  if (!firstPoint || !lastPoint) {
    return false
  }

  const phiLength = geometry.phiLength ?? Math.PI * 2
  const hasFullSweep = Math.abs(Math.abs(phiLength) - Math.PI * 2) <= 0.0001

  return (
    hasFullSweep &&
    Math.abs(firstPoint[0]) <= 0.000001 &&
    Math.abs(lastPoint[0]) <= 0.000001
  )
}

function createVisualPairKey(
  visualAId: string,
  visualBId: string,
  includeDistance: boolean,
) {
  return `${includeDistance ? 'distance' : 'intersect'}\n${[visualAId, visualBId].sort().join('\n')}`
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Manifest3D geometry: ${JSON.stringify(value)}`)
}
