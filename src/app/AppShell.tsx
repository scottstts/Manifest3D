import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  useAppStores,
  useAssetLibrarySnapshot,
  useSceneSnapshot,
  useSelectionSnapshot,
} from './appState'
import {
  ChatPanel,
  type ChatPanelPromptMode,
  type ChatPanelTranscriptItem,
} from '../ui/ChatPanel'
import { ComposeToolbar } from '../ui/ComposeToolbar'
import { ConfirmDeleteModal } from '../ui/ConfirmDeleteModal'
import { AssetHistoryPanel } from '../ui/AssetHistoryPanel'
import { ApiKeyModal } from '../ui/ApiKeyModal'
import { FrameChrome } from '../ui/FrameChrome'
import { WebGPUCanvas, type TransformTool } from '../renderer/WebGPUCanvas'
import { getRightSidePanelOcclusionWidth } from '../renderer/effectiveViewport'
import { validateManifestAssetCandidate } from '../engine/validation/validateManifest'
import {
  runManifestAgentLoop,
  type AgentLoopEvent,
} from '../engine/agent/agentLoop'
import { createCandidateHistory } from '../engine/agent/candidateHistory'
import { resolveStartupOpenAIApiKeyStatus } from '../engine/agent/openAiApiKey'
import { createOpenAIManifestClient } from '../engine/agent/openAiManifestClient'
import type {
  AgentImageAttachment,
  OpenAIManifestClient,
} from '../engine/agent/providerClient'
import {
  findAssetLibraryVersion,
  getAdjacentAssetVersions,
  getLastSelectedAssetVersion,
} from '../engine/persistence/assetLibraryModel'
import type {
  AssetLibraryAsset,
  AssetLibraryVersion,
  PersistedCandidateAttempt,
} from '../engine/persistence/assetLibraryTypes'
import type {
  SceneAssetInstance,
  SceneTransform,
  WorkspaceMode,
} from '../engine/scene/sceneStore'
import {
  createAgentEventTimelineItem,
  createCandidateHistoryTimeline,
  type AgentTimelineItem,
} from '../engine/agent/validationTimeline'
import {
  downloadGlbExport,
  exportManifestAssetGlb,
} from '../engine/scene/exportGlb'

type ComposeHistoryEntry = {
  instances: readonly SceneAssetInstance[]
  selectedTargetId: string | null
}

const composeHistoryLimit = 40

export function AppShell() {
  const startupOpenAIApiKeyStatus = useMemo(
    () => resolveStartupOpenAIApiKeyStatus(),
    [],
  )
  const [isSidePanelCollapsed, setIsSidePanelCollapsed] = useState(false)
  const [isHistoryPanelCollapsed, setIsHistoryPanelCollapsed] = useState(true)
  const [rightPanelOcclusionWidth, setRightPanelOcclusionWidth] = useState(0)
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false)
  const [hasSessionApiKey, setHasSessionApiKey] = useState(false)
  const [openAIClient, setOpenAIClient] = useState<OpenAIManifestClient>(() =>
    createOpenAIManifestClient({
      apiKey: startupOpenAIApiKeyStatus.apiKey,
    }),
  )
  const [agentEvents, setAgentEvents] = useState<AgentLoopEvent[]>([])
  const [agentStatus, setAgentStatus] = useState<string | null>(null)
  const [candidateTimelineItems, setCandidateTimelineItems] = useState<
    AgentTimelineItem[]
  >([])
  const [chatTranscriptItems, setChatTranscriptItems] = useState<
    ChatPanelTranscriptItem[]
  >([])
  const [isAgentRunning, setIsAgentRunning] = useState(false)
  const [activeTransformTool, setActiveTransformTool] =
    useState<TransformTool>(null)
  const [assetPendingDelete, setAssetPendingDelete] =
    useState<AssetLibraryAsset | null>(null)
  const [exportToastId, setExportToastId] = useState<number | null>(null)
  const [composeUndoStack, setComposeUndoStack] = useState<
    ComposeHistoryEntry[]
  >([])
  const [composeRedoStack, setComposeRedoStack] = useState<
    ComposeHistoryEntry[]
  >([])
  const sidePanelRef = useRef<HTMLElement | null>(null)
  const pendingTransformHistoryRef = useRef<ComposeHistoryEntry | null>(null)
  const exportToastTimeoutRef = useRef<number | null>(null)
  const agentRunAbortControllerRef = useRef<AbortController | null>(null)
  const agentHistoryRef = useRef(createCandidateHistory())
  const { assetLibraryStore, sceneStore, selectionStore } = useAppStores()
  const librarySnapshot = useAssetLibrarySnapshot(assetLibraryStore)
  const sceneSnapshot = useSceneSnapshot(sceneStore)
  const { scene } = sceneSnapshot
  const { revision: selectionRevision, selection } =
    useSelectionSnapshot(selectionStore)
  const selectedInstance = selection.targetId
    ? sceneSnapshot.renderableAssets.find(
        (instance) => instance.instanceId === selection.targetId,
      )
    : undefined
  const selectedAsset = selectedInstance?.asset
  const exportableCreateAsset =
    sceneSnapshot.activeWorkspace === 'create' &&
    selectedInstance?.instanceId === 'create'
      ? selectedInstance.asset
      : undefined
  const selectedLibraryAsset = selectedAsset
    ? librarySnapshot.library.assets.find(
        (asset) => asset.assetId === selectedAsset.id,
      )
    : undefined
  const selectedVersionId = selectedInstance?.versionId ?? null
  const adjacentVersions = getAdjacentAssetVersions(
    selectedLibraryAsset ?? null,
    selectedVersionId,
  )
  const versionLabel =
    selectedLibraryAsset && adjacentVersions.currentIndex >= 0
      ? `v${adjacentVersions.currentIndex + 1}/${selectedLibraryAsset.versions.length}`
      : null
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
  const composeToolbarRightOffset = Math.max(28, rightPanelOcclusionWidth + 28)
  const composeSelectionActive =
    sceneSnapshot.activeWorkspace === 'compose' && Boolean(selectedInstance)
  const promptMode: ChatPanelPromptMode =
    sceneSnapshot.activeWorkspace === 'create' &&
    selectedInstance?.instanceId === 'create'
      ? 'editing'
      : 'creating'
  const canUndoCompose =
    sceneSnapshot.activeWorkspace === 'compose' && composeUndoStack.length > 0
  const canRedoCompose =
    sceneSnapshot.activeWorkspace === 'compose' && composeRedoStack.length > 0
  const isLocalEnvApiKeyLoaded = startupOpenAIApiKeyStatus.source === 'local_env'

  useEffect(() => {
    void assetLibraryStore.load()
  }, [assetLibraryStore])

  useEffect(
    () => () => {
      if (exportToastTimeoutRef.current !== null) {
        window.clearTimeout(exportToastTimeoutRef.current)
      }
    },
    [],
  )

  const captureComposeHistoryEntry = useCallback(
    (): ComposeHistoryEntry => ({
      instances: cloneSceneAssetInstances(
        sceneStore.getSnapshot().composeInstances,
      ),
      selectedTargetId: selectionStore.getSnapshot().selection.targetId,
    }),
    [sceneStore, selectionStore],
  )

  const pushComposeUndoEntry = useCallback((entry: ComposeHistoryEntry) => {
    setComposeUndoStack((currentStack) => [
      ...currentStack.slice(-(composeHistoryLimit - 1)),
      entry,
    ])
    setComposeRedoStack([])
  }, [])

  const clearComposeHistory = useCallback(() => {
    setComposeUndoStack([])
    setComposeRedoStack([])
    pendingTransformHistoryRef.current = null
  }, [])

  const restoreComposeHistoryEntry = useCallback(
    (entry: ComposeHistoryEntry) => {
      sceneStore.setComposeInstances(entry.instances)

      const selectedInstance = entry.selectedTargetId
        ? entry.instances.find(
            (instance) => instance.instanceId === entry.selectedTargetId,
          )
        : null

      if (selectedInstance) {
        selectionStore.selectAsset(
          selectedInstance.instanceId,
          selectedInstance.assetId,
        )
      } else {
        selectionStore.clearSelection()
        setActiveTransformTool(null)
      }
    },
    [sceneStore, selectionStore],
  )

  const handleUndoCompose = useCallback(() => {
    if (sceneStore.getSnapshot().activeWorkspace !== 'compose') {
      return
    }

    const entry = composeUndoStack.at(-1)

    if (!entry) {
      return
    }

    pendingTransformHistoryRef.current = null
    setComposeUndoStack((currentStack) => currentStack.slice(0, -1))
    setComposeRedoStack((currentStack) => [
      ...currentStack.slice(-(composeHistoryLimit - 1)),
      captureComposeHistoryEntry(),
    ])
    restoreComposeHistoryEntry(entry)
  }, [
    captureComposeHistoryEntry,
    composeUndoStack,
    restoreComposeHistoryEntry,
    sceneStore,
  ])

  const handleRedoCompose = useCallback(() => {
    if (sceneStore.getSnapshot().activeWorkspace !== 'compose') {
      return
    }

    const entry = composeRedoStack.at(-1)

    if (!entry) {
      return
    }

    pendingTransformHistoryRef.current = null
    setComposeRedoStack((currentStack) => currentStack.slice(0, -1))
    setComposeUndoStack((currentStack) => [
      ...currentStack.slice(-(composeHistoryLimit - 1)),
      captureComposeHistoryEntry(),
    ])
    restoreComposeHistoryEntry(entry)
  }, [
    captureComposeHistoryEntry,
    composeRedoStack,
    restoreComposeHistoryEntry,
    sceneStore,
  ])

  const handlePromptSubmit = useCallback(
    (
      userPrompt: string,
      imageAttachments: readonly AgentImageAttachment[],
    ) => {
      if (isAgentRunning || sceneSnapshot.activeWorkspace !== 'create') {
        return
      }

      const runId = `agent:${Date.now().toString(36)}`
      const runSelectedInstance =
        sceneSnapshot.activeWorkspace === 'create' &&
        selectedInstance?.instanceId === 'create'
          ? selectedInstance
          : null
      const runSelectedAsset = runSelectedInstance?.asset ?? null
      const runSelectedVersion =
        runSelectedInstance?.assetId && runSelectedInstance.versionId
          ? findAssetLibraryVersion(
              librarySnapshot.library,
              runSelectedInstance.assetId,
              runSelectedInstance.versionId,
            )
          : null
      const mode = runSelectedAsset ? 'edit' : 'create'
      const runStatus = runSelectedAsset
        ? `Editing ${runSelectedAsset.name}`
        : 'Creating asset'
      const assistantMessageId = `${runId}:assistant`
      const abortController = new AbortController()

      if (mode === 'create') {
        sceneStore.clearCreateAsset()
        selectionStore.clearSelection()
      }

      const runScene = sceneStore.getSnapshot().scene

      setAgentEvents([])
      setCandidateTimelineItems([])
      setAgentStatus(runStatus)
      setChatTranscriptItems((currentItems) => {
        const runItems: ChatPanelTranscriptItem[] = [
          {
            id: `${runId}:user`,
            imageAttachments,
            role: 'user',
            text: userPrompt,
          },
          {
            id: assistantMessageId,
            role: 'agent',
            status: runStatus,
            timelineItems: [],
          },
        ]

        return mode === 'create' ? runItems : [...currentItems, ...runItems]
      })
      setIsAgentRunning(true)
      agentRunAbortControllerRef.current = abortController

      let runEvents: AgentLoopEvent[] = []

      void runManifestAgentLoop(
        {
          imageAttachments,
          mode,
          runId,
          scene: runScene,
          selectedAsset: runSelectedAsset,
          selectedAssetAttemptContext: runSelectedVersion
            ? formatAttemptContext(runSelectedVersion)
            : null,
          signal: abortController.signal,
          userPrompt,
        },
        {
          client: openAIClient,
          history: agentHistoryRef.current,
          onEvent: (event) => {
            runEvents = upsertAgentEvent(runEvents, event)

            const currentTimeline = runEvents.map(createAgentEventTimelineItem)

            setAgentEvents(runEvents)
            setChatTranscriptItems((currentItems) =>
              updateAgentTranscriptItem(currentItems, assistantMessageId, {
                timelineItems: currentTimeline,
              }),
            )
          },
          sceneStore,
        },
      )
        .then(async (result) => {
          const resultTimelineItems = [
            ...runEvents.map(createAgentEventTimelineItem),
            ...createCandidateHistoryTimeline(result.history),
          ]

          setCandidateTimelineItems(createCandidateHistoryTimeline(result.history))

          if (result.status !== 'ready') {
            setAgentStatus(result.message)
            setChatTranscriptItems((currentItems) =>
              updateAgentTranscriptItem(currentItems, assistantMessageId, {
                status: result.message,
                timelineItems: resultTimelineItems,
              }),
            )
            return
          }

          const savedVersion = await assetLibraryStore.saveValidatedVersion({
            asset: result.asset,
            history: result.history,
            parentVersionId:
              mode === 'edit' ? runSelectedInstance?.versionId ?? null : null,
            validationReport: result.report,
          })

          sceneStore.setCreateAsset(result.asset, savedVersion.versionId)
          selectionStore.selectAsset('create', result.asset.id)
          setAgentStatus(`Ready: ${result.asset.name}`)
          setChatTranscriptItems((currentItems) =>
            updateAgentTranscriptItem(currentItems, assistantMessageId, {
              status: `Ready: ${result.asset.name}`,
              timelineItems: resultTimelineItems,
            }),
          )
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error
              ? error.message
              : 'The agent run failed unexpectedly.'

          setAgentStatus(message)
          setChatTranscriptItems((currentItems) =>
            updateAgentTranscriptItem(currentItems, assistantMessageId, {
              status: message,
              timelineItems: runEvents.map(createAgentEventTimelineItem),
            }),
          )
        })
        .finally(() => {
          if (agentRunAbortControllerRef.current === abortController) {
            agentRunAbortControllerRef.current = null
          }

          setIsAgentRunning(false)
        })
    },
    [
      assetLibraryStore,
      isAgentRunning,
      librarySnapshot.library,
      openAIClient,
      sceneSnapshot.activeWorkspace,
      sceneStore,
      selectedInstance,
      selectionStore,
    ],
  )

  const handleStopAgentRun = useCallback(() => {
    if (!isAgentRunning) {
      return
    }

    agentRunAbortControllerRef.current?.abort()
    setAgentStatus('Stopping agent run...')
  }, [isAgentRunning])

  const handleNewCreateAsset = useCallback(() => {
    if (isAgentRunning) {
      return
    }

    setAgentEvents([])
    setCandidateTimelineItems([])
    setChatTranscriptItems([])
    setAgentStatus(null)
    sceneStore.clearCreateAsset()
    selectionStore.clearSelection()
    setActiveTransformTool(null)
  }, [isAgentRunning, sceneStore, selectionStore])

  const handleExportGlb = useCallback(() => {
    if (!exportableCreateAsset) {
      return
    }

    void exportManifestAssetGlb(exportableCreateAsset)
      .then((result) => {
        downloadGlbExport(result)
        setExportToastId(Date.now())

        if (exportToastTimeoutRef.current !== null) {
          window.clearTimeout(exportToastTimeoutRef.current)
        }

        exportToastTimeoutRef.current = window.setTimeout(() => {
          setExportToastId(null)
          exportToastTimeoutRef.current = null
        }, 3000)
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error
            ? error.message
            : 'The selected asset could not be exported as GLB.'
        const status = `Export failed: ${message}`

        setAgentStatus(status)
      })
  }, [exportableCreateAsset])

  const handleApiKeySubmit = useCallback((apiKey: string) => {
    setOpenAIClient(createOpenAIManifestClient({ apiKey }))
    setHasSessionApiKey(true)
    setIsApiKeyModalOpen(false)
    setAgentStatus('OpenAI API key loaded for this session.')
  }, [])

  const handleWorkspaceChange = useCallback(
    (workspace: WorkspaceMode) => {
      sceneStore.setWorkspace(workspace)
      selectionStore.clearSelection()
      setActiveTransformTool(null)
    },
    [sceneStore, selectionStore],
  )

  const handleHistoryAssetOpen = useCallback(
    (asset: AssetLibraryAsset) => {
      const version = getLastSelectedAssetVersion(asset)

      void assetLibraryStore.setLastSelectedVersion(
        asset.assetId,
        version.versionId,
      )
      setAgentEvents([])
      setChatTranscriptItems([])
      setCandidateTimelineItems(createVersionTimeline(version))
      setAgentStatus(`Loaded ${asset.name} v${version.versionNumber}`)

      if (sceneSnapshot.activeWorkspace === 'compose') {
        clearComposeHistory()
        const instance = sceneStore.addComposeAsset(
          version.asset,
          version.versionId,
        )

        selectionStore.selectAsset(instance.instanceId, instance.assetId)
        return
      }

      sceneStore.setWorkspace('create')
      sceneStore.setCreateAsset(version.asset, version.versionId)
      selectionStore.selectAsset('create', version.asset.id)
    },
    [
      assetLibraryStore,
      clearComposeHistory,
      sceneSnapshot.activeWorkspace,
      sceneStore,
      selectionStore,
    ],
  )

  const handleConfirmDeleteAsset = useCallback(() => {
    if (!assetPendingDelete) {
      return
    }

    void assetLibraryStore
      .deleteAsset(assetPendingDelete.assetId)
      .then(() => {
        clearComposeHistory()
        sceneStore.removeAsset(assetPendingDelete.assetId)

        if (selection.assetId === assetPendingDelete.assetId) {
          selectionStore.clearSelection()
        }
      })
      .finally(() => {
        setAssetPendingDelete(null)
      })
  }, [
    assetLibraryStore,
    assetPendingDelete,
    clearComposeHistory,
    sceneStore,
    selection.assetId,
    selectionStore,
  ])

  const handleNavigateVersion = useCallback(
    (version: AssetLibraryVersion | null) => {
      if (!version || !selectedInstance) {
        return
      }

      void assetLibraryStore.setLastSelectedVersion(
        version.assetId,
        version.versionId,
      )
      setAgentEvents([])
      setChatTranscriptItems([])
      setCandidateTimelineItems(createVersionTimeline(version))
      setAgentStatus(`Loaded ${version.asset.name} v${version.versionNumber}`)

      if (selectedInstance.instanceId === 'create') {
        sceneStore.setCreateAsset(version.asset, version.versionId)
        selectionStore.selectAsset('create', version.assetId)
        return
      }

      clearComposeHistory()
      sceneStore.setComposeInstanceVersion(
        selectedInstance.instanceId,
        version.asset,
        version.versionId,
      )
      selectionStore.selectAsset(selectedInstance.instanceId, version.assetId)
    },
    [
      assetLibraryStore,
      clearComposeHistory,
      sceneStore,
      selectedInstance,
      selectionStore,
    ],
  )

  const handleDuplicateComposeSelection = useCallback(() => {
    if (!selectedInstance) {
      return
    }

    const beforeDuplicate = captureComposeHistoryEntry()
    const duplicate = sceneStore.duplicateComposeInstance(
      selectedInstance.instanceId,
    )

    if (duplicate) {
      pushComposeUndoEntry(beforeDuplicate)
      selectionStore.selectAsset(duplicate.instanceId, duplicate.assetId)
    }
  }, [
    captureComposeHistoryEntry,
    pushComposeUndoEntry,
    sceneStore,
    selectedInstance,
    selectionStore,
  ])

  const handleDeleteComposeSelection = useCallback(() => {
    if (!selectedInstance) {
      return
    }

    pushComposeUndoEntry(captureComposeHistoryEntry())
    sceneStore.removeComposeInstance(selectedInstance.instanceId)
    selectionStore.clearSelection()
    setActiveTransformTool(null)
  }, [
    captureComposeHistoryEntry,
    pushComposeUndoEntry,
    sceneStore,
    selectedInstance,
    selectionStore,
  ])

  const handleTransformStarted = useCallback(() => {
    if (sceneStore.getSnapshot().activeWorkspace !== 'compose') {
      return
    }

    pendingTransformHistoryRef.current = captureComposeHistoryEntry()
  }, [captureComposeHistoryEntry, sceneStore])

  const handleTransformEnded = useCallback(() => {
    pendingTransformHistoryRef.current = null
  }, [])

  const handleTransformChanged = useCallback(
    (instanceId: string, transform: SceneTransform) => {
      if (sceneSnapshot.activeWorkspace !== 'compose') {
        return
      }

      const pendingEntry = pendingTransformHistoryRef.current

      if (
        pendingEntry &&
        hasTransformChanged(instanceId, transform, pendingEntry.instances)
      ) {
        pushComposeUndoEntry(pendingEntry)
        pendingTransformHistoryRef.current = null
      }

      sceneStore.updateComposeInstanceTransform(instanceId, transform)
    },
    [pushComposeUndoEntry, sceneSnapshot.activeWorkspace, sceneStore],
  )

  useEffect(() => {
    function handleComposeKeyDown(event: KeyboardEvent) {
      if (
        sceneStore.getSnapshot().activeWorkspace !== 'compose' ||
        event.repeat ||
        isEditableKeyboardTarget(event.target)
      ) {
        return
      }

      const key = event.key.toLowerCase()
      const hasCommandModifier = event.metaKey || event.ctrlKey
      const hasOnlyShortcutModifier =
        hasCommandModifier && !event.altKey && !event.shiftKey

      if (hasOnlyShortcutModifier && key === 'z') {
        event.preventDefault()
        handleUndoCompose()
        return
      }

      if (hasOnlyShortcutModifier && key === 'd') {
        event.preventDefault()
        handleDuplicateComposeSelection()
        return
      }

      if (
        key === 'backspace' ||
        (key === 'delete' && !event.metaKey && !event.ctrlKey)
      ) {
        if (selectedInstance) {
          event.preventDefault()
          handleDeleteComposeSelection()
        }

        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (key === 'g') {
        event.preventDefault()
        setActiveTransformTool(selectedInstance ? 'move' : null)
        return
      }

      if (key === 'r') {
        event.preventDefault()
        setActiveTransformTool(selectedInstance ? 'rotate' : null)
        return
      }

      if (key === 's') {
        event.preventDefault()
        setActiveTransformTool(selectedInstance ? 'scale' : null)
      }
    }

    window.addEventListener('keydown', handleComposeKeyDown)

    return () => {
      window.removeEventListener('keydown', handleComposeKeyDown)
    }
  }, [
    handleDeleteComposeSelection,
    handleDuplicateComposeSelection,
    handleUndoCompose,
    sceneStore,
    selectedInstance,
  ])

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
        activeTransformTool={activeTransformTool}
        assets={sceneSnapshot.renderableAssets}
        isSidePanelCollapsed={isSidePanelCollapsed}
        rightPanelOcclusionWidth={rightPanelOcclusionWidth}
        selectedTargetId={selection.targetId}
        selectionRevision={selectionRevision}
        onAssetSelected={selectionStore.selectAsset}
        onSelectionCleared={selectionStore.clearSelection}
        onTransformChanged={handleTransformChanged}
        onTransformEnded={handleTransformEnded}
        onTransformStarted={handleTransformStarted}
      />
      <FrameChrome
        activeWorkspace={sceneSnapshot.activeWorkspace}
        apiKeyButtonDisabled={isLocalEnvApiKeyLoaded}
        canRedoCompose={canRedoCompose}
        canUndoCompose={canUndoCompose}
        canNavigateNextVersion={Boolean(adjacentVersions.next)}
        canNavigatePreviousVersion={Boolean(adjacentVersions.previous)}
        exportAsset={exportableCreateAsset}
        hasSessionApiKey={hasSessionApiKey}
        versionLabel={versionLabel}
        onApiKeyRequested={() => setIsApiKeyModalOpen(true)}
        onExportGlb={handleExportGlb}
        onRedoCompose={handleRedoCompose}
        onUndoCompose={handleUndoCompose}
        onNavigateNextVersion={() => handleNavigateVersion(adjacentVersions.next)}
        onNavigatePreviousVersion={() =>
          handleNavigateVersion(adjacentVersions.previous)
        }
        onWorkspaceChange={handleWorkspaceChange}
      />
      <main className="app-overlays" aria-label="Manifest3D creation workspace">
        {exportToastId !== null && (
          <div
            aria-live="polite"
            className="export-toast"
            key={exportToastId}
            role="status"
          >
            Exported
          </div>
        )}
        <AssetHistoryPanel
          activeAssetId={selectedAsset?.id ?? null}
          assets={librarySnapshot.library.assets}
          isCollapsed={isHistoryPanelCollapsed}
          modeLabel={
            sceneSnapshot.activeWorkspace === 'compose' ? 'Add' : 'View'
          }
          onAssetDeleteRequested={setAssetPendingDelete}
          onAssetOpen={handleHistoryAssetOpen}
          onCollapsedChange={setIsHistoryPanelCollapsed}
        />
        {sceneSnapshot.activeWorkspace === 'compose' && (
          <ComposeToolbar
            activeTool={activeTransformTool}
            disabled={!composeSelectionActive}
            rightOffset={composeToolbarRightOffset}
            onDelete={handleDeleteComposeSelection}
            onDuplicate={handleDuplicateComposeSelection}
            onToolChange={setActiveTransformTool}
          />
        )}
        <ChatPanel
          agentStatus={agentStatus}
          isCollapsed={isSidePanelCollapsed}
          isRunning={isAgentRunning}
          isWorkspaceDisabled={sceneSnapshot.activeWorkspace === 'compose'}
          mode={promptMode}
          onNewAsset={handleNewCreateAsset}
          onCollapsedChange={setIsSidePanelCollapsed}
          onPromptSubmit={handlePromptSubmit}
          onStop={handleStopAgentRun}
          panelRef={sidePanelRef}
          timelineItems={timelineItems}
          transcriptItems={chatTranscriptItems}
          validationReports={validationReports}
        />
      </main>
      <ConfirmDeleteModal
        asset={assetPendingDelete}
        onCancel={() => setAssetPendingDelete(null)}
        onConfirm={handleConfirmDeleteAsset}
      />
      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onCancel={() => setIsApiKeyModalOpen(false)}
        onSubmit={handleApiKeySubmit}
      />
    </div>
  )
}

function upsertAgentEvent(
  events: readonly AgentLoopEvent[],
  event: AgentLoopEvent,
) {
  const existingEventIndex = events.findIndex(
    (currentEvent) => currentEvent.id === event.id,
  )

  if (existingEventIndex < 0) {
    return [...events, event]
  }

  const nextEvents = [...events]

  nextEvents[existingEventIndex] = event

  return nextEvents
}

function updateAgentTranscriptItem(
  items: readonly ChatPanelTranscriptItem[],
  messageId: string,
  update: Partial<Extract<ChatPanelTranscriptItem, { role: 'agent' }>>,
): ChatPanelTranscriptItem[] {
  return items.map((item) =>
    item.role === 'agent' && item.id === messageId
      ? {
          ...item,
          ...update,
        }
      : item,
  )
}

function cloneSceneAssetInstances(
  instances: readonly SceneAssetInstance[],
): SceneAssetInstance[] {
  return instances.map((instance) => ({
    ...instance,
    transform: cloneSceneTransform(instance.transform),
  }))
}

function cloneSceneTransform(transform: SceneTransform): SceneTransform {
  return {
    position: [
      transform.position[0],
      transform.position[1],
      transform.position[2],
    ],
    rotation: [
      transform.rotation[0],
      transform.rotation[1],
      transform.rotation[2],
    ],
    scale: [transform.scale[0], transform.scale[1], transform.scale[2]],
  }
}

function hasTransformChanged(
  instanceId: string,
  nextTransform: SceneTransform,
  instances: readonly SceneAssetInstance[],
) {
  const previousTransform = instances.find(
    (instance) => instance.instanceId === instanceId,
  )?.transform

  if (!previousTransform) {
    return true
  }

  return (
    !vectorsAlmostEqual(previousTransform.position, nextTransform.position) ||
    !vectorsAlmostEqual(previousTransform.rotation, nextTransform.rotation) ||
    !vectorsAlmostEqual(previousTransform.scale, nextTransform.scale)
  )
}

function vectorsAlmostEqual(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
) {
  return left.every((value, index) => Math.abs(value - right[index]) < 0.000001)
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

function formatAttemptContext(version: AssetLibraryVersion) {
  const latestAttempt = version.attempts.at(-1)
  const failureAttempts = version.attempts.filter(
    (attempt) => attempt.status === 'failure',
  )

  return [
    `versionId=${version.versionId}`,
    `assetId=${version.assetId}`,
    `attempts=${version.attempts.length}`,
    `failedAttempts=${failureAttempts.length}`,
    latestAttempt
      ? `latestAttemptStatus=${latestAttempt.status} latestReport=${latestAttempt.report.bundle.summary}`
      : 'latestAttemptStatus=none',
    ...version.attempts
      .slice(-4)
      .map((attempt) => formatAttemptSummary(attempt)),
  ].join('\n')
}

function formatAttemptSummary(attempt: PersistedCandidateAttempt) {
  return [
    `- revision=${attempt.revision}`,
    `status=${attempt.status}`,
    `failureStreak=${attempt.failureStreak}`,
    `report=${attempt.report.bundle.summary}`,
  ].join(' ')
}

function createVersionTimeline(version: AssetLibraryVersion) {
  const latestAttempt = version.attempts.at(-1) ?? null
  const latestSuccessfulAttempt =
    [...version.attempts].reverse().find((attempt) => attempt.status === 'success') ??
    null
  const latestFailureAttempt =
    [...version.attempts].reverse().find((attempt) => attempt.status === 'failure') ??
    null

  return createCandidateHistoryTimeline({
    activeCandidateFingerprint: latestAttempt?.candidateFingerprint ?? null,
    attempts: version.attempts,
    canReportReady: latestAttempt?.status === 'success',
    consecutiveFailureCount: latestFailureAttempt?.failureStreak ?? 0,
    currentRevision: latestAttempt?.revision ?? 0,
    latestFailureSignature: latestFailureAttempt?.failureSignature ?? null,
    latestSuccessfulAttempt,
    runId: version.sourceRunId,
  })
}
