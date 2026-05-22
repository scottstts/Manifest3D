import type { ViewportWorldMode } from '../renderer/viewportWorld'

type ViewportWorldModeControlProps = {
  isHistoryPanelCollapsed: boolean
  mode: ViewportWorldMode
  onModeChange: (mode: ViewportWorldMode) => void
}

const modeOptions = [
  {
    ariaLabel: 'Use light viewport world',
    iconClassName: 'fa-regular fa-sun',
    mode: 'light',
    title: 'Light viewport',
  },
  {
    ariaLabel: 'Use dark viewport world',
    iconClassName: 'fa-regular fa-moon',
    mode: 'dark',
    title: 'Dark viewport',
  },
] as const

export function ViewportWorldModeControl({
  isHistoryPanelCollapsed,
  mode,
  onModeChange,
}: ViewportWorldModeControlProps) {
  return (
    <div
      aria-label="Viewport world lighting"
      className={`viewport-world-mode-control${
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
