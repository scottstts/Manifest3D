import { pathTracingViewportConfig } from './pathTracingConfig'

export type PathTracingFrameState = {
  needsSceneUpload: boolean
  sampleCount: number
}

export function formatPathTracingSampleCounter(sampleCount: number) {
  return `${sampleCount} / ${pathTracingViewportConfig.maxSamples} samples`
}

export function shouldScheduleNextPathTracingFrame({
  needsSceneUpload,
  sampleCount,
}: PathTracingFrameState) {
  return needsSceneUpload || sampleCount < pathTracingViewportConfig.maxSamples
}
