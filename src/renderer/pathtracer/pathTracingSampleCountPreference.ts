import { pathTracingViewportConfig } from './pathTracingConfig'

export type PathTracingMaxSampleCount =
  (typeof pathTracingViewportConfig.maxSampleOptions)[number]

const sampleCountPreferenceStorageKey = 'manifest3d:pathtracer-max-samples'
const defaultPathTracingMaxSampleCount = pathTracingViewportConfig
  .maxSampleOptions[0]

export function getPathTracingMaxSampleOptions() {
  return [...pathTracingViewportConfig.maxSampleOptions]
}

export function readPathTracingMaxSamplePreference(): PathTracingMaxSampleCount {
  if (typeof window === 'undefined') {
    return defaultPathTracingMaxSampleCount
  }

  try {
    return parsePathTracingMaxSamplePreference(
      window.localStorage.getItem(sampleCountPreferenceStorageKey),
    )
  } catch {
    return defaultPathTracingMaxSampleCount
  }
}

export function writePathTracingMaxSamplePreference(
  maxSamples: PathTracingMaxSampleCount,
) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      sampleCountPreferenceStorageKey,
      formatPathTracingMaxSamplePreference(maxSamples),
    )
  } catch {
    // Max-sample choice is only a viewport convenience preference.
  }
}

export function parsePathTracingMaxSamplePreference(
  value: unknown,
): PathTracingMaxSampleCount {
  const parsedValue =
    typeof value === 'number' ? value : Number.parseInt(String(value), 10)

  if (isPathTracingMaxSampleCount(parsedValue)) {
    return parsedValue
  }

  return defaultPathTracingMaxSampleCount
}

export function formatPathTracingMaxSamplePreference(
  maxSamples: PathTracingMaxSampleCount,
) {
  return String(maxSamples)
}

export function isPathTracingMaxSampleCount(
  value: number,
): value is PathTracingMaxSampleCount {
  return pathTracingViewportConfig.maxSampleOptions.includes(
    value as PathTracingMaxSampleCount,
  )
}
