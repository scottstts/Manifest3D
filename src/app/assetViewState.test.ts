import { describe, expect, it } from 'vitest'
import { createValidValidationFixtureAsset } from '../engine/testing/validationFixtureAsset'
import type { SceneAssetInstance } from '../engine/scene/sceneStore'
import {
  resolveAssetPanelActiveState,
  resolveCreatePromptMode,
  resolveViewedAssetInstance,
} from './assetViewState'

function createInstance(instanceId: string): SceneAssetInstance {
  const asset = createValidValidationFixtureAsset()

  return {
    asset: {
      ...asset,
      id: `${instanceId}-asset`,
      name: `${instanceId} Asset`,
    },
    assetId: `${instanceId}-asset`,
    instanceId,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    versionId: `${instanceId}-version`,
  }
}

describe('asset view state', () => {
  it('keeps create asset panel state tied to the viewport asset when object selection is cleared', () => {
    const viewedCreateInstance = createInstance('create')

    expect(
      resolveViewedAssetInstance({
        activeWorkspace: 'create',
        createInstance: viewedCreateInstance,
        selectedInstance: undefined,
      }),
    ).toBe(viewedCreateInstance)
    expect(
      resolveAssetPanelActiveState({
        activeAgentRun: null,
        activeWorkspace: 'create',
        createInstance: viewedCreateInstance,
        selectedInstance: undefined,
      }),
    ).toEqual({ activeAssetId: viewedCreateInstance.assetId, activeRunId: null })
    expect(
      resolveCreatePromptMode({
        activeAgentRun: null,
        activeWorkspace: 'create',
        createInstance: viewedCreateInstance,
      }),
    ).toBe('editing')
  })

  it('marks the active pending create row while a create run is the current view', () => {
    expect(
      resolveAssetPanelActiveState({
        activeAgentRun: {
          isRunning: true,
          mode: 'create',
          runId: 'agent:create',
        },
        activeWorkspace: 'create',
        createInstance: null,
        selectedInstance: undefined,
      }),
    ).toEqual({ activeAssetId: null, activeRunId: 'agent:create' })
    expect(
      resolveCreatePromptMode({
        activeAgentRun: {
          isRunning: true,
          mode: 'create',
          runId: 'agent:create',
        },
        activeWorkspace: 'create',
        createInstance: null,
      }),
    ).toBe('creating')
  })

  it('keeps compose panel state tied to actual compose object selection', () => {
    const selectedInstance = createInstance('compose')

    expect(
      resolveAssetPanelActiveState({
        activeAgentRun: null,
        activeWorkspace: 'compose',
        createInstance: null,
        selectedInstance,
      }),
    ).toEqual({ activeAssetId: selectedInstance.assetId, activeRunId: null })
  })
})
