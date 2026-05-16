import { Download } from 'lucide-react'
import type { ManifestAsset } from '../engine/schema/manifestTypes'

type ViewportToolbarProps = {
  selectedAsset: ManifestAsset | undefined
}

export function ViewportToolbar({ selectedAsset }: ViewportToolbarProps) {
  return (
    <div className="viewport-toolbar">
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
