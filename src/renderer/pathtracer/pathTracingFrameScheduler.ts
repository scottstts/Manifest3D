export type PathTracingFrameState = {
  needsFinalPost: boolean
  maxSamples: number
  needsSceneUpload: boolean
  sampleCount: number
}

export type PathTracingDefaultPreviewState = {
  hasPriorityInputSignal: boolean
  isCameraInteractionActive: boolean
}

export type PathTracingDefaultPreviewHandoffState = {
  didPresentPathTracingFrame: boolean
  isCameraInteractionActive: boolean
  isDefaultPreviewActive: boolean
  needsFreshFrameBeforeReveal: boolean
}

export type PathTracingFinalPostState = {
  isCameraInteractionActive: boolean
  maxSamples: number
  needsFinalPost: boolean
  sampleCount: number
}

export type PathTracingWorkDeferralState = {
  hasPendingInput: boolean
}

export type PathTracingSampleCounterDenoiseStatus =
  | 'idle'
  | 'denoised'
  | 'denoising'
  | 'not-denoised-error'
  | 'not-denoised'

export function formatPathTracingSampleCounter(
  sampleCount: number,
  maxSamples: number,
  denoiseStatus: PathTracingSampleCounterDenoiseStatus = 'idle',
) {
  const baseText = `${sampleCount} / ${maxSamples} samples`

  if (denoiseStatus === 'denoising') {
    return `${baseText} (denoising)`
  }

  if (denoiseStatus === 'denoised') {
    return `${baseText} (denoised)`
  }

  if (denoiseStatus === 'not-denoised') {
    return `${baseText} (not denoised)`
  }

  if (denoiseStatus === 'not-denoised-error') {
    return `${baseText} (not denoised - error)`
  }

  return baseText
}

export function shouldScheduleNextPathTracingFrame({
  needsFinalPost,
  maxSamples,
  needsSceneUpload,
  sampleCount,
}: PathTracingFrameState) {
  return needsSceneUpload || needsFinalPost || sampleCount < maxSamples
}

export function shouldPausePathTracingForDefaultPreview({
  hasPriorityInputSignal,
  isCameraInteractionActive,
}: PathTracingDefaultPreviewState) {
  return isCameraInteractionActive || hasPriorityInputSignal
}

export function shouldCompletePathTracingDefaultPreviewHandoff({
  didPresentPathTracingFrame,
  isCameraInteractionActive,
  isDefaultPreviewActive,
  needsFreshFrameBeforeReveal,
}: PathTracingDefaultPreviewHandoffState) {
  if (!isDefaultPreviewActive || isCameraInteractionActive) {
    return false
  }

  return didPresentPathTracingFrame || !needsFreshFrameBeforeReveal
}

export function shouldRunPathTracingFinalPost({
  isCameraInteractionActive,
  maxSamples,
  needsFinalPost,
  sampleCount,
}: PathTracingFinalPostState) {
  return (
    !isCameraInteractionActive &&
    needsFinalPost &&
    sampleCount >= maxSamples
  )
}

export function shouldDeferPathTracingWork({
  hasPendingInput,
}: PathTracingWorkDeferralState) {
  return hasPendingInput
}
