const denoisePreferenceStorageKey = 'manifest3d:pathtracer-denoiser-enabled'

export function readPathTracingDenoisePreference() {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return parsePathTracingDenoisePreference(
      window.localStorage.getItem(denoisePreferenceStorageKey),
    )
  } catch {
    return false
  }
}

export function writePathTracingDenoisePreference(isEnabled: boolean) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      denoisePreferenceStorageKey,
      formatPathTracingDenoisePreference(isEnabled),
    )
  } catch {
    // Denoiser choice is only a convenience preference.
  }
}

export function parsePathTracingDenoisePreference(value: unknown) {
  return value === 'true'
}

export function formatPathTracingDenoisePreference(isEnabled: boolean) {
  return isEnabled ? 'true' : 'false'
}
