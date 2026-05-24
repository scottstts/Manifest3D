import { describe, expect, it } from 'vitest'
import { pathTracingViewportConfig } from './pathTracingConfig'
import {
  formatPathTracingMaxSamplePreference,
  getPathTracingMaxSampleOptions,
  isPathTracingMaxSampleCount,
  parsePathTracingMaxSamplePreference,
} from './pathTracingSampleCountPreference'

describe('path tracing max-sample preference parsing', () => {
  it('accepts only the supported max-sample options', () => {
    expect(parsePathTracingMaxSamplePreference('128')).toBe(128)
    expect(parsePathTracingMaxSamplePreference('256')).toBe(256)
    expect(parsePathTracingMaxSamplePreference(512)).toBe(512)
    expect(parsePathTracingMaxSamplePreference('100')).toBe(
      pathTracingViewportConfig.maxSamples,
    )
    expect(parsePathTracingMaxSamplePreference(null)).toBe(
      pathTracingViewportConfig.maxSamples,
    )
  })

  it('formats persisted max-sample values as strings', () => {
    expect(formatPathTracingMaxSamplePreference(256)).toBe('256')
  })

  it('exposes exactly the selectable viewport options', () => {
    expect(getPathTracingMaxSampleOptions()).toEqual([128, 256, 512])
    expect(isPathTracingMaxSampleCount(128)).toBe(true)
    expect(isPathTracingMaxSampleCount(100)).toBe(false)
  })
})
