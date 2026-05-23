type ViewportDenoiseControlProps = {
  isEnabled: boolean
  isHistoryPanelCollapsed: boolean
  isPathTracerMode: boolean
  onEnabledChange: (isEnabled: boolean) => void
}

export function ViewportDenoiseControl({
  isEnabled,
  isHistoryPanelCollapsed,
  isPathTracerMode,
  onEnabledChange,
}: ViewportDenoiseControlProps) {
  const className = [
    'viewport-denoise-control',
    isHistoryPanelCollapsed ? 'is-panel-collapsed' : '',
    isEnabled ? 'is-active' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className}>
      <button
        aria-label={
          isEnabled ? 'Disable path tracer denoiser' : 'Enable path tracer denoiser'
        }
        aria-pressed={isEnabled}
        disabled={!isPathTracerMode}
        title={
          isPathTracerMode
            ? 'Toggle final-frame path tracer denoising'
            : 'Denoiser is only available in path tracer mode'
        }
        type="button"
        onClick={() => onEnabledChange(!isEnabled)}
      >
        Denoiser
      </button>
    </div>
  )
}
