import {
  ChevronLeft,
  ChevronRight,
  Download,
  Redo2,
  Undo2,
} from 'lucide-react'
import type { ManifestAsset } from '../engine/schema/manifestTypes'

type ViewportToolbarProps = {
  canRedoCompose: boolean
  canUndoCompose: boolean
  canNavigateNextVersion: boolean
  canNavigatePreviousVersion: boolean
  selectedAsset: ManifestAsset | undefined
  versionLabel: string | null
  onRedoCompose: () => void
  onUndoCompose: () => void
  onNavigateNextVersion: () => void
  onNavigatePreviousVersion: () => void
}

export function ViewportToolbar({
  canRedoCompose,
  canUndoCompose,
  canNavigateNextVersion,
  canNavigatePreviousVersion,
  selectedAsset,
  versionLabel,
  onRedoCompose,
  onUndoCompose,
  onNavigateNextVersion,
  onNavigatePreviousVersion,
}: ViewportToolbarProps) {
  return (
    <div className="viewport-toolbar">
      <div className="compose-history-toolbar" aria-label="Compose history">
        <button
          aria-label="Undo compose action"
          className="viewport-toolbar__icon-button"
          disabled={!canUndoCompose}
          type="button"
          onClick={onUndoCompose}
        >
          <Undo2 aria-hidden="true" />
        </button>
        <button
          aria-label="Redo compose action"
          className="viewport-toolbar__icon-button"
          disabled={!canRedoCompose}
          type="button"
          onClick={onRedoCompose}
        >
          <Redo2 aria-hidden="true" />
        </button>
      </div>
      <div className="version-toolbar" aria-label="Asset versions">
        <button
          aria-label="Previous asset version"
          className="viewport-toolbar__icon-button"
          disabled={!canNavigatePreviousVersion}
          type="button"
          onClick={onNavigatePreviousVersion}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <span className="version-toolbar__label">
          {versionLabel ?? 'No versions'}
        </span>
        <button
          aria-label="Next asset version"
          className="viewport-toolbar__icon-button"
          disabled={!canNavigateNextVersion}
          type="button"
          onClick={onNavigateNextVersion}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
      <button
        aria-label={
          selectedAsset
            ? `Export ${selectedAsset.name} as GLB`
            : 'Select an asset to export GLB'
        }
        className="viewport-toolbar__button"
        disabled={!selectedAsset}
        type="button"
      >
        <Download aria-hidden="true" />
        <span>Export GLB</span>
      </button>
    </div>
  )
}
