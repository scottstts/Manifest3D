import { type ReactNode, type Ref } from 'react'
import {
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
} from 'lucide-react'
import type { AssetLibraryAsset } from '../engine/persistence/assetLibraryTypes'

type PendingCreateRunMenuItem = {
  asset: {
    assetId: string
    name: string
    versionNumber: number
  } | null
}

type AssetHistoryPanelProps = {
  activeAssetId: string | null
  assets: readonly AssetLibraryAsset[]
  isCollapsed: boolean
  modeLabel: 'View' | 'Add'
  onAssetDeleteRequested: (asset: AssetLibraryAsset) => void
  onAssetOpen: (asset: AssetLibraryAsset) => void
  onCollapsedChange: (collapsed: boolean) => void
  onPendingCreateRunOpen: () => void
  panelRef?: Ref<HTMLElement>
  pendingCreateRun?: PendingCreateRunMenuItem | null
}

export function AssetHistoryPanel({
  activeAssetId,
  assets,
  isCollapsed,
  modeLabel,
  onAssetDeleteRequested,
  onAssetOpen,
  onCollapsedChange,
  onPendingCreateRunOpen,
  panelRef,
  pendingCreateRun = null,
}: AssetHistoryPanelProps) {
  const visibleAssets = pendingCreateRun?.asset
    ? assets.filter((asset) => asset.assetId !== pendingCreateRun.asset?.assetId)
    : assets
  const hasMenuItems = visibleAssets.length > 0 || Boolean(pendingCreateRun)
  const menuItemCount = visibleAssets.length + (pendingCreateRun ? 1 : 0)

  return (
    <aside
      className={`asset-history-panel${isCollapsed ? ' is-collapsed' : ''}`}
      aria-label="Asset history"
      ref={panelRef}
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
            <span>{menuItemCount}</span>
          </div>
          {!hasMenuItems ? (
            <p className="asset-history-panel__empty">No saved assets yet.</p>
          ) : (
            <ol className="asset-history-list">
              {pendingCreateRun && (
                <li
                  className="asset-history-list__pending"
                  key="pending-create-run"
                >
                  <AssetHistoryItemButton
                    meta={
                      pendingCreateRun.asset
                        ? `${modeLabel} latest chosen · v${pendingCreateRun.asset.versionNumber}`
                        : 'Agent running...'
                    }
                    name={pendingCreateRun.asset?.name ?? 'Creating'}
                    trailing={
                      pendingCreateRun.asset ? null : (
                        <LoaderCircle
                          aria-hidden="true"
                          className="asset-history-list__spinner"
                        />
                      )
                    }
                    onClick={onPendingCreateRunOpen}
                  />
                </li>
              )}
              {visibleAssets.map((asset) => {
                const versionCount = asset.versions.length
                const isActive = asset.assetId === activeAssetId

                return (
                  <li
                    className={isActive ? 'is-active' : ''}
                    key={asset.assetId}
                  >
                    <AssetHistoryItemButton
                      meta={`${modeLabel} latest chosen · v${versionCount}`}
                      name={asset.name}
                      onClick={() => onAssetOpen(asset)}
                    />
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

function AssetHistoryItemButton({
  meta,
  name,
  onClick,
  trailing = null,
}: {
  meta: string | null
  name: string
  onClick: () => void
  trailing?: ReactNode
}) {
  return (
    <button
      className="asset-history-list__asset"
      type="button"
      onClick={onClick}
    >
      <span className="asset-history-list__copy">
        <span className="asset-history-list__name">{name}</span>
        {meta && <span className="asset-history-list__meta">{meta}</span>}
      </span>
      {trailing}
    </button>
  )
}
