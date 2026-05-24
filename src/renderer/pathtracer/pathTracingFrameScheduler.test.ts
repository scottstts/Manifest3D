import { describe, expect, it } from 'vitest'
import {
  formatPathTracingSampleCounter,
  shouldScheduleNextPathTracingFrame,
} from './pathTracingFrameScheduler'

describe('path tracing viewport frame scheduling', () => {
  it('keeps rendering while sample accumulation has not reached the configured maximum', () => {
    expect(
      shouldScheduleNextPathTracingFrame({
        maxSamples: 256,
        needsSceneUpload: false,
        sampleCount: 255,
      }),
    ).toBe(true)
  })

  it('stops the requestAnimationFrame loop after the final sample when no upload is pending', () => {
    expect(
      shouldScheduleNextPathTracingFrame({
        maxSamples: 256,
        needsSceneUpload: false,
        sampleCount: 256,
      }),
    ).toBe(false)
  })

  it('restarts the frame loop for a pending scene upload even after the previous accumulation completed', () => {
    expect(
      shouldScheduleNextPathTracingFrame({
        maxSamples: 256,
        needsSceneUpload: true,
        sampleCount: 256,
      }),
    ).toBe(true)
  })
})

describe('formatPathTracingSampleCounter', () => {
  it('formats the visible counter without requiring React state updates per sample', () => {
    expect(formatPathTracingSampleCounter(18, 256)).toBe(`18 / 256 samples`)
  })

  it('adds denoise progress labels only when the final denoise pass is active or complete', () => {
    expect(formatPathTracingSampleCounter(256, 256, 'denoising')).toBe(
      `256 / 256 samples (denoising)`,
    )
    expect(formatPathTracingSampleCounter(256, 256, 'denoised')).toBe(
      `256 / 256 samples (denoised)`,
    )
  })

  it('marks the completed final image when the user leaves denoising off', () => {
    expect(formatPathTracingSampleCounter(128, 128, 'not-denoised')).toBe(
      `128 / 128 samples (not denoised)`,
    )
  })

  it('marks denoise fallback errors as not denoised', () => {
    expect(formatPathTracingSampleCounter(128, 128, 'not-denoised-error')).toBe(
      `128 / 128 samples (not denoised - error)`,
    )
  })
})
