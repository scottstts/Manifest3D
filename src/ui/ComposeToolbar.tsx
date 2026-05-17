import { Copy, Move3D, RotateCw, Scale3D, Trash2 } from 'lucide-react'
import type { TransformTool } from '../renderer/WebGPUCanvas'

type ComposeToolbarProps = {
  activeTool: TransformTool
  disabled: boolean
  rightOffset: number
  onDelete: () => void
  onDuplicate: () => void
  onToolChange: (tool: TransformTool) => void
}

export function ComposeToolbar({
  activeTool,
  disabled,
  rightOffset,
  onDelete,
  onDuplicate,
  onToolChange,
}: ComposeToolbarProps) {
  return (
    <div
      className="compose-toolbar"
      style={{ right: `${rightOffset}px` }}
      aria-label="Compose tools"
    >
      <button
        aria-label="Duplicate selected asset"
        disabled={disabled}
        type="button"
        onClick={onDuplicate}
      >
        <Copy aria-hidden="true" />
      </button>
      <button
        aria-label="Delete selected asset from compose viewport"
        disabled={disabled}
        type="button"
        onClick={onDelete}
      >
        <Trash2 aria-hidden="true" />
      </button>
      <button
        aria-label="Move selected asset"
        className={activeTool === 'move' ? 'is-active' : ''}
        disabled={disabled}
        type="button"
        onClick={() => onToolChange(activeTool === 'move' ? null : 'move')}
      >
        <Move3D aria-hidden="true" />
      </button>
      <button
        aria-label="Rotate selected asset"
        className={activeTool === 'rotate' ? 'is-active' : ''}
        disabled={disabled}
        type="button"
        onClick={() => onToolChange(activeTool === 'rotate' ? null : 'rotate')}
      >
        <RotateCw aria-hidden="true" />
      </button>
      <button
        aria-label="Scale selected asset"
        className={activeTool === 'scale' ? 'is-active' : ''}
        disabled={disabled}
        type="button"
        onClick={() => onToolChange(activeTool === 'scale' ? null : 'scale')}
      >
        <Scale3D aria-hidden="true" />
      </button>
    </div>
  )
}
