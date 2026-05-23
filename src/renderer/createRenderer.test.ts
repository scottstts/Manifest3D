import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  computeRendererDpr,
  resolveInitialCanvasViewportSize,
} from './createRenderer'

describe('computeRendererDpr', () => {
  it('caps high-density viewports by total pixel budget', () => {
    expect(computeRendererDpr(1600, 1600, 2)).toBeCloseTo(
      Math.sqrt(4_000_000 / (1_600 * 1_600)),
    )
  })

  it('caps dpr at 1.75 for smaller viewports', () => {
    expect(computeRendererDpr(800, 600, 3)).toBe(1.75)
  })

  it('never returns below one', () => {
    expect(computeRendererDpr(1200, 900, 0.75)).toBe(1)
    expect(computeRendererDpr(0, 900, 2)).toBe(1)
  })
})

describe('resolveInitialCanvasViewportSize', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the canvas layout size when it is available', () => {
    const canvas = createMockCanvas({
      clientHeight: 741,
      clientWidth: 1280,
      height: 150,
      width: 300,
    })

    expect(resolveInitialCanvasViewportSize(canvas)).toEqual({
      height: 741,
      width: 1280,
    })
  })

  it('uses the parent layout size instead of the default canvas buffer size', () => {
    const canvas = createMockCanvas({
      height: 150,
      parentHeight: 741,
      parentWidth: 1280,
      width: 300,
    })

    expect(resolveInitialCanvasViewportSize(canvas)).toEqual({
      height: 741,
      width: 1280,
    })
  })

  it('uses the window size before falling back to a default html canvas buffer', () => {
    vi.stubGlobal('window', {
      innerHeight: 900,
      innerWidth: 1440,
    })

    const canvas = createMockCanvas({ height: 150, width: 300 })

    expect(resolveInitialCanvasViewportSize(canvas)).toEqual({
      height: 900,
      width: 1440,
    })
  })

  it('keeps non-default backing size as a final fallback', () => {
    const canvas = { height: 600, width: 800 } as OffscreenCanvas

    expect(resolveInitialCanvasViewportSize(canvas)).toEqual({
      height: 600,
      width: 800,
    })
  })
})

type MockCanvasOptions = {
  clientHeight?: number
  clientWidth?: number
  height: number
  parentHeight?: number
  parentWidth?: number
  width: number
}

function createMockCanvas({
  clientHeight = 0,
  clientWidth = 0,
  height,
  parentHeight = 0,
  parentWidth = 0,
  width,
}: MockCanvasOptions) {
  return {
    clientHeight,
    clientWidth,
    height,
    parentElement:
      parentWidth > 0 && parentHeight > 0
        ? {
            clientHeight: parentHeight,
            clientWidth: parentWidth,
            getBoundingClientRect: () => ({
              height: parentHeight,
              width: parentWidth,
            }),
          }
        : null,
    width,
    getBoundingClientRect: () => ({
      height: clientHeight,
      width: clientWidth,
    }),
  } as unknown as HTMLCanvasElement
}
