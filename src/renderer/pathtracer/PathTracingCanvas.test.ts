import { describe, expect, it } from 'vitest'
import {
  formatPathTracingSampleCounter,
  shouldScheduleNextPathTracingFrame,
} from './pathTracingFrameScheduler'
import { pathTracingViewportConfig } from './pathTracingConfig'

describe('path tracing viewport frame scheduling', () => {
  it('keeps rendering while sample accumulation has not reached the configured maximum', () => {
    expect(
      shouldScheduleNextPathTracingFrame({
        needsSceneUpload: false,
        sampleCount: pathTracingViewportConfig.maxSamples - 1,
      }),
    ).toBe(true)
  })

  it('stops the requestAnimationFrame loop after the final sample when no upload is pending', () => {
    expect(
      shouldScheduleNextPathTracingFrame({
        needsSceneUpload: false,
        sampleCount: pathTracingViewportConfig.maxSamples,
      }),
    ).toBe(false)
  })

  it('restarts the frame loop for a pending scene upload even after the previous accumulation completed', () => {
    expect(
      shouldScheduleNextPathTracingFrame({
        needsSceneUpload: true,
        sampleCount: pathTracingViewportConfig.maxSamples,
      }),
    ).toBe(true)
  })
})

describe('formatPathTracingSampleCounter', () => {
  it('formats the visible counter without requiring React state updates per sample', () => {
    expect(formatPathTracingSampleCounter(18)).toBe(
      `18 / ${pathTracingViewportConfig.maxSamples} samples`,
    )
  })
})
