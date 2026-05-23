import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { resetRendererViewportToCanvasCssSize } from './pathTracingRendererViewport'

describe('resetRendererViewportToCanvasCssSize', () => {
  it('resets the WebGL viewport in CSS pixels instead of DPR-scaled drawing-buffer pixels', () => {
    const viewportCalls: Array<[number, number, number, number]> = []
    const renderer = {
      getSize(target: THREE.Vector2) {
        return target.set(1200, 800)
      },
      setScissorTest: (enabled: boolean) => {
        expect(enabled).toBe(false)
      },
      setViewport: (x: number, y: number, width: number, height: number) => {
        viewportCalls.push([x, y, width, height])
      },
    }

    const canvasSize = resetRendererViewportToCanvasCssSize(renderer)

    expect(canvasSize.toArray()).toEqual([1200, 800])
    expect(viewportCalls).toEqual([[0, 0, 1200, 800]])
  })
})
