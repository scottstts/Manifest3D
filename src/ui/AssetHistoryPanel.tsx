import { type ReactNode, type Ref } from 'react'
import {
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
} from 'lucide-react'
import type { AssetLibraryAsset } from '../engine/persistence/assetLibraryTypes'

type PendingCreateRunMenuItem = {
  runId: string
  status: string | null
}

type RunningEditRunMenuItem = {
  assetId: string
  runId: string
  status: string | null
}

type AssetHistoryPanelProps = {
  activeAssetId: string | null
  assets: readonly AssetLibraryAsset[]
  isCollapsed: boolean
  modeLabel: 'View' | 'Add'
  onAgentRunOpen: (runId: string) => void
  onAssetDeleteRequested: (asset: AssetLibraryAsset) => void
  onAssetOpen: (asset: AssetLibraryAsset) => void
  onCollapsedChange: (collapsed: boolean) => void
  panelRef?: Ref<HTMLElement>
  pendingCreateRuns?: readonly PendingCreateRunMenuItem[]
  runningEditRuns?: readonly RunningEditRunMenuItem[]
}

export function AssetHistoryPanel({
  activeAssetId,
  assets,
  isCollapsed,
  modeLabel,
  onAgentRunOpen,
  onAssetDeleteRequested,
  onAssetOpen,
  onCollapsedChange,
  panelRef,
  pendingCreateRuns = [],
  runningEditRuns = [],
}: AssetHistoryPanelProps) {
  const hasMenuItems = assets.length > 0 || pendingCreateRuns.length > 0
  const menuItemCount = assets.length + pendingCreateRuns.length

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
              {pendingCreateRuns.map((run, index) => (
                <li
                  className="asset-history-list__pending"
                  key={run.runId}
                >
                  <AssetHistoryItemButton
                    meta={run.status ?? 'Agent running...'}
                    name={
                      pendingCreateRuns.length > 1
                        ? `Creating ${index + 1}`
                        : 'Creating'
                    }
                    trailing={
                      <LoaderCircle
                        aria-hidden="true"
                        className="asset-history-list__spinner"
                      />
                    }
                    onClick={() => onAgentRunOpen(run.runId)}
                  />
                </li>
              ))}
              {assets.map((asset) => {
                const versionCount = asset.versions.length
                const runningEditRun = runningEditRuns.find(
                  (run) => run.assetId === asset.assetId,
                )
                const isRunningEdit = Boolean(runningEditRun)
                const meta = isRunningEdit
                  ? (runningEditRun?.status ?? 'Editing...')
                  : `${modeLabel} latest chosen · ${versionCount} version${versionCount === 1 ? '' : 's'}`

                return (
                  <li
                    className={
                      activeAssetId === asset.assetId ? 'is-active' : undefined
                    }
                    key={asset.assetId}
                  >
                    <AssetHistoryItemButton
                      meta={meta}
                      name={asset.name}
                      trailing={
                        isRunningEdit ? (
                          <LoaderCircle
                            aria-hidden="true"
                            className="asset-history-list__spinner"
                          />
                        ) : null
                      }
                      onClick={() =>
                        runningEditRun
                          ? onAgentRunOpen(runningEditRun.runId)
                          : onAssetOpen(asset)
                      }
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
