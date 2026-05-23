import type { ViewportRenderMode } from '../renderer/viewportRenderMode'

type ViewportRenderModeControlProps = {
  isHistoryPanelCollapsed: boolean
  mode: ViewportRenderMode
  onModeChange: (mode: ViewportRenderMode) => void
}

const modeOptions = [
  {
    ariaLabel: 'Use default WebGPU viewport renderer',
    iconClassName: 'fa-solid fa-bolt',
    mode: 'default',
    title: 'Default renderer',
  },
  {
    ariaLabel: 'Use path traced viewport renderer',
    iconClassName: 'fa-solid fa-camera',
    mode: 'pathtracer',
    title: 'Path tracer renderer',
  },
] as const

export function ViewportRenderModeControl({
  isHistoryPanelCollapsed,
  mode,
  onModeChange,
}: ViewportRenderModeControlProps) {
  return (
    <div
      aria-label="Viewport render mode"
      className={`viewport-render-mode-control${
        isHistoryPanelCollapsed ? ' is-panel-collapsed' : ''
      }`}
      role="group"
    >
      {modeOptions.map((option) => (
        <button
          aria-label={option.ariaLabel}
          aria-pressed={mode === option.mode}
          className={mode === option.mode ? 'is-active' : undefined}
          key={option.mode}
          title={option.title}
          type="button"
          onClick={() => onModeChange(option.mode)}
        >
          <i aria-hidden="true" className={option.iconClassName} />
        </button>
      ))}
    </div>
  )
}
