import {
  type Dispatch,
  type SetStateAction,
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
import { JointPreviewPanel } from '../ui/JointPreviewPanel'
import { ViewportDenoiseControl } from '../ui/ViewportDenoiseControl'
import { ViewportRenderModeControl } from '../ui/ViewportRenderModeControl'
import { ViewportWorldModeControl } from '../ui/ViewportWorldModeControl'
import { WebGPUCanvas, type TransformTool } from '../renderer/WebGPUCanvas'
import {
  readPathTracingDenoisePreference,
  writePathTracingDenoisePreference,
} from '../renderer/pathtracer/pathTracingDenoisePreference'
import {
  getLeftSidePanelOcclusionWidth,
  getRightSidePanelOcclusionWidth,
} from '../renderer/effectiveViewport'
import {
  allowsAnimationPreviewPlayback,
  type ViewportRenderMode,
} from '../renderer/viewportRenderMode'
import type { ViewportWorldMode } from '../renderer/viewportWorld'
import { validateManifestAssetCandidate } from '../engine/validation/validateManifest'
import {
  runManifestAgentLoop,
  type AgentLoopEvent,
} from '../engine/agent/agentLoop'
import { createCandidateHistory } from '../engine/agent/candidateHistory'
import {
  canUseInAppProviderApiKeyInput,
  createEmptyProviderApiKeys,
  getProviderApiKey,
  isProviderApiKeyLoaded,
  loadStartupProviderApiKeyStatus,
  resolveStartupProviderApiKeyStatus,
} from '../engine/agent/providerApiKey'
import { createManifestProviderClient } from '../engine/agent/manifestProviderClient'
import {
  getProviderLabel,
  readPreferredModelProvider,
  writePreferredModelProvider,
} from '../engine/agent/providerPreference'
import type { AgentImageAttachment } from '../engine/agent/providerClient'
import {
  findAssetLibraryVersion,
  getAdjacentAssetVersions,
  getLastSelectedAssetVersion,
} from '../engine/persistence/assetLibraryModel'
import type {
  AssetLibraryAsset,
  AssetLibraryVersion,
} from '../engine/persistence/assetLibraryTypes'
import type { ManifestAsset } from '../engine/schema/manifestTypes'
import {
  createSceneStore,
  type SceneAssetInstance,
  type SceneTransform,
  type WorkspaceMode,
} from '../engine/scene/sceneStore'
import {
  createAgentEventTimelineItem,
  createAgentProgressTimeline,
  type AgentProgressSnapshot,
  type AgentTimelineItem,
} from '../engine/agent/validationTimeline'
import {
  downloadGlbExport,
  exportManifestAssetGlb,
  type GlbExportMode,
} from '../engine/scene/exportGlb'
import {
  getDefaultJointControlValue,
  getJointControlPreviewValue,
  getJointPreviewControls,
  normalizeJointControlValue,
  resolveJointControlPoseValues,
  type JointPreviewControl,
  type JointPoseValues,
} from '../engine/geometry/jointPoses'
import {
  getDefaultMaterialEmissionControlValue,
  getMaterialEmissionAnimationControls,
  getMaterialEmissionControlPreviewValue,
  normalizeMaterialEmissionControlValue,
  type MaterialEmissionPreviewControl,
  type MaterialAnimationValues,
} from '../engine/geometry/materialAnimations'
import { modelConfig } from '../engine/config/modelConfig'
import type { ModelProvider } from '../engine/config/modelConfig'
import {
  resolveAssetPanelActiveState,
  resolveCreatePromptMode,
  resolveViewedAssetInstance,
  type AgentRunMode,
} from './assetViewState'
import {
  getPlayingAnimationPreviewKey,
  stopPlayingAnimationPreview,
  stopPlayingAnimationPreviewsForInstance,
  togglePlayingAnimationPreview,
  type PlayingAnimationPreview,
} from './animationPreviewState'
import {
  createPromptUserInputHistory,
  createVersionTimeline,
  createVersionTranscript,
  formatAttemptContext,
  persistSubmittedUserInput,
} from './agentConversation'

type ComposeHistoryEntry = {
  instances: readonly SceneAssetInstance[]
  selectedTargetId: string | null
}

type JointPreviewByInstance = Record<string, JointPoseValues>

type MaterialAnimationByInstance = Record<string, MaterialAnimationValues>

type AgentRunView = {
  agentEvents: readonly AgentLoopEvent[]
  assistantMessageId: string
  progressTimelineItems: readonly AgentTimelineItem[]
  chatTranscriptItems: readonly ChatPanelTranscriptItem[]
  createdAt: number
  isRunning: boolean
  mode: AgentRunMode
  prompt: string
  runId: string
  sourceAsset: ManifestAsset | null
  sourceVersionId: string | null
  status: string | null
  targetAssetId: string | null
}

const composeHistoryLimit = 40

export function AppShell() {
  const [selectedProvider, setSelectedProvider] = useState<ModelProvider>(
    () => readPreferredModelProvider(),
  )
  const [startupProviderApiKeyStatus, setStartupProviderApiKeyStatus] =
    useState(() => resolveStartupProviderApiKeyStatus())
  const [sessionApiKeys, setSessionApiKeys] = useState(() =>
    createEmptyProviderApiKeys(),
  )
  const [isSidePanelCollapsed, setIsSidePanelCollapsed] = useState(false)
  const [isHistoryPanelCollapsed, setIsHistoryPanelCollapsed] = useState(true)
  const [apiKeyNoticeId, setApiKeyNoticeId] = useState<number | null>(null)
  const [rightPanelOcclusionWidth, setRightPanelOcclusionWidth] = useState(0)
  const [leftPanelOcclusionWidth, setLeftPanelOcclusionWidth] = useState(0)
  const [viewportWorldMode, setViewportWorldMode] =
    useState<ViewportWorldMode>('light')
  const [viewportRenderMode, setViewportRenderMode] =
    useState<ViewportRenderMode>('default')
  const [isPathTracingDenoiseEnabled, setIsPathTracingDenoiseEnabled] =
    useState(() => readPathTracingDenoisePreference())
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false)
  const [agentEvents, setAgentEvents] = useState<AgentLoopEvent[]>([])
  const [agentStatus, setAgentStatus] = useState<string | null>(null)
  const [progressTimelineItems, setProgressTimelineItems] = useState<
    AgentTimelineItem[]
  >([])
  const [chatTranscriptItems, setChatTranscriptItems] = useState<
    ChatPanelTranscriptItem[]
  >([])
  const [agentRuns, setAgentRuns] = useState<AgentRunView[]>([])
  const [activeAgentRunId, setActiveAgentRunId] = useState<string | null>(null)
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
  const [jointPreviewByInstance, setJointPreviewByInstance] =
    useState<JointPreviewByInstance>({})
  const [materialAnimationByInstance, setMaterialAnimationByInstance] =
    useState<MaterialAnimationByInstance>({})
  const [playingAnimationPreviews, setPlayingAnimationPreviews] = useState<
    PlayingAnimationPreview[]
  >([])
  const sidePanelRef = useRef<HTMLElement | null>(null)
  const assetHistoryPanelRef = useRef<HTMLElement | null>(null)
  const pendingTransformHistoryRef = useRef<ComposeHistoryEntry | null>(null)
  const exportToastTimeoutRef = useRef<number | null>(null)
  const activeAgentRunIdRef = useRef<string | null>(null)
  const agentRunsRef = useRef<AgentRunView[]>([])
  const agentRunAbortControllersRef = useRef<Map<string, AbortController>>(
    new Map(),
  )
  const apiKeyNoticeTimeoutRef = useRef<number | null>(null)
  const jointAnimationDirectionByKeyRef = useRef<Record<string, number>>({})
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
  const viewedAssetInstance = resolveViewedAssetInstance({
    activeWorkspace: sceneSnapshot.activeWorkspace,
    createInstance: sceneSnapshot.createInstance,
    selectedInstance,
  })
  const viewedAsset = viewedAssetInstance?.asset
  const selectedJointPreviewPoses =
    selectedInstance ? jointPreviewByInstance[selectedInstance.instanceId] ?? {} : {}
  const selectedMaterialAnimationValues =
    selectedInstance
      ? materialAnimationByInstance[selectedInstance.instanceId] ?? {}
      : {}
  const selectedPlayingPreviews = selectedInstance
    ? playingAnimationPreviews
        .filter((preview) => preview.instanceId === selectedInstance.instanceId)
        .map((preview) => ({
          controlId: preview.controlId,
          kind: preview.kind,
        }))
    : []
  const animationPreviewPlaybackEnabled =
    allowsAnimationPreviewPlayback(viewportRenderMode)
  const exportableCreateAsset =
    sceneSnapshot.activeWorkspace === 'create' && sceneSnapshot.createInstance
      ? sceneSnapshot.createInstance.asset
      : undefined
  const selectedLibraryAsset = viewedAsset
    ? librarySnapshot.library.assets.find(
        (asset) => asset.assetId === viewedAsset.id,
      )
    : undefined
  const selectedVersionId = viewedAssetInstance?.versionId ?? null
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
    () =>
      progressTimelineItems.length > 0
        ? progressTimelineItems
        : agentEvents.map(createAgentEventTimelineItem),
    [agentEvents, progressTimelineItems],
  )
  const composeToolbarRightOffset = Math.max(28, rightPanelOcclusionWidth + 28)
  const composeSelectionActive =
    sceneSnapshot.activeWorkspace === 'compose' && Boolean(selectedInstance)
  const activeAgentRun = useMemo(
    () => agentRuns.find((run) => run.runId === activeAgentRunId) ?? null,
    [activeAgentRunId, agentRuns],
  )
  const assetPanelActiveState = resolveAssetPanelActiveState({
    activeAgentRun,
    activeWorkspace: sceneSnapshot.activeWorkspace,
    createInstance: sceneSnapshot.createInstance,
    selectedInstance,
  })
  const isActiveAgentRunRunning = activeAgentRun?.isRunning ?? false
  const pendingCreateRuns = useMemo(
    () =>
      agentRuns
        .filter((run) => run.mode === 'create' && run.isRunning)
        .sort((left, right) => right.createdAt - left.createdAt)
        .map((run) => ({
          prompt: run.prompt,
          runId: run.runId,
          status: run.status,
        })),
    [agentRuns],
  )
  const runningEditRuns = useMemo(
    () =>
      agentRuns
        .filter(
          (run) =>
            run.mode === 'edit' && run.isRunning && run.targetAssetId !== null,
        )
        .sort((left, right) => right.createdAt - left.createdAt)
        .map((run) => ({
          assetId: run.targetAssetId as string,
          runId: run.runId,
          status: run.status,
        })),
    [agentRuns],
  )
  const promptMode: ChatPanelPromptMode = resolveCreatePromptMode({
    activeAgentRun,
    activeWorkspace: sceneSnapshot.activeWorkspace,
    createInstance: sceneSnapshot.createInstance,
  })
  const canUndoCompose =
    sceneSnapshot.activeWorkspace === 'compose' && composeUndoStack.length > 0
  const canRedoCompose =
    sceneSnapshot.activeWorkspace === 'compose' && composeRedoStack.length > 0
  const canUseInAppApiKeyInput = canUseInAppProviderApiKeyInput(
    typeof window === 'undefined' ? '' : window.location.hostname,
  )
  const selectedProviderApiKey = getProviderApiKey(
    selectedProvider,
    startupProviderApiKeyStatus,
    sessionApiKeys,
  )
  const providerClient = useMemo(
    () =>
      createManifestProviderClient({
        apiKey: selectedProviderApiKey,
        provider: selectedProvider,
      }),
    [selectedProvider, selectedProviderApiKey],
  )
  const hasSessionApiKey = Boolean(sessionApiKeys[selectedProvider])
  const isApiKeyLoaded = isProviderApiKeyLoaded(
    selectedProvider,
    startupProviderApiKeyStatus,
    sessionApiKeys,
  )


  const handleViewportRenderModeChange = useCallback((mode: ViewportRenderMode) => {
    if (!allowsAnimationPreviewPlayback(mode)) {
      jointAnimationDirectionByKeyRef.current = {}
      setPlayingAnimationPreviews([])
    }

    setViewportRenderMode(mode)
  }, [])

  const handlePathTracingDenoiseEnabledChange = useCallback((isEnabled: boolean) => {
    setIsPathTracingDenoiseEnabled(isEnabled)
    writePathTracingDenoisePreference(isEnabled)
  }, [])

  useEffect(() => {
    void assetLibraryStore.load()
  }, [assetLibraryStore])

  useEffect(() => {
    let isMounted = true

    void loadStartupProviderApiKeyStatus().then((status) => {
      if (!isMounted) {
        return
      }

      setStartupProviderApiKeyStatus(status)
    })

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(
    () => () => {
      if (exportToastTimeoutRef.current !== null) {
        window.clearTimeout(exportToastTimeoutRef.current)
      }

      if (apiKeyNoticeTimeoutRef.current !== null) {
        window.clearTimeout(apiKeyNoticeTimeoutRef.current)
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

  const handleJointPoseChange = useCallback(
    (instanceId: string, controlId: string, value: number) => {
      const instance = sceneStore.getInstance(instanceId)
      const control = instance
        ? getJointPreviewControls(instance.asset).find(
            (candidate) => candidate.id === controlId,
          )
        : null

      if (!control) {
        return
      }

      const poseValues = resolveJointControlPoseValues(control, value)

      setJointPreviewByInstance((currentPreview) => ({
        ...currentPreview,
        [instanceId]: {
          ...(currentPreview[instanceId] ?? {}),
          ...poseValues,
        },
      }))
    },
    [sceneStore],
  )

  const handleJointReset = useCallback(
    (instanceId: string, controlId: string) => {
      const instance = sceneStore.getInstance(instanceId)
      const control = instance
        ? getJointPreviewControls(instance.asset).find(
            (candidate) => candidate.id === controlId,
          )
        : null

      if (!control) {
        return
      }

      const poseValues = resolveJointControlPoseValues(
        control,
        getDefaultJointControlValue(control),
      )

      setJointPreviewByInstance((currentPreview) => ({
        ...currentPreview,
        [instanceId]: {
          ...(currentPreview[instanceId] ?? {}),
          ...poseValues,
        },
      }))
      setPlayingAnimationPreviews((currentPlaying) =>
        stopPlayingAnimationPreview(currentPlaying, {
          controlId,
          instanceId,
          kind: 'joint',
        }),
      )
      delete jointAnimationDirectionByKeyRef.current[
        getPlayingAnimationPreviewKey({ controlId, instanceId, kind: 'joint' })
      ]
    },
    [sceneStore],
  )

  const handleMaterialAnimationTimeChange = useCallback(
    (instanceId: string, controlId: string, value: number) => {
      const instance = sceneStore.getInstance(instanceId)
      const control = instance
        ? getMaterialEmissionAnimationControls(instance.asset).find(
            (candidate) => candidate.id === controlId,
          )
        : null

      if (!control) {
        return
      }

      setMaterialAnimationByInstance((currentPreview) => ({
        ...currentPreview,
        [instanceId]: {
          ...(currentPreview[instanceId] ?? {}),
          [control.materialId]: normalizeMaterialEmissionControlValue(
            control,
            value,
          ),
        },
      }))
    },
    [sceneStore],
  )

  const handleMaterialAnimationReset = useCallback(
    (instanceId: string, controlId: string) => {
      const instance = sceneStore.getInstance(instanceId)
      const control = instance
        ? getMaterialEmissionAnimationControls(instance.asset).find(
            (candidate) => candidate.id === controlId,
          )
        : null

      if (!control) {
        return
      }

      setMaterialAnimationByInstance((currentPreview) => ({
        ...currentPreview,
        [instanceId]: {
          ...(currentPreview[instanceId] ?? {}),
          [control.materialId]: getDefaultMaterialEmissionControlValue(control),
        },
      }))
      setPlayingAnimationPreviews((currentPlaying) =>
        stopPlayingAnimationPreview(currentPlaying, {
          controlId,
          instanceId,
          kind: 'material',
        }),
      )
    },
    [sceneStore],
  )

  const handleJointResetAll = useCallback((instanceId: string) => {
    setJointPreviewByInstance((currentPreview) => {
      const remainingPreview = { ...currentPreview }

      delete remainingPreview[instanceId]
      return remainingPreview
    })
    setMaterialAnimationByInstance((currentPreview) => {
      const remainingPreview = { ...currentPreview }

      delete remainingPreview[instanceId]
      return remainingPreview
    })
    setPlayingAnimationPreviews((currentPlaying) =>
      stopPlayingAnimationPreviewsForInstance(currentPlaying, instanceId),
    )
    Object.keys(jointAnimationDirectionByKeyRef.current).forEach((key) => {
      if (key.startsWith(`${instanceId}:`)) {
        delete jointAnimationDirectionByKeyRef.current[key]
      }
    })
  }, [])

  const handleJointTogglePlayback = useCallback(
    (instanceId: string, controlId: string) => {
      const preview: PlayingAnimationPreview = {
        controlId,
        instanceId,
        kind: 'joint',
      }

      setPlayingAnimationPreviews((currentPlaying) => {
        const nextPlaying = togglePlayingAnimationPreview(currentPlaying, preview)

        if (nextPlaying.length < currentPlaying.length) {
          delete jointAnimationDirectionByKeyRef.current[
            getPlayingAnimationPreviewKey(preview)
          ]
        }

        return nextPlaying
      })
    },
    [],
  )

  const handleMaterialAnimationTogglePlayback = useCallback(
    (instanceId: string, controlId: string) => {
      setPlayingAnimationPreviews((currentPlaying) =>
        togglePlayingAnimationPreview(currentPlaying, {
          controlId,
          instanceId,
          kind: 'material',
        }),
      )
    },
    [],
  )

  const showAgentRunView = useCallback((run: AgentRunView) => {
    setAgentEvents([...run.agentEvents])
    setAgentStatus(run.status)
    setProgressTimelineItems([...run.progressTimelineItems])
    setChatTranscriptItems([...run.chatTranscriptItems])
  }, [])

  const setAgentRunViews = useCallback((nextRuns: AgentRunView[]) => {
    agentRunsRef.current = nextRuns
    setAgentRuns(nextRuns)
  }, [])

  const clearActiveAgentRun = useCallback(() => {
    activeAgentRunIdRef.current = null
    setActiveAgentRunId(null)
  }, [])

  const showMissingApiKeyNotice = useCallback(() => {
    if (apiKeyNoticeTimeoutRef.current !== null) {
      window.clearTimeout(apiKeyNoticeTimeoutRef.current)
    }

    setApiKeyNoticeId(Date.now())
    apiKeyNoticeTimeoutRef.current = window.setTimeout(() => {
      setApiKeyNoticeId(null)
      apiKeyNoticeTimeoutRef.current = null
    }, 3000)
  }, [])

  const activateAgentRunView = useCallback(
    (run: AgentRunView) => {
      activeAgentRunIdRef.current = run.runId
      setActiveAgentRunId(run.runId)
      showAgentRunView(run)
    },
    [showAgentRunView],
  )

  const addAgentRunView = useCallback(
    (run: AgentRunView) => {
      setAgentRunViews([run, ...agentRunsRef.current])
    },
    [setAgentRunViews],
  )

  const updateAgentRunView = useCallback(
    (runId: string, update: (run: AgentRunView) => AgentRunView) => {
      let nextRun: AgentRunView | null = null
      const nextRuns = agentRunsRef.current.map((run) => {
        if (run.runId !== runId) {
          return run
        }

        nextRun = update(run)
        return nextRun
      })

      setAgentRunViews(nextRuns)

      if (nextRun && activeAgentRunIdRef.current === runId) {
        showAgentRunView(nextRun)
      }
    },
    [setAgentRunViews, showAgentRunView],
  )

  const removeAgentRunView = useCallback(
    (runId: string) => {
      setAgentRunViews(
        agentRunsRef.current.filter((run) => run.runId !== runId),
      )

      if (activeAgentRunIdRef.current === runId) {
        clearActiveAgentRun()
      }
    },
    [clearActiveAgentRun, setAgentRunViews],
  )

  const handleAgentRunOpen = useCallback(
    (runId: string) => {
      const run = agentRunsRef.current.find(
        (candidateRun) => candidateRun.runId === runId,
      )

      if (!run) {
        return
      }

      sceneStore.setWorkspace('create')
      setActiveTransformTool(null)

      if (run.mode === 'edit' && run.sourceAsset) {
        sceneStore.setCreateAsset(run.sourceAsset, run.sourceVersionId)
        selectionStore.selectAsset('create', run.sourceAsset.id)
      } else {
        sceneStore.clearCreateAsset()
        selectionStore.clearSelection()
      }

      activateAgentRunView(run)
    },
    [activateAgentRunView, sceneStore, selectionStore],
  )

  const handlePromptSubmit = useCallback(
    (
      userPrompt: string,
      imageAttachments: readonly AgentImageAttachment[],
    ) => {
      if (isActiveAgentRunRunning || sceneSnapshot.activeWorkspace !== 'create') {
        return
      }

      if (!isApiKeyLoaded) {
        showMissingApiKeyNotice()
        return
      }

      const runId = `agent:${Date.now().toString(36)}`
      const runSelectedInstance =
        sceneSnapshot.activeWorkspace === 'create'
          ? sceneStore.getSnapshot().createInstance
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
      const runSelectedLibraryAsset = runSelectedInstance?.assetId
        ? librarySnapshot.library.assets.find(
            (asset) => asset.assetId === runSelectedInstance.assetId,
          ) ?? null
        : null
      const mode: AgentRunMode = runSelectedAsset ? 'edit' : 'create'
      const runStatus = runSelectedAsset
        ? `Editing ${runSelectedAsset.name}`
        : 'Creating asset'
      const assistantMessageId = `${runId}:assistant`
      const abortController = new AbortController()
      let didTimeOut = false
      const submittedUserInput = {
        imageAttachments,
        text: userPrompt,
      }
      const userInputHistory = createPromptUserInputHistory({
        asset: runSelectedLibraryAsset,
        currentUserInput: submittedUserInput,
        selectedVersionId: runSelectedInstance?.versionId ?? null,
      })
      const previousTranscript =
        runSelectedLibraryAsset && runSelectedVersion
          ? createVersionTranscript(runSelectedLibraryAsset, runSelectedVersion)
          : []
      const runItems: ChatPanelTranscriptItem[] = [
        ...previousTranscript,
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
      const runView: AgentRunView = {
        agentEvents: [],
        assistantMessageId,
        progressTimelineItems: [],
        chatTranscriptItems: runItems,
        createdAt: Date.now(),
        isRunning: true,
        mode,
        prompt: userPrompt,
        runId,
        sourceAsset: runSelectedAsset,
        sourceVersionId: runSelectedInstance?.versionId ?? null,
        status: runStatus,
        targetAssetId: runSelectedAsset?.id ?? null,
      }

      if (mode === 'create') {
        sceneStore.clearCreateAsset()
        selectionStore.clearSelection()
        handleJointResetAll('create')
      }

      const runScene = sceneStore.getSnapshot().scene
      const runSceneStore = createSceneStore(runScene)

      addAgentRunView(runView)
      activateAgentRunView(runView)
      agentRunAbortControllersRef.current.set(runId, abortController)

      const runTimeout = window.setTimeout(() => {
        didTimeOut = true
        abortController.abort()
        const timeoutStatus = formatAgentRunTimeoutStatus(
          modelConfig.agentRunTimeoutMs,
        )

        updateAgentRunView(runId, (currentRun) => ({
          ...currentRun,
          chatTranscriptItems: updateAgentTranscriptItem(
            currentRun.chatTranscriptItems,
            assistantMessageId,
            { status: timeoutStatus },
          ),
          status: timeoutStatus,
        }))
      }, modelConfig.agentRunTimeoutMs)

      let runEvents: AgentLoopEvent[] = []
      const runHistory = createCandidateHistory()

      function applyAgentProgress(progress: AgentProgressSnapshot) {
        runEvents = [...progress.agentEvents]

        updateAgentRunView(runId, (currentRun) => ({
          ...currentRun,
          agentEvents: runEvents,
          chatTranscriptItems: updateAgentTranscriptItem(
            currentRun.chatTranscriptItems,
            assistantMessageId,
            { timelineItems: progress.timelineItems },
          ),
          progressTimelineItems: progress.timelineItems,
        }))
      }

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
          userInputHistory,
          userPrompt,
        },
        {
          client: providerClient,
          history: runHistory,
          onProgress: applyAgentProgress,
          sceneStore: runSceneStore,
        },
      )
        .then(async (result) => {
          const resultTimelineItems = createAgentProgressTimeline(
            runEvents,
            result.history,
          )

          updateAgentRunView(runId, (currentRun) => ({
            ...currentRun,
            progressTimelineItems: resultTimelineItems,
          }))

          if (result.status !== 'ready') {
            const statusMessage = didTimeOut
              ? formatAgentRunTimeoutStatus(modelConfig.agentRunTimeoutMs)
              : result.message

            updateAgentRunView(runId, (currentRun) => ({
              ...currentRun,
              chatTranscriptItems: updateAgentTranscriptItem(
                currentRun.chatTranscriptItems,
                assistantMessageId,
                {
                  status: statusMessage,
                  timelineItems: resultTimelineItems,
                },
              ),
              isRunning: false,
              status: statusMessage,
            }))
            return
          }

          const savedVersion = await assetLibraryStore.saveValidatedVersion({
            agentEvents: runEvents,
            asset: result.asset,
            history: result.history,
            parentVersionId:
              mode === 'edit' ? runSelectedInstance?.versionId ?? null : null,
            userInput: persistSubmittedUserInput(submittedUserInput),
            validationReport: result.report,
          })
          const readyStatus = `Ready: ${result.asset.name} v${savedVersion.versionNumber}`
          const finalRun = agentRunsRef.current.find((run) => run.runId === runId)
          const wasActive = activeAgentRunIdRef.current === runId

          updateAgentRunView(runId, (currentRun) => ({
            ...currentRun,
            chatTranscriptItems: updateAgentTranscriptItem(
              currentRun.chatTranscriptItems,
              assistantMessageId,
              {
                status: readyStatus,
                timelineItems: resultTimelineItems,
              },
            ),
            isRunning: false,
            status: readyStatus,
          }))

          if (wasActive && finalRun) {
            sceneStore.setCreateAsset(result.asset, savedVersion.versionId)
            selectionStore.selectAsset('create', result.asset.id)
            setAgentStatus(readyStatus)
            setProgressTimelineItems(resultTimelineItems)
            setChatTranscriptItems((currentItems) =>
              updateAgentTranscriptItem(currentItems, assistantMessageId, {
                status: readyStatus,
                timelineItems: resultTimelineItems,
              }),
            )
          }
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error
              ? error.message
              : 'The agent run failed unexpectedly.'

          const failedTimelineItems = createAgentProgressTimeline(
            runEvents,
            runHistory.getSnapshot(),
          )

          updateAgentRunView(runId, (currentRun) => ({
            ...currentRun,
            chatTranscriptItems: updateAgentTranscriptItem(
              currentRun.chatTranscriptItems,
              assistantMessageId,
              {
                status: message,
                timelineItems: failedTimelineItems,
              },
            ),
            isRunning: false,
            progressTimelineItems: failedTimelineItems,
            status: message,
          }))
        })
        .finally(() => {
          window.clearTimeout(runTimeout)
          agentRunAbortControllersRef.current.delete(runId)
          removeAgentRunView(runId)
        })
    },
    [
      activateAgentRunView,
      addAgentRunView,
      assetLibraryStore,
      handleJointResetAll,
      isActiveAgentRunRunning,
      isApiKeyLoaded,
      librarySnapshot.library,
      providerClient,
      removeAgentRunView,
      sceneSnapshot.activeWorkspace,
      sceneStore,
      selectionStore,
      showMissingApiKeyNotice,
      updateAgentRunView,
    ],
  )

  const handleStopAgentRun = useCallback(() => {
    const activeRunId = activeAgentRunIdRef.current

    if (!activeRunId) {
      return
    }

    const abortController = agentRunAbortControllersRef.current.get(activeRunId)

    if (!abortController) {
      return
    }

    abortController.abort()
    updateAgentRunView(activeRunId, (currentRun) => ({
      ...currentRun,
      chatTranscriptItems: updateAgentTranscriptItem(
        currentRun.chatTranscriptItems,
        currentRun.assistantMessageId,
        { status: 'Stopping agent run...' },
      ),
      status: 'Stopping agent run...',
    }))
  }, [updateAgentRunView])

  const handleNewCreateAsset = useCallback(() => {
    clearActiveAgentRun()
    setAgentEvents([])
    setProgressTimelineItems([])
    setChatTranscriptItems([])
    setAgentStatus(null)
    sceneStore.clearCreateAsset()
    selectionStore.clearSelection()
    setActiveTransformTool(null)
    handleJointResetAll('create')
  }, [clearActiveAgentRun, handleJointResetAll, sceneStore, selectionStore])

  const handleExportGlb = useCallback((mode: GlbExportMode) => {
    if (!exportableCreateAsset) {
      return
    }

    void exportManifestAssetGlb(exportableCreateAsset, { mode })
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

  const handleProviderChange = useCallback((provider: ModelProvider) => {
    setSelectedProvider(provider)
    writePreferredModelProvider(provider)
  }, [])

  const handleApiKeySubmit = useCallback((provider: ModelProvider, apiKey: string) => {
    setSelectedProvider(provider)
    writePreferredModelProvider(provider)
    setSessionApiKeys((currentApiKeys) => ({
      ...currentApiKeys,
      [provider]: apiKey,
    }))
    setIsApiKeyModalOpen(false)
    setAgentStatus(`${getProviderLabel(provider)} API key loaded for this session.`)
  }, [])

  const handleWorkspaceChange = useCallback(
    (workspace: WorkspaceMode) => {
      clearActiveAgentRun()
      sceneStore.setWorkspace(workspace)
      selectionStore.clearSelection()
      setActiveTransformTool(null)
    },
    [clearActiveAgentRun, sceneStore, selectionStore],
  )

  const handleHistoryAssetOpen = useCallback(
    (asset: AssetLibraryAsset) => {
      clearActiveAgentRun()
      const version = getLastSelectedAssetVersion(asset)

      void assetLibraryStore.setLastSelectedVersion(
        asset.assetId,
        version.versionId,
      )
      setAgentEvents([])
      const transcript = createVersionTranscript(asset, version)

      setChatTranscriptItems(transcript)
      setProgressTimelineItems(
        transcript.length > 0 ? [] : createVersionTimeline(version),
      )
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
      clearActiveAgentRun,
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
      if (!version) {
        return
      }

      const currentSceneSnapshot = sceneStore.getSnapshot()
      const currentSelection = selectionStore.getSnapshot().selection
      const currentSelectedInstance = currentSelection.targetId
        ? currentSceneSnapshot.renderableAssets.find(
            (instance) => instance.instanceId === currentSelection.targetId,
          )
        : undefined
      const currentViewedInstance = resolveViewedAssetInstance({
        activeWorkspace: currentSceneSnapshot.activeWorkspace,
        createInstance: currentSceneSnapshot.createInstance,
        selectedInstance: currentSelectedInstance,
      })

      if (!currentViewedInstance) {
        return
      }

      clearActiveAgentRun()
      void assetLibraryStore.setLastSelectedVersion(
        version.assetId,
        version.versionId,
      )
      setAgentEvents([])
      const libraryAsset =
        librarySnapshot.library.assets.find(
          (asset) => asset.assetId === version.assetId,
        ) ?? null
      const transcript = libraryAsset
        ? createVersionTranscript(libraryAsset, version)
        : []

      setChatTranscriptItems(transcript)
      setProgressTimelineItems(
        transcript.length > 0 ? [] : createVersionTimeline(version),
      )
      setAgentStatus(`Loaded ${version.asset.name} v${version.versionNumber}`)

      if (currentSceneSnapshot.activeWorkspace === 'create') {
        sceneStore.setCreateAsset(version.asset, version.versionId)
        selectionStore.selectAsset('create', version.assetId)
        return
      }

      clearComposeHistory()
      sceneStore.setComposeInstanceVersion(
        currentViewedInstance.instanceId,
        version.asset,
        version.versionId,
      )
      selectionStore.selectAsset(currentViewedInstance.instanceId, version.assetId)
    },
    [
      assetLibraryStore,
      clearComposeHistory,
      clearActiveAgentRun,
      librarySnapshot.library.assets,
      sceneStore,
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

  useEffect(() => {
    if (playingAnimationPreviews.length === 0) {
      return undefined
    }

    const activeJointPreviews: Array<{
      control: JointPreviewControl
      instance: SceneAssetInstance
      preview: PlayingAnimationPreview
    }> = []
    const activeMaterialPreviews: Array<{
      control: MaterialEmissionPreviewControl
      instance: SceneAssetInstance
    }> = []

    for (const preview of playingAnimationPreviews) {
      const instance = sceneStore.getInstance(preview.instanceId)

      if (!instance) {
        continue
      }

      if (preview.kind === 'joint') {
        const control = getJointPreviewControls(instance.asset).find(
          (candidate) => candidate.id === preview.controlId,
        )

        if (control) {
          activeJointPreviews.push({ control, instance, preview })
        }
      } else {
        const control = getMaterialEmissionAnimationControls(instance.asset).find(
          (candidate) => candidate.id === preview.controlId,
        )

        if (control) {
          activeMaterialPreviews.push({ control, instance })
        }
      }
    }

    if (activeJointPreviews.length === 0 && activeMaterialPreviews.length === 0) {
      return undefined
    }

    for (const { preview } of activeJointPreviews) {
      const key = getPlayingAnimationPreviewKey(preview)

      jointAnimationDirectionByKeyRef.current[key] ??= 1
    }

    let animationFrame = 0
    let previousTime = performance.now()

    function animatePreview(time: number) {
      const deltaSeconds = Math.min(0.05, Math.max(0, (time - previousTime) / 1000))

      previousTime = time

      if (activeJointPreviews.length > 0) {
        setJointPreviewByInstance((currentPreview) => {
          let nextPreview = currentPreview

          for (const { control, instance, preview } of activeJointPreviews) {
            const range = control.range
            const key = getPlayingAnimationPreviewKey(preview)
            const currentValue = getJointControlPreviewValue(
              control,
              nextPreview[instance.instanceId] ?? {},
            )
            const speed = getJointAnimationSpeed(range.unit, range.max - range.min)
            const currentDirection =
              jointAnimationDirectionByKeyRef.current[key] ?? 1
            let nextDirection = currentDirection
            let nextValue = currentValue + speed * deltaSeconds * currentDirection

            if (control.wrap) {
              nextValue = normalizeJointControlValue(control, nextValue)
            } else if (nextValue >= range.max) {
              nextValue = range.max
              nextDirection = -1
            } else if (nextValue <= range.min) {
              nextValue = range.min
              nextDirection = 1
            }

            jointAnimationDirectionByKeyRef.current[key] = nextDirection

            const poseValues = resolveJointControlPoseValues(control, nextValue)

            nextPreview = {
              ...nextPreview,
              [instance.instanceId]: {
                ...(nextPreview[instance.instanceId] ?? {}),
                ...poseValues,
              },
            }
          }

          return nextPreview
        })
      }

      if (activeMaterialPreviews.length > 0) {
        setMaterialAnimationByInstance((currentPreview) => {
          let nextPreview = currentPreview

          for (const { control, instance } of activeMaterialPreviews) {
            const currentValue = getMaterialEmissionControlPreviewValue(
              control,
              nextPreview[instance.instanceId] ?? {},
            )
            const rawNextValue = currentValue + deltaSeconds
            const nextValue = control.wrap
              ? normalizeMaterialEmissionControlValue(control, rawNextValue)
              : Math.min(control.range.max, rawNextValue)

            nextPreview = {
              ...nextPreview,
              [instance.instanceId]: {
                ...(nextPreview[instance.instanceId] ?? {}),
                [control.materialId]: nextValue,
              },
            }
          }

          return nextPreview
        })
      }

      animationFrame = requestAnimationFrame(animatePreview)
    }

    animationFrame = requestAnimationFrame(animatePreview)

    return () => {
      cancelAnimationFrame(animationFrame)
    }
  }, [playingAnimationPreviews, sceneStore])

  useLayoutEffect(() => {
    const sidePanel = sidePanelRef.current

    if (!sidePanel) {
      return undefined
    }

    return observePanelOcclusionWidth(
      sidePanel,
      getRightSidePanelOcclusionWidth,
      setRightPanelOcclusionWidth,
    )
  }, [isSidePanelCollapsed])

  useLayoutEffect(() => {
    const assetHistoryPanel = assetHistoryPanelRef.current

    if (!assetHistoryPanel) {
      return undefined
    }

    return observePanelOcclusionWidth(
      assetHistoryPanel,
      getLeftSidePanelOcclusionWidth,
      setLeftPanelOcclusionWidth,
    )
  }, [isHistoryPanelCollapsed])

  return (
    <div className="app-shell">
      <WebGPUCanvas
        activeTransformTool={activeTransformTool}
        assets={sceneSnapshot.renderableAssets}
        isSidePanelCollapsed={isSidePanelCollapsed}
        jointPreviewPosesByInstance={jointPreviewByInstance}
        materialAnimationValuesByInstance={materialAnimationByInstance}
        leftPanelOcclusionWidth={leftPanelOcclusionWidth}
        pathTracingDenoiseEnabled={isPathTracingDenoiseEnabled}
        renderMode={viewportRenderMode}
        rightPanelOcclusionWidth={rightPanelOcclusionWidth}
        selectedTargetId={selection.targetId}
        selectionRevision={selectionRevision}
        worldMode={viewportWorldMode}
        onAssetSelected={selectionStore.selectAsset}
        onSelectionCleared={selectionStore.clearSelection}
        onTransformChanged={handleTransformChanged}
        onTransformEnded={handleTransformEnded}
        onTransformStarted={handleTransformStarted}
      />
      <FrameChrome
        activeWorkspace={sceneSnapshot.activeWorkspace}
        apiKeyNoticeId={apiKeyNoticeId}
        isApiKeyLoaded={isApiKeyLoaded}
        canRedoCompose={canRedoCompose}
        canUndoCompose={canUndoCompose}
        canNavigateNextVersion={Boolean(adjacentVersions.next)}
        canNavigatePreviousVersion={Boolean(adjacentVersions.previous)}
        exportAsset={exportableCreateAsset}
        hasSessionApiKey={hasSessionApiKey}
        versionLabel={versionLabel}
        onApiKeyRequested={() => {
          setIsApiKeyModalOpen(true)
        }}
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
        <ViewportWorldModeControl
          isHistoryPanelCollapsed={isHistoryPanelCollapsed}
          mode={viewportWorldMode}
          onModeChange={setViewportWorldMode}
        />
        <ViewportRenderModeControl
          isHistoryPanelCollapsed={isHistoryPanelCollapsed}
          mode={viewportRenderMode}
          onModeChange={handleViewportRenderModeChange}
        />
        {viewportRenderMode === 'pathtracer' && (
          <ViewportDenoiseControl
            isEnabled={isPathTracingDenoiseEnabled}
            isHistoryPanelCollapsed={isHistoryPanelCollapsed}
            onEnabledChange={handlePathTracingDenoiseEnabledChange}
          />
        )}
        <AssetHistoryPanel
          activeAssetId={assetPanelActiveState.activeAssetId}
          activeRunId={assetPanelActiveState.activeRunId}
          assets={librarySnapshot.library.assets}
          isCollapsed={isHistoryPanelCollapsed}
          modeLabel={
            sceneSnapshot.activeWorkspace === 'compose' ? 'Add' : 'View'
          }
          onAssetDeleteRequested={setAssetPendingDelete}
          onAssetOpen={handleHistoryAssetOpen}
          onCollapsedChange={setIsHistoryPanelCollapsed}
          onAgentRunOpen={handleAgentRunOpen}
          panelRef={assetHistoryPanelRef}
          pendingCreateRuns={pendingCreateRuns}
          runningEditRuns={runningEditRuns}
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
        {animationPreviewPlaybackEnabled && (
          <JointPreviewPanel
            instance={selectedInstance ?? null}
            jointPoses={selectedJointPreviewPoses}
            materialAnimationValues={selectedMaterialAnimationValues}
            playingPreviews={selectedPlayingPreviews}
            rightOffset={composeToolbarRightOffset}
            onJointPoseChange={handleJointPoseChange}
            onJointReset={handleJointReset}
            onMaterialAnimationReset={handleMaterialAnimationReset}
            onMaterialAnimationTimeChange={handleMaterialAnimationTimeChange}
            onMaterialAnimationTogglePlayback={
              handleMaterialAnimationTogglePlayback
            }
            onResetAll={handleJointResetAll}
            onTogglePlayback={handleJointTogglePlayback}
          />
        )}
        <ChatPanel
          agentStatus={agentStatus}
          isCollapsed={isSidePanelCollapsed}
          isRunning={isActiveAgentRunRunning}
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
        provider={selectedProvider}
        isOpen={isApiKeyModalOpen}
        showApiKeyInput={canUseInAppApiKeyInput}
        onCancel={() => setIsApiKeyModalOpen(false)}
        onProviderChange={handleProviderChange}
        onSubmit={handleApiKeySubmit}
      />
    </div>
  )
}

type PanelOcclusionWidthResolver = (
  panelRect: DOMRect,
  viewportWidth: number,
) => number

function observePanelOcclusionWidth(
  panel: HTMLElement,
  resolveOcclusionWidth: PanelOcclusionWidthResolver,
  setOcclusionWidth: Dispatch<SetStateAction<number>>,
) {
  let animationFrame = 0

  function measurePanel() {
    const nextOcclusionWidth = Math.round(
      resolveOcclusionWidth(panel.getBoundingClientRect(), window.innerWidth),
    )

    setOcclusionWidth((currentOcclusionWidth) =>
      currentOcclusionWidth === nextOcclusionWidth
        ? currentOcclusionWidth
        : nextOcclusionWidth,
    )
  }

  function queueMeasure() {
    cancelAnimationFrame(animationFrame)
    animationFrame = requestAnimationFrame(measurePanel)
  }

  measurePanel()

  const resizeObserver = new ResizeObserver(queueMeasure)

  resizeObserver.observe(panel)
  window.addEventListener('resize', queueMeasure)
  panel.addEventListener('transitionend', queueMeasure)

  return () => {
    cancelAnimationFrame(animationFrame)
    resizeObserver.disconnect()
    window.removeEventListener('resize', queueMeasure)
    panel.removeEventListener('transitionend', queueMeasure)
  }
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

function getJointAnimationSpeed(unit: JointPreviewControl['range']['unit'], rangeSpan: number) {
  if (unit === 'meters') {
    return Math.max(0.08, Math.abs(rangeSpan) / 2)
  }

  return Math.PI / 2
}

function formatAgentRunTimeoutStatus(timeoutMs: number) {
  return `Agent run timed out after ${Math.round(timeoutMs / 60_000)} minutes.`
}
