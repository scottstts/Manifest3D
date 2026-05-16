import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  useAppStores,
  useSceneSnapshot,
  useSelectionSnapshot,
} from './appState'
import { ChatPanel } from '../ui/ChatPanel'
import { FrameChrome } from '../ui/FrameChrome'
import { WebGPUCanvas } from '../renderer/WebGPUCanvas'
import { getRightSidePanelOcclusionWidth } from '../renderer/effectiveViewport'
import { validateManifestAssetCandidate } from '../engine/validation/validateManifest'

export function AppShell() {
  const [isSidePanelCollapsed, setIsSidePanelCollapsed] = useState(false)
  const [rightPanelOcclusionWidth, setRightPanelOcclusionWidth] = useState(0)
  const sidePanelRef = useRef<HTMLElement | null>(null)
  const { sceneStore, selectionStore } = useAppStores()
  const { scene } = useSceneSnapshot(sceneStore)
  const { revision: selectionRevision, selection } =
    useSelectionSnapshot(selectionStore)
  const selectedAsset = selection.assetId
    ? scene.assets.find((asset) => asset.id === selection.assetId)
    : undefined
  const validationReports = useMemo(
    () =>
      scene.assets.map(
        (asset) => validateManifestAssetCandidate(asset).report,
      ),
    [scene.assets],
  )

  useLayoutEffect(() => {
    const sidePanel = sidePanelRef.current

    if (!sidePanel) {
      return undefined
    }

    const measuredSidePanel = sidePanel
    let animationFrame = 0

    function measureSidePanel() {
      const nextOcclusionWidth = Math.round(
        getRightSidePanelOcclusionWidth(
          measuredSidePanel.getBoundingClientRect(),
          window.innerWidth,
        ),
      )

      setRightPanelOcclusionWidth((currentOcclusionWidth) =>
        currentOcclusionWidth === nextOcclusionWidth
          ? currentOcclusionWidth
          : nextOcclusionWidth,
      )
    }

    function queueMeasure() {
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(measureSidePanel)
    }

    measureSidePanel()

    const resizeObserver = new ResizeObserver(queueMeasure)

    resizeObserver.observe(measuredSidePanel)
    window.addEventListener('resize', queueMeasure)
    measuredSidePanel.addEventListener('transitionend', queueMeasure)

    return () => {
      cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      window.removeEventListener('resize', queueMeasure)
      measuredSidePanel.removeEventListener('transitionend', queueMeasure)
    }
  }, [isSidePanelCollapsed])

  return (
    <div className="app-shell">
      <WebGPUCanvas
        assets={scene.assets}
        isSidePanelCollapsed={isSidePanelCollapsed}
        rightPanelOcclusionWidth={rightPanelOcclusionWidth}
        selectedAssetId={selection.assetId}
        selectionRevision={selectionRevision}
        onAssetSelected={selectionStore.selectAsset}
        onSelectionCleared={selectionStore.clearSelection}
      />
      <FrameChrome selectedAsset={selectedAsset} />
      <main className="app-overlays" aria-label="Manifest3D creation workspace">
        <ChatPanel
          isCollapsed={isSidePanelCollapsed}
          onCollapsedChange={setIsSidePanelCollapsed}
          panelRef={sidePanelRef}
          validationReports={validationReports}
        />
      </main>
    </div>
  )
}
