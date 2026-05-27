type ViewportDenoiseControlProps = {
  isEnabled: boolean
  isHistoryPanelCollapsed: boolean
  onEnabledChange: (isEnabled: boolean) => void
}

export function ViewportDenoiseControl({
  isEnabled,
  isHistoryPanelCollapsed,
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
        title="Toggle final-frame path tracer denoising"
        type="button"
        onClick={() => onEnabledChange(!isEnabled)}
      >
        Denoiser
      </button>
    </div>
  )
}
