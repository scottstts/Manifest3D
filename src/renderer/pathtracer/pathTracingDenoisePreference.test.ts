import { describe, expect, it } from 'vitest'
import {
  formatPathTracingDenoisePreference,
  parsePathTracingDenoisePreference,
} from './pathTracingDenoisePreference'

describe('path tracing denoise preference parsing', () => {
  it('defaults to disabled unless the stored value is explicitly true', () => {
    expect(parsePathTracingDenoisePreference('true')).toBe(true)
    expect(parsePathTracingDenoisePreference('false')).toBe(false)
    expect(parsePathTracingDenoisePreference(null)).toBe(false)
    expect(parsePathTracingDenoisePreference('1')).toBe(false)
  })

  it('serializes the preference for localStorage', () => {
    expect(formatPathTracingDenoisePreference(true)).toBe('true')
    expect(formatPathTracingDenoisePreference(false)).toBe('false')
  })
})
