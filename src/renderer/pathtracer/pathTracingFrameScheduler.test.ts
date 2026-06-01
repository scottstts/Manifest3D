import { describe, expect, it } from 'vitest'
import {
  formatPathTracingSampleCounter,
  getPathTracingSampleLimit,
  shouldDeferPathTracingWork,
  shouldRunPathTracingFinalPost,
  shouldScheduleNextPathTracingFrame,
} from './pathTracingFrameScheduler'

describe('path tracing viewport frame scheduling', () => {
  it('keeps rendering while sample accumulation has not reached the configured maximum', () => {
    expect(
      shouldScheduleNextPathTracingFrame({
        maxSamples: 256,
        needsFinalPost: false,
        needsSceneUpload: false,
        sampleCount: 255,
      }),
    ).toBe(true)
  })

  it('stops the requestAnimationFrame loop after the final sample when no upload is pending', () => {
    expect(
      shouldScheduleNextPathTracingFrame({
        maxSamples: 256,
        needsFinalPost: false,
        needsSceneUpload: false,
        sampleCount: 256,
      }),
    ).toBe(false)
  })

  it('restarts the frame loop for a pending scene upload even after the previous accumulation completed', () => {
    expect(
      shouldScheduleNextPathTracingFrame({
        maxSamples: 256,
        needsFinalPost: false,
        needsSceneUpload: true,
        sampleCount: 256,
      }),
    ).toBe(true)
  })

  it('keeps one more frame for a dirty final post pass after accumulation completes', () => {
    expect(
      shouldScheduleNextPathTracingFrame({
        maxSamples: 256,
        needsFinalPost: true,
        needsSceneUpload: false,
        sampleCount: 256,
      }),
    ).toBe(true)
  })

  it('caps live accumulation while direct camera input is active', () => {
    expect(
      getPathTracingSampleLimit({
        interactionSampleLimit: 1,
        isCameraInteractionActive: true,
        maxSamples: 256,
      }),
    ).toBe(1)
  })

  it('uses the selected max sample count once camera input has settled', () => {
    expect(
      getPathTracingSampleLimit({
        interactionSampleLimit: 1,
        isCameraInteractionActive: false,
        maxSamples: 256,
      }),
    ).toBe(256)
  })
})

describe('shouldRunPathTracingFinalPost', () => {
  it('runs final post once accumulation reaches the max sample target', () => {
    expect(
      shouldRunPathTracingFinalPost({
        isCameraInteractionActive: false,
        maxSamples: 128,
        needsFinalPost: true,
        sampleCount: 128,
      }),
    ).toBe(true)
  })

  it('does not run final post while camera interaction is still active', () => {
    expect(
      shouldRunPathTracingFinalPost({
        isCameraInteractionActive: true,
        maxSamples: 128,
        needsFinalPost: true,
        sampleCount: 128,
      }),
    ).toBe(false)
  })

  it('does not rerun final post when the final output is clean', () => {
    expect(
      shouldRunPathTracingFinalPost({
        isCameraInteractionActive: false,
        maxSamples: 128,
        needsFinalPost: false,
        sampleCount: 128,
      }),
    ).toBe(false)
  })
})

describe('shouldDeferPathTracingWork', () => {
  it('yields path tracing work while the browser reports pending input', () => {
    expect(shouldDeferPathTracingWork({ hasPendingInput: true })).toBe(true)
  })

  it('continues path tracing work when there is no pending input', () => {
    expect(shouldDeferPathTracingWork({ hasPendingInput: false })).toBe(false)
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
