import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  KeyRound,
  Redo2,
  Undo2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  canExportManifestAssetAnimation,
  type GlbExportMode,
} from '../engine/scene/exportGlb'
import type { ManifestAsset } from '../engine/schema/manifestTypes'

type ViewportToolbarProps = {
  isApiKeyLoaded: boolean
  canRedoCompose: boolean
  canUndoCompose: boolean
  canNavigateNextVersion: boolean
  canNavigatePreviousVersion: boolean
  exportAsset: ManifestAsset | undefined
  hasSessionApiKey: boolean
  versionLabel: string | null
  onApiKeyRequested: () => void
  onExportGlb: (mode: GlbExportMode) => void
  onRedoCompose: () => void
  onUndoCompose: () => void
  onNavigateNextVersion: () => void
  onNavigatePreviousVersion: () => void
}

export function ViewportToolbar({
  isApiKeyLoaded,
  canRedoCompose,
  canUndoCompose,
  canNavigateNextVersion,
  canNavigatePreviousVersion,
  exportAsset,
  hasSessionApiKey,
  versionLabel,
  onApiKeyRequested,
  onExportGlb,
  onRedoCompose,
  onUndoCompose,
  onNavigateNextVersion,
  onNavigatePreviousVersion,
}: ViewportToolbarProps) {
  const [openExportMenuAssetId, setOpenExportMenuAssetId] = useState<
    string | null
  >(null)
  const exportMenuRef = useRef<HTMLDivElement | null>(null)
  const canExportAnimation = exportAsset
    ? canExportManifestAssetAnimation(exportAsset)
    : false
  const isExportMenuOpen =
    Boolean(exportAsset) &&
    canExportAnimation &&
    openExportMenuAssetId === exportAsset?.id

  useEffect(() => {
    if (!isExportMenuOpen) {
      return undefined
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) {
        setOpenExportMenuAssetId(null)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenExportMenuAssetId(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isExportMenuOpen])

  const handleExportButtonClick = () => {
    if (!exportAsset) {
      return
    }

    if (canExportAnimation) {
      setOpenExportMenuAssetId((openAssetId) =>
        openAssetId === exportAsset.id ? null : exportAsset.id,
      )
      return
    }

    onExportGlb('static')
  }

  const handleExportChoice = (mode: GlbExportMode) => {
    setOpenExportMenuAssetId(null)
    onExportGlb(mode)
  }

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
      <div className="viewport-toolbar__export" ref={exportMenuRef}>
        <button
          aria-expanded={canExportAnimation ? isExportMenuOpen : undefined}
          aria-haspopup={canExportAnimation ? 'menu' : undefined}
          aria-label={
            exportAsset
              ? canExportAnimation
                ? `Choose static or dynamic GLB export for ${exportAsset.name}`
                : `Export ${exportAsset.name} as GLB`
              : 'Select an asset in Create to export GLB'
          }
          className={
            canExportAnimation
              ? 'viewport-toolbar__button viewport-toolbar__button--export-menu'
              : 'viewport-toolbar__button'
          }
          disabled={!exportAsset}
          type="button"
          onClick={handleExportButtonClick}
        >
          <Download aria-hidden="true" />
          <span>Export GLB</span>
          {canExportAnimation && (
            <ChevronDown
              aria-hidden="true"
              className="viewport-toolbar__chevron"
            />
          )}
        </button>
        {canExportAnimation && isExportMenuOpen && (
          <div
            aria-label="GLB export type"
            className="viewport-toolbar__export-menu"
            role="menu"
          >
            <button
              role="menuitem"
              type="button"
              onClick={() => handleExportChoice('static')}
            >
              Static
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => handleExportChoice('dynamic')}
            >
              Dynamic
            </button>
          </div>
        )}
      </div>
      <button
        aria-label={
          hasSessionApiKey
            ? 'Update in-memory provider API key'
            : isApiKeyLoaded
              ? 'Provider API key loaded'
              : 'Add provider API key'
        }
        className="viewport-toolbar__button viewport-toolbar__button--api-key"
        type="button"
        onClick={onApiKeyRequested}
      >
        <KeyRound aria-hidden="true" />
        <span>API Key</span>
        <span
          aria-hidden="true"
          className={
            isApiKeyLoaded
              ? 'viewport-toolbar__api-key-dot is-loaded'
              : 'viewport-toolbar__api-key-dot'
          }
        />
      </button>
      <a
        aria-label="Open Manifest3D GitHub repository"
        className="viewport-toolbar__button viewport-toolbar__button--github"
        href="https://github.com/scottstts/Manifest3D"
        rel="noopener noreferrer"
        target="_blank"
      >
        <i aria-hidden="true" className="fa-brands fa-github" />
        <span>Manifest3D</span>
      </a>
    </div>
  )
}
