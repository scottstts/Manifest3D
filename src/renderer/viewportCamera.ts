export type ViewportCameraSnapshot = {
  far: number
  fov: number
  near: number
  position: [number, number, number]
  quaternion: [number, number, number, number]
  target: [number, number, number]
}

export type ViewportCameraLike = {
  far: number
  fov: number
  near: number
  position: ViewportVectorLike
  quaternion: ViewportQuaternionLike
}

export type ViewportQuaternionLike = {
  w: number
  x: number
  y: number
  z: number
}

export type ViewportVectorLike = {
  x: number
  y: number
  z: number
}

export const defaultViewportCameraConfig = {
  far: 150,
  fov: 38,
  near: 0.1,
  position: [3.65, 2.5, 4.45] as [number, number, number],
  target: [0, 0, -0.2] as [number, number, number],
}

export function createViewportCameraSnapshot(
  camera: ViewportCameraLike,
  target: ViewportVectorLike,
): ViewportCameraSnapshot {
  return {
    far: camera.far,
    fov: camera.fov,
    near: camera.near,
    position: [camera.position.x, camera.position.y, camera.position.z],
    quaternion: [
      camera.quaternion.x,
      camera.quaternion.y,
      camera.quaternion.z,
      camera.quaternion.w,
    ],
    target: [target.x, target.y, target.z],
  }
}

export function getViewportCameraSnapshotSignature(
  snapshot: ViewportCameraSnapshot,
) {
  return [
    ...snapshot.position,
    ...snapshot.quaternion,
    ...snapshot.target,
    snapshot.fov,
    snapshot.near,
    snapshot.far,
  ]
    .map((value) => value.toFixed(5))
    .join(':')
}
