import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import type { ManifestAsset } from '../engine/schema/manifestTypes'

type ViewportToolbarProps = {
  canNavigateNextVersion: boolean
  canNavigatePreviousVersion: boolean
  selectedAsset: ManifestAsset | undefined
  versionLabel: string | null
  onNavigateNextVersion: () => void
  onNavigatePreviousVersion: () => void
}

export function ViewportToolbar({
  canNavigateNextVersion,
  canNavigatePreviousVersion,
  selectedAsset,
  versionLabel,
  onNavigateNextVersion,
  onNavigatePreviousVersion,
}: ViewportToolbarProps) {
  return (
    <div className="viewport-toolbar">
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
