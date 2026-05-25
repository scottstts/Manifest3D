export type PathTracingFrameState = {
  maxSamples: number
  needsSceneUpload: boolean
  sampleCount: number
}

export type PathTracingSampleLimitState = {
  interactionSampleLimit: number
  isCameraInteractionActive: boolean
  maxSamples: number
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
  maxSamples,
  needsSceneUpload,
  sampleCount,
}: PathTracingFrameState) {
  return needsSceneUpload || sampleCount < maxSamples
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
