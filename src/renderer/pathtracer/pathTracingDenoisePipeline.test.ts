import { describe, expect, it } from 'vitest'
import {
  getPathTracingDenoiseNormalizedDepthPhi,
  getPathTracingDenoiseObjectKey,
  getPathTracingDenoiseStepWidths,
  isRecoverablePathTracingDenoiseGlError,
  shouldUsePathTracingDenoise,
} from './pathTracingDenoisePipeline'

describe('shouldUsePathTracingDenoise', () => {
  it('does not denoise before the configured final sample is reached', () => {
    expect(
      shouldUsePathTracingDenoise({
        enabled: true,
        maxSamples: 100,
        sampleCount: 99.9,
      }),
    ).toBe(false)
  })

  it('starts denoising once sample accumulation reaches the configured final sample', () => {
    expect(
      shouldUsePathTracingDenoise({
        enabled: true,
        maxSamples: 100,
        sampleCount: 100,
      }),
    ).toBe(true)
  })

  it('keeps denoising disabled when the config flag is off', () => {
    expect(
      shouldUsePathTracingDenoise({
        enabled: false,
        maxSamples: 100,
        sampleCount: 120,
      }),
    ).toBe(false)
  })
})

describe('getPathTracingDenoiseStepWidths', () => {
  it('uses power-of-two à-trous step widths for the configured pass count', () => {
    expect(getPathTracingDenoiseStepWidths(4)).toEqual([1, 2, 4, 8])
  })

  it('clamps pass counts to the supported low-risk range', () => {
    expect(getPathTracingDenoiseStepWidths(-1)).toEqual([])
    expect(getPathTracingDenoiseStepWidths(99)).toEqual([1, 2, 4, 8])
  })
})


describe('isRecoverablePathTracingDenoiseGlError', () => {
  it('treats WebGL no-error as healthy and all concrete errors as denoise fallback triggers', () => {
    expect(isRecoverablePathTracingDenoiseGlError(0)).toBe(false)
    expect(isRecoverablePathTracingDenoiseGlError(1282)).toBe(true)
  })
})

describe('path tracing denoise guide helpers', () => {
  it('keeps object guide keys inside the non-background range', () => {
    expect(getPathTracingDenoiseObjectKey(1)).toBeGreaterThan(0)
    expect(getPathTracingDenoiseObjectKey(1)).toBeLessThanOrEqual(1)
    expect(getPathTracingDenoiseObjectKey(1)).not.toBe(
      getPathTracingDenoiseObjectKey(2),
    )
  })

  it('normalizes world-space depth tolerance by camera far distance', () => {
    expect(getPathTracingDenoiseNormalizedDepthPhi(0.08, 80)).toBeCloseTo(
      0.001,
    )
    expect(getPathTracingDenoiseNormalizedDepthPhi(Number.NaN, 80)).toBe(
      0.001,
    )
  })
})
