import { describe, expect, it } from 'vitest'
import { getViewportWorldEnvironment } from './viewportWorld'

describe('viewport world environments', () => {
  it('keeps light mode on the existing bright viewport world settings', () => {
    const light = getViewportWorldEnvironment('light')

    expect(light.backgroundColor).toBe('#f7f7fb')
    expect(light.fog).toEqual({
      color: '#efeff9',
      density: 0.018,
    })
    expect(light.ground).toEqual({
      color: '#f4f3fb',
      metalness: 0.05,
      roughness: 0.36,
    })
    expect(light.lights.hemisphere.intensity).toBe(1.35)
    expect(light.lights.key.intensity).toBe(1.9)
    expect(light.lights.fill.intensity).toBe(0.62)
  })

  it('uses a dimmer renderer-owned world for dark mode', () => {
    const light = getViewportWorldEnvironment('light')
    const dark = getViewportWorldEnvironment('dark')

    expect(dark.backgroundColor).not.toBe(light.backgroundColor)
    expect(dark.ground.color).not.toBe(light.ground.color)
    expect(dark.fog.color).not.toBe(light.fog.color)
    expect(dark.lights.hemisphere.intensity).toBeLessThan(
      light.lights.hemisphere.intensity,
    )
    expect(dark.lights.key.intensity).toBeLessThan(
      light.lights.key.intensity,
    )
    expect(dark.lights.fill.intensity).toBeLessThan(
      light.lights.fill.intensity,
    )
  })
})
