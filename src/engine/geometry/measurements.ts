import * as THREE from 'three/webgpu'
import type { ManifestAxes, ManifestAxis } from '../schema/manifestTypes'

export function normalizeAxes(axes: ManifestAxes): readonly ManifestAxis[] {
  switch (axes) {
    case 'x':
      return ['x']
    case 'y':
      return ['y']
    case 'z':
      return ['z']
    case 'xy':
      return ['x', 'y']
    case 'xz':
      return ['x', 'z']
    case 'yz':
      return ['y', 'z']
    case 'xyz':
      return ['x', 'y', 'z']
    default:
      return assertNever(axes)
  }
}

export function getAxisInterval(bounds: THREE.Box3, axis: ManifestAxis) {
  return {
    max: bounds.max[axis],
    min: bounds.min[axis],
  }
}

export function getAxisSpan(bounds: THREE.Box3, axis: ManifestAxis) {
  return bounds.max[axis] - bounds.min[axis]
}

export function getProjectedGap(
  positiveBounds: THREE.Box3,
  negativeBounds: THREE.Box3,
  axis: ManifestAxis,
) {
  return positiveBounds.min[axis] - negativeBounds.max[axis]
}

export function getProjectedOverlap(
  boundsA: THREE.Box3,
  boundsB: THREE.Box3,
  axis: ManifestAxis,
) {
  return Math.min(boundsA.max[axis], boundsB.max[axis]) -
    Math.max(boundsA.min[axis], boundsB.min[axis])
}

export function getOverlapDepth(boundsA: THREE.Box3, boundsB: THREE.Box3) {
  return new THREE.Vector3(
    getProjectedOverlap(boundsA, boundsB, 'x'),
    getProjectedOverlap(boundsA, boundsB, 'y'),
    getProjectedOverlap(boundsA, boundsB, 'z'),
  )
}

export function getPositiveOverlapVolume(
  boundsA: THREE.Box3,
  boundsB: THREE.Box3,
) {
  const depth = getOverlapDepth(boundsA, boundsB)

  if (depth.x <= 0 || depth.y <= 0 || depth.z <= 0) {
    return 0
  }

  return depth.x * depth.y * depth.z
}

export function boxesOverlap(
  boundsA: THREE.Box3,
  boundsB: THREE.Box3,
  tolerance: number,
) {
  const depth = getOverlapDepth(boundsA, boundsB)

  return depth.x > tolerance && depth.y > tolerance && depth.z > tolerance
}

export function boxesTouchOrOverlap(
  boundsA: THREE.Box3,
  boundsB: THREE.Box3,
  tolerance: number,
) {
  return (
    boundsA.max.x + tolerance >= boundsB.min.x &&
    boundsB.max.x + tolerance >= boundsA.min.x &&
    boundsA.max.y + tolerance >= boundsB.min.y &&
    boundsB.max.y + tolerance >= boundsA.min.y &&
    boundsA.max.z + tolerance >= boundsB.min.z &&
    boundsB.max.z + tolerance >= boundsA.min.z
  )
}

export function boxDistance(boundsA: THREE.Box3, boundsB: THREE.Box3) {
  const dx = Math.max(0, boundsA.min.x - boundsB.max.x, boundsB.min.x - boundsA.max.x)
  const dy = Math.max(0, boundsA.min.y - boundsB.max.y, boundsB.min.y - boundsA.max.y)
  const dz = Math.max(0, boundsA.min.z - boundsB.max.z, boundsB.min.z - boundsA.max.z)

  return Math.hypot(dx, dy, dz)
}

export function pointToBoxDistance(point: THREE.Vector3, bounds: THREE.Box3) {
  const dx = Math.max(0, bounds.min.x - point.x, point.x - bounds.max.x)
  const dy = Math.max(0, bounds.min.y - point.y, point.y - bounds.max.y)
  const dz = Math.max(0, bounds.min.z - point.z, point.z - bounds.max.z)

  return Math.hypot(dx, dy, dz)
}

export function axisContains(
  inner: THREE.Box3,
  outer: THREE.Box3,
  axis: ManifestAxis,
  margin: number,
) {
  return inner.min[axis] >= outer.min[axis] - margin &&
    inner.max[axis] <= outer.max[axis] + margin
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Manifest3D axes: ${JSON.stringify(value)}`)
}
