import { PanelLeftClose, PanelLeftOpen, Trash2 } from 'lucide-react'
import type { AssetLibraryAsset } from '../engine/persistence/assetLibraryTypes'

type AssetHistoryPanelProps = {
  activeAssetId: string | null
  assets: readonly AssetLibraryAsset[]
  isCollapsed: boolean
  modeLabel: 'View' | 'Add'
  onAssetDeleteRequested: (asset: AssetLibraryAsset) => void
  onAssetOpen: (asset: AssetLibraryAsset) => void
  onCollapsedChange: (collapsed: boolean) => void
}

export function AssetHistoryPanel({
  activeAssetId,
  assets,
  isCollapsed,
  modeLabel,
  onAssetDeleteRequested,
  onAssetOpen,
  onCollapsedChange,
}: AssetHistoryPanelProps) {
  return (
    <aside
      className={`asset-history-panel${isCollapsed ? ' is-collapsed' : ''}`}
      aria-label="Asset history"
    >
      <button
        aria-expanded={!isCollapsed}
        aria-label={isCollapsed ? 'Expand asset history' : 'Collapse asset history'}
        className="asset-history-panel__toggle"
        type="button"
        onClick={() => onCollapsedChange(!isCollapsed)}
      >
        {isCollapsed ? (
          <PanelLeftOpen aria-hidden="true" />
        ) : (
          <PanelLeftClose aria-hidden="true" />
        )}
      </button>
      {!isCollapsed && (
        <div className="asset-history-panel__body">
          <div className="asset-history-panel__header">
            <h2>Assets</h2>
            <span>{assets.length}</span>
          </div>
          {assets.length === 0 ? (
            <p className="asset-history-panel__empty">No saved assets yet.</p>
          ) : (
            <ol className="asset-history-list">
              {assets.map((asset) => {
                const versionCount = asset.versions.length
                const isActive = asset.assetId === activeAssetId

                return (
                  <li
                    className={isActive ? 'is-active' : ''}
                    key={asset.assetId}
                  >
                    <button
                      className="asset-history-list__asset"
                      type="button"
                      onClick={() => onAssetOpen(asset)}
                    >
                      <span className="asset-history-list__name">
                        {asset.name}
                      </span>
                      <span className="asset-history-list__meta">
                        {modeLabel} latest chosen · v{versionCount}
                      </span>
                    </button>
                    <button
                      aria-label={`Delete ${asset.name}`}
                      className="asset-history-list__delete"
                      type="button"
                      onClick={() => onAssetDeleteRequested(asset)}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}
    </aside>
  )
}
