import { describe, expect, it } from 'vitest'
import { computeRendererDpr } from './createRenderer'

describe('computeRendererDpr', () => {
  it('caps high-density viewports by total pixel budget', () => {
    expect(computeRendererDpr(1000, 1000, 2)).toBeCloseTo(
      Math.sqrt(1_650_000 / 1_000_000),
    )
  })

  it('caps dpr at 1.5 for smaller viewports', () => {
    expect(computeRendererDpr(800, 600, 3)).toBe(1.5)
  })

  it('never returns below one', () => {
    expect(computeRendererDpr(1200, 900, 0.75)).toBe(1)
    expect(computeRendererDpr(0, 900, 2)).toBe(1)
  })
})
