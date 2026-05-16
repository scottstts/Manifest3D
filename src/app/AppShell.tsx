import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
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
import {
  runManifestAgentLoop,
  type AgentLoopEvent,
} from '../engine/agent/agentLoop'
import { createCandidateHistory } from '../engine/agent/candidateHistory'
import { createOpenAIManifestClient } from '../engine/agent/openAiManifestClient'
import type { AgentImageAttachment } from '../engine/agent/providerClient'
import {
  createAgentEventTimelineItem,
  createCandidateHistoryTimeline,
  type AgentTimelineItem,
} from '../engine/agent/validationTimeline'

export function AppShell() {
  const [isSidePanelCollapsed, setIsSidePanelCollapsed] = useState(false)
  const [rightPanelOcclusionWidth, setRightPanelOcclusionWidth] = useState(0)
  const [agentEvents, setAgentEvents] = useState<AgentLoopEvent[]>([])
  const [agentStatus, setAgentStatus] = useState<string | null>(null)
  const [candidateTimelineItems, setCandidateTimelineItems] = useState<
    AgentTimelineItem[]
  >([])
  const [isAgentRunning, setIsAgentRunning] = useState(false)
  const sidePanelRef = useRef<HTMLElement | null>(null)
  const agentHistoryRef = useRef(createCandidateHistory())
  const openAIClientRef = useRef(createOpenAIManifestClient())
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
  const timelineItems = useMemo(
    () => [
      ...agentEvents.map(createAgentEventTimelineItem),
      ...candidateTimelineItems,
    ],
    [agentEvents, candidateTimelineItems],
  )
  const handlePromptSubmit = useCallback(
    (
      userPrompt: string,
      imageAttachments: readonly AgentImageAttachment[],
    ) => {
      if (isAgentRunning) {
        return
      }

      const runScene = sceneStore.getSnapshot().scene
      const runSelectedAsset = selectedAsset ?? null
      const mode = runSelectedAsset ? 'edit' : 'create'

      setAgentEvents([])
      setCandidateTimelineItems([])
      setAgentStatus(
        runSelectedAsset
          ? `Editing ${runSelectedAsset.name}`
          : 'Creating asset',
      )
      setIsAgentRunning(true)

      void runManifestAgentLoop(
        {
          imageAttachments,
          mode,
          runId: `agent:${Date.now().toString(36)}`,
          scene: runScene,
          selectedAsset: runSelectedAsset,
          userPrompt,
        },
        {
          client: openAIClientRef.current,
          history: agentHistoryRef.current,
          onEvent: (event) => {
            setAgentEvents((currentEvents) => [...currentEvents, event])
          },
          sceneStore,
        },
      )
        .then((result) => {
          setCandidateTimelineItems(
            createCandidateHistoryTimeline(result.history),
          )

          if (result.status === 'ready') {
            selectionStore.selectAsset(result.asset.id)
            setAgentStatus(`Ready: ${result.asset.name}`)
            return
          }

          setAgentStatus(result.message)
        })
        .catch((error: unknown) => {
          setAgentStatus(
            error instanceof Error
              ? error.message
              : 'The agent run failed unexpectedly.',
          )
        })
        .finally(() => {
          setIsAgentRunning(false)
        })
    },
    [isAgentRunning, sceneStore, selectedAsset, selectionStore],
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
          agentStatus={agentStatus}
          isCollapsed={isSidePanelCollapsed}
          isRunning={isAgentRunning}
          onCollapsedChange={setIsSidePanelCollapsed}
          onPromptSubmit={handlePromptSubmit}
          panelRef={sidePanelRef}
          timelineItems={timelineItems}
          validationReports={validationReports}
        />
      </main>
    </div>
  )
}
