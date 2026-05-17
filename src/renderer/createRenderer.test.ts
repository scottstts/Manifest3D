import { describe, expect, it } from 'vitest'
import { computeRendererDpr } from './createRenderer'

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
