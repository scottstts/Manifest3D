export type PathTracingFrameState = {
  needsFinalPost: boolean
  maxSamples: number
  needsSceneUpload: boolean
  sampleCount: number
}

export type PathTracingSampleLimitState = {
  interactionSampleLimit: number
  isCameraInteractionActive: boolean
  maxSamples: number
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

export function getPathTracingSampleLimit({
  interactionSampleLimit,
  isCameraInteractionActive,
  maxSamples,
}: PathTracingSampleLimitState) {
  if (!isCameraInteractionActive) {
    return maxSamples
  }

  return Math.min(maxSamples, Math.max(1, Math.floor(interactionSampleLimit)))
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
