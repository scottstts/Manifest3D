import { describe, expect, it } from 'vitest'
import {
  createViewportCameraSnapshot,
  defaultViewportCameraConfig,
  getViewportCameraSnapshotSignature,
} from './viewportCamera'

describe('defaultViewportCameraConfig', () => {
  it('keeps the far clip safely beyond the maximum orbit zoom-out distance', () => {
    expect(defaultViewportCameraConfig.far).toBe(150)
  })
})

describe('createViewportCameraSnapshot', () => {
  it('captures camera pose and orbit target in the path-tracer bridge format', () => {
    const snapshot = createViewportCameraSnapshot(
      {
        far: 80,
        fov: 38,
        near: 0.1,
        position: { x: 1, y: 2, z: 3 },
        quaternion: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
      },
      { x: 4, y: 5, z: 6 },
    )

    expect(snapshot).toEqual({
      far: 80,
      fov: 38,
      near: 0.1,
      position: [1, 2, 3],
      quaternion: [0.1, 0.2, 0.3, 0.9],
      target: [4, 5, 6],
    })
  })
})

describe('getViewportCameraSnapshotSignature', () => {
  it('includes target changes so repeated asset clicks can republish centering snapshots', () => {
    const baseSnapshot = {
      far: 80,
      fov: 38,
      near: 0.1,
      position: [1, 2, 3] as [number, number, number],
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
      target: [0, 0, 0] as [number, number, number],
    }

    expect(getViewportCameraSnapshotSignature(baseSnapshot)).not.toBe(
      getViewportCameraSnapshotSignature({
        ...baseSnapshot,
        target: [0.1, 0, 0],
      }),
    )
  })
})
