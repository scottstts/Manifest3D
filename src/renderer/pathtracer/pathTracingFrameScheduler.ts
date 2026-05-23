import { pathTracingViewportConfig } from './pathTracingConfig'

export type PathTracingFrameState = {
  needsSceneUpload: boolean
  sampleCount: number
}

export type PathTracingSampleCounterDenoiseStatus =
  | 'idle'
  | 'denoised'
  | 'denoising'
  | 'not-denoised'

export function formatPathTracingSampleCounter(
  sampleCount: number,
  denoiseStatus: PathTracingSampleCounterDenoiseStatus = 'idle',
) {
  const baseText = `${sampleCount} / ${pathTracingViewportConfig.maxSamples} samples`

  if (denoiseStatus === 'denoising') {
    return `${baseText} (denoising)`
  }

  if (denoiseStatus === 'denoised') {
    return `${baseText} (denoised)`
  }

  if (denoiseStatus === 'not-denoised') {
    return `${baseText} (not denoised)`
  }

  return baseText
}

export function shouldScheduleNextPathTracingFrame({
  needsSceneUpload,
  sampleCount,
}: PathTracingFrameState) {
  return needsSceneUpload || sampleCount < pathTracingViewportConfig.maxSamples
}
