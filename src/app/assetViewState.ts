import type { SceneAssetInstance, WorkspaceMode } from '../engine/scene/sceneStore'

export type AgentRunMode = 'create' | 'edit'

export type AgentRunSelectionState = {
  isRunning: boolean
  mode: AgentRunMode
  runId: string
}

export type AssetViewStateInput = {
  activeAgentRun: AgentRunSelectionState | null
  activeWorkspace: WorkspaceMode
  createInstance: SceneAssetInstance | null
  selectedInstance?: SceneAssetInstance
}

export type AssetPanelActiveState = {
  activeAssetId: string | null
  activeRunId: string | null
}

export type CreatePromptMode = AgentRunMode

export function resolveViewedAssetInstance({
  activeWorkspace,
  createInstance,
  selectedInstance,
}: Pick<
  AssetViewStateInput,
  'activeWorkspace' | 'createInstance' | 'selectedInstance'
>): SceneAssetInstance | undefined {
  if (activeWorkspace === 'create') {
    return createInstance ?? undefined
  }

  return selectedInstance
}

export function resolveAssetPanelActiveState(
  input: AssetViewStateInput,
): AssetPanelActiveState {
  const viewedInstance = resolveViewedAssetInstance(input)

  if (viewedInstance) {
    return {
      activeAssetId: viewedInstance.assetId,
      activeRunId: null,
    }
  }

  if (
    input.activeWorkspace === 'create' &&
    input.activeAgentRun?.isRunning &&
    input.activeAgentRun.mode === 'create'
  ) {
    return {
      activeAssetId: null,
      activeRunId: input.activeAgentRun.runId,
    }
  }

  return {
    activeAssetId: null,
    activeRunId: null,
  }
}

export function resolveCreatePromptMode({
  activeAgentRun,
  activeWorkspace,
  createInstance,
}: Pick<
  AssetViewStateInput,
  'activeAgentRun' | 'activeWorkspace' | 'createInstance'
>): CreatePromptMode {
  if (activeAgentRun) {
    return activeAgentRun.mode
  }

  if (activeWorkspace === 'create' && createInstance) {
    return 'edit'
  }

  return 'create'
}
