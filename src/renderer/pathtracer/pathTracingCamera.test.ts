import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { getEffectiveViewportCenterX } from '../effectiveViewport'
import type { ViewportCameraSnapshot } from '../viewportCamera'
import {
  applyPathTracingCameraSnapshot,
  createDefaultPathTracingCameraSnapshot,
} from './pathTracingCamera'

function projectToScreenX(
  point: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  viewportWidth: number,
) {
  const projected = point.clone().project(camera)

  return ((projected.x + 1) / 2) * viewportWidth
}

describe('applyPathTracingCameraSnapshot', () => {
  it('orients the fallback path-tracing camera at the default OrbitControls target', () => {
    const viewportSize = { height: 800, width: 1200 }
    const snapshot = createDefaultPathTracingCameraSnapshot()
    const camera = new THREE.PerspectiveCamera()

    applyPathTracingCameraSnapshot({
      camera,
      leftPanelOcclusionWidth: 0,
      rightPanelOcclusionWidth: 0,
      snapshot,
      viewportSize,
    })

    expect(
      projectToScreenX(
        new THREE.Vector3().fromArray(snapshot.target),
        camera,
        viewportSize.width,
      ),
    ).toBeCloseTo(viewportSize.width / 2, 3)
  })

  it('uses the same projection view offset as the WebGPU viewport when side panels overlap', () => {
    const viewportSize = { height: 800, width: 1200 }
    const leftPanelOcclusionWidth = 288
    const rightPanelOcclusionWidth = 360
    const snapshot: ViewportCameraSnapshot = {
      far: 80,
      fov: 38,
      near: 0.1,
      position: [0, 0, 10],
      quaternion: [0, 0, 0, 1],
      target: [0, 0, 0],
    }
    const camera = new THREE.PerspectiveCamera()

    applyPathTracingCameraSnapshot({
      camera,
      leftPanelOcclusionWidth,
      rightPanelOcclusionWidth,
      snapshot,
      viewportSize,
    })

    expect(camera.view).toEqual({
      enabled: true,
      fullHeight: viewportSize.height,
      fullWidth: viewportSize.width,
      height: viewportSize.height,
      offsetX: 36,
      offsetY: 0,
      width: viewportSize.width,
    })
    expect(
      projectToScreenX(
        new THREE.Vector3().fromArray(snapshot.target),
        camera,
        viewportSize.width,
      ),
    ).toBeCloseTo(
      getEffectiveViewportCenterX(
        viewportSize.width,
        rightPanelOcclusionWidth,
        leftPanelOcclusionWidth,
      ),
      3,
    )
  })

  it('preserves the source camera orientation while applying effective viewport centering', () => {
    const snapshot: ViewportCameraSnapshot = {
      far: 80,
      fov: 38,
      near: 0.1,
      position: [3.65, 2.5, 4.45],
      quaternion: [0.1, 0.2, 0.3, 0.9],
      target: [0, 0, -0.2],
    }
    const normalizedQuaternion = new THREE.Quaternion()
      .fromArray(snapshot.quaternion)
      .normalize()
    const camera = new THREE.PerspectiveCamera()

    snapshot.quaternion = [
      normalizedQuaternion.x,
      normalizedQuaternion.y,
      normalizedQuaternion.z,
      normalizedQuaternion.w,
    ]
    applyPathTracingCameraSnapshot({
      camera,
      leftPanelOcclusionWidth: 288,
      rightPanelOcclusionWidth: 360,
      snapshot,
      viewportSize: { height: 800, width: 1200 },
    })

    expect(camera.quaternion.angleTo(normalizedQuaternion)).toBeCloseTo(0, 6)
  })

  it('clears stale view offsets when panels no longer overlap the viewport', () => {
    const snapshot: ViewportCameraSnapshot = {
      far: 80,
      fov: 38,
      near: 0.1,
      position: [0, 0, 10],
      quaternion: [0, 0, 0, 1],
      target: [0, 0, 0],
    }
    const camera = new THREE.PerspectiveCamera()

    applyPathTracingCameraSnapshot({
      camera,
      leftPanelOcclusionWidth: 288,
      rightPanelOcclusionWidth: 360,
      snapshot,
      viewportSize: { height: 800, width: 1200 },
    })
    applyPathTracingCameraSnapshot({
      camera,
      leftPanelOcclusionWidth: 0,
      rightPanelOcclusionWidth: 0,
      snapshot,
      viewportSize: { height: 800, width: 1200 },
    })

    expect(camera.view?.enabled).toBe(false)
  })
})
