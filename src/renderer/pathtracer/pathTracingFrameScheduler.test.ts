import { describe, expect, it } from 'vitest'
import {
  formatPathTracingSampleCounter,
  shouldDeferPathTracingWork,
  shouldCompletePathTracingDefaultPreviewHandoff,
  shouldPausePathTracingForDefaultPreview,
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

  it('pauses path tracing work while the default WebGPU preview handles direct camera input', () => {
    expect(
      shouldPausePathTracingForDefaultPreview({
        hasPriorityInputSignal: false,
        isCameraInteractionActive: true,
      }),
    ).toBe(true)
  })

  it('pauses path tracing work immediately when viewport input is captured before OrbitControls starts', () => {
    expect(
      shouldPausePathTracingForDefaultPreview({
        hasPriorityInputSignal: true,
        isCameraInteractionActive: false,
      }),
    ).toBe(true)
  })

  it('resumes path tracing work once camera input has settled', () => {
    expect(
      shouldPausePathTracingForDefaultPreview({
        hasPriorityInputSignal: false,
        isCameraInteractionActive: false,
      }),
    ).toBe(false)
  })

  it('keeps the default preview visible after settle until a fresh path-traced frame is presented', () => {
    expect(
      shouldCompletePathTracingDefaultPreviewHandoff({
        didPresentPathTracingFrame: false,
        isCameraInteractionActive: false,
        isDefaultPreviewActive: true,
        needsFreshFrameBeforeReveal: true,
      }),
    ).toBe(false)
  })

  it('completes the default preview handoff after the settled path tracer presents a fresh frame', () => {
    expect(
      shouldCompletePathTracingDefaultPreviewHandoff({
        didPresentPathTracingFrame: true,
        isCameraInteractionActive: false,
        isDefaultPreviewActive: true,
        needsFreshFrameBeforeReveal: true,
      }),
    ).toBe(true)
  })

  it('does not complete the default preview handoff while camera input is active', () => {
    expect(
      shouldCompletePathTracingDefaultPreviewHandoff({
        didPresentPathTracingFrame: true,
        isCameraInteractionActive: true,
        isDefaultPreviewActive: true,
        needsFreshFrameBeforeReveal: true,
      }),
    ).toBe(false)
  })

  it('can end the default preview immediately when no camera change dirtied the path-traced frame', () => {
    expect(
      shouldCompletePathTracingDefaultPreviewHandoff({
        didPresentPathTracingFrame: false,
        isCameraInteractionActive: false,
        isDefaultPreviewActive: true,
        needsFreshFrameBeforeReveal: false,
      }),
    ).toBe(true)
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
