import * as THREE from 'three'
import { getProjectionViewOffset } from '../effectiveViewport'
import {
  createViewportCameraSnapshot,
  defaultViewportCameraConfig,
  type ViewportCameraSnapshot,
} from '../viewportCamera'

export type PathTracingViewportSize = {
  height: number
  width: number
}

export function createDefaultPathTracingCameraSnapshot(): ViewportCameraSnapshot {
  const camera = new THREE.PerspectiveCamera(
    defaultViewportCameraConfig.fov,
    1,
    defaultViewportCameraConfig.near,
    defaultViewportCameraConfig.far,
  )
  const target = new THREE.Vector3(...defaultViewportCameraConfig.target)

  camera.position.fromArray(defaultViewportCameraConfig.position)
  camera.lookAt(target)
  camera.updateMatrixWorld(true)

  return createViewportCameraSnapshot(camera, target)
}

export function applyPathTracingCameraSnapshot({
  camera,
  leftPanelOcclusionWidth,
  rightPanelOcclusionWidth,
  snapshot,
  viewportSize,
}: {
  camera: THREE.PerspectiveCamera
  leftPanelOcclusionWidth: number
  rightPanelOcclusionWidth: number
  snapshot: ViewportCameraSnapshot
  viewportSize: PathTracingViewportSize
}) {
  camera.fov = snapshot.fov
  camera.near = snapshot.near
  camera.far = snapshot.far
  camera.aspect = viewportSize.width / viewportSize.height
  camera.position.fromArray(snapshot.position)
  camera.quaternion.fromArray(snapshot.quaternion)

  const viewOffset = getProjectionViewOffset(
    viewportSize.width,
    viewportSize.height,
    rightPanelOcclusionWidth,
    leftPanelOcclusionWidth,
  )

  if (viewOffset) {
    camera.setViewOffset(
      viewOffset.fullWidth,
      viewOffset.fullHeight,
      viewOffset.offsetX,
      viewOffset.offsetY,
      viewOffset.width,
      viewOffset.height,
    )
  } else {
    camera.clearViewOffset()
  }

  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
}
