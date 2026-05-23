export type ViewportRenderMode = 'default' | 'pathtracer'

export function isViewportRenderMode(value: string): value is ViewportRenderMode {
  return value === 'default' || value === 'pathtracer'
}

export function allowsAnimationPreviewPlayback(mode: ViewportRenderMode) {
  return mode === 'default'
}
export type ViewportNavigationBehavior = {
  enableDamping: boolean
  snapSelectionImmediately: boolean
}

export function getViewportNavigationBehavior(
  mode: ViewportRenderMode,
): ViewportNavigationBehavior {
  if (mode === 'pathtracer') {
    return {
      enableDamping: false,
      snapSelectionImmediately: true,
    }
  }

  return {
    enableDamping: true,
    snapSelectionImmediately: false,
  }
}
