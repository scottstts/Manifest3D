import { describe, expect, it } from 'vitest'
import {
  allowsAnimationPreviewPlayback,
  getViewportNavigationBehavior,
  isViewportRenderMode,
} from './viewportRenderMode'

describe('isViewportRenderMode', () => {
  it('accepts supported viewport render modes', () => {
    expect(isViewportRenderMode('default')).toBe(true)
    expect(isViewportRenderMode('pathtracer')).toBe(true)
  })

  it('rejects unknown viewport render modes', () => {
    expect(isViewportRenderMode('webgl')).toBe(false)
    expect(isViewportRenderMode('')).toBe(false)
  })
})

describe('allowsAnimationPreviewPlayback', () => {
  it('allows animation playback only in the default WebGPU viewport', () => {
    expect(allowsAnimationPreviewPlayback('default')).toBe(true)
    expect(allowsAnimationPreviewPlayback('pathtracer')).toBe(false)
  })
})


describe('getViewportNavigationBehavior', () => {
  it('keeps the default WebGPU viewport damping and animated selection target snapping', () => {
    expect(getViewportNavigationBehavior('default')).toEqual({
      cameraInteractionSettleDelayMs: 0,
      enableDamping: true,
      snapSelectionImmediately: false,
    })
  })

  it('disables inertia and snaps selection centering immediately in path tracer mode', () => {
    expect(getViewportNavigationBehavior('pathtracer')).toEqual({
      cameraInteractionSettleDelayMs: 140,
      enableDamping: false,
      snapSelectionImmediately: true,
    })
  })
})
