import * as THREE from 'three/webgpu'

export function createEmptyBounds() {
  return new THREE.Box3()
}

export function cloneBounds(bounds: THREE.Box3) {
  return bounds.clone()
}

export function boundsFromObject(object: THREE.Object3D) {
  return new THREE.Box3().setFromObject(object)
}

export function isFiniteBounds(bounds: THREE.Box3) {
  return (
    Number.isFinite(bounds.min.x) &&
    Number.isFinite(bounds.min.y) &&
    Number.isFinite(bounds.min.z) &&
    Number.isFinite(bounds.max.x) &&
    Number.isFinite(bounds.max.y) &&
    Number.isFinite(bounds.max.z)
  )
}

export function getBoundsSize(bounds: THREE.Box3) {
  const size = new THREE.Vector3()

  bounds.getSize(size)

  return size
}

export function getBoundsCenter(bounds: THREE.Box3) {
  const center = new THREE.Vector3()

  bounds.getCenter(center)

  return center
}

export function unionBounds(boundsList: Iterable<THREE.Box3>) {
  const bounds = createEmptyBounds()

  for (const item of boundsList) {
    bounds.union(item)
  }

  return bounds
}
