import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  computeDefaultViewportShadowState,
  defaultViewportShadowConfig,
} from './viewportShadows'

describe('defaultViewportShadowConfig', () => {
  it('uses a high-resolution default shadow map with safe minimum bounds', () => {
    const { camera, mapSize, minCameraSpan } = defaultViewportShadowConfig

    expect(camera.left).toBeLessThanOrEqual(-36)
    expect(camera.right).toBeGreaterThanOrEqual(36)
    expect(camera.bottom).toBeLessThanOrEqual(-36)
    expect(camera.top).toBeGreaterThanOrEqual(36)
    expect(camera.far).toBeGreaterThanOrEqual(120)
    expect(minCameraSpan).toBeGreaterThanOrEqual(72)
    expect(mapSize).toBeGreaterThanOrEqual(4096)
  })
})

describe('computeDefaultViewportShadowState', () => {
  it('keeps tall casters and their ground projections inside the shadow frustum', () => {
    const bounds = new THREE.Box3(
      new THREE.Vector3(-15, 0, -2),
      new THREE.Vector3(15, 24, 2),
    )
    const lightOffset = new THREE.Vector3(4.2, 3.2, -4.5)
    const state = computeDefaultViewportShadowState(bounds, lightOffset)
    const shadowCamera = new THREE.OrthographicCamera(
      state.camera.left,
      state.camera.right,
      state.camera.top,
      state.camera.bottom,
      state.camera.near,
      state.camera.far,
    )
    const target = new THREE.Vector3(...state.targetPosition)

    shadowCamera.position.fromArray(state.lightPosition)
    shadowCamera.lookAt(target)
    shadowCamera.updateMatrixWorld(true)

    const viewMatrix = shadowCamera.matrixWorld.clone().invert()
    const lightDirection = lightOffset.clone().normalize()
    const points = getBoxCorners(bounds)

    for (const corner of getBoxCorners(bounds)) {
      const distanceAlongRay =
        (corner.y - defaultViewportShadowConfig.groundPlaneY) /
        lightDirection.y

      if (distanceAlongRay >= 0) {
        points.push(corner.clone().addScaledVector(lightDirection, -distanceAlongRay))
      }
    }

    expect(state.lightPosition[1]).toBeGreaterThan(bounds.max.y)

    for (const point of points) {
      const localPoint = point.clone().applyMatrix4(viewMatrix)
      const depth = -localPoint.z

      expect(localPoint.x).toBeGreaterThanOrEqual(state.camera.left - 0.000001)
      expect(localPoint.x).toBeLessThanOrEqual(state.camera.right + 0.000001)
      expect(localPoint.y).toBeGreaterThanOrEqual(state.camera.bottom - 0.000001)
      expect(localPoint.y).toBeLessThanOrEqual(state.camera.top + 0.000001)
      expect(depth).toBeGreaterThanOrEqual(state.camera.near - 0.000001)
      expect(depth).toBeLessThanOrEqual(state.camera.far + 0.000001)
    }
  })
})

function getBoxCorners(bounds: THREE.Box3) {
  const { max, min } = bounds

  return [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ]
}
