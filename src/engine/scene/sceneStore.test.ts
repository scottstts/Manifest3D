import { describe, expect, it } from 'vitest'
import type { ManifestAsset, ManifestScene } from '../schema/manifestTypes'
import { createSceneStore } from './sceneStore'
import { createSelectionStore } from './selectionStore'

describe('sceneStore', () => {
  it('upserts and removes assets while notifying subscribers', () => {
    const scene = createTestScene()
    const store = createSceneStore(scene)
    const replacementAsset = {
      ...scene.assets[0],
      name: 'Updated fixture asset',
    }
    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })

    store.upsertAsset(replacementAsset)

    expect(store.getAsset(replacementAsset.id)?.name).toBe(
      'Updated fixture asset',
    )
    expect(store.getSnapshot().scene.assets).toHaveLength(1)

    store.removeAsset(replacementAsset.id)

    expect(store.getAsset(replacementAsset.id)).toBeUndefined()
    expect(notifications).toBe(2)

    unsubscribe()
    store.clearAssets()
    expect(notifications).toBe(2)
  })
})

function createTestScene(): ManifestScene {
  return {
    schemaVersion: 1,
    units: 'meters',
    assets: [createTestAsset()],
  }
}

function createTestAsset(): ManifestAsset {
  return {
    id: 'test-asset',
    name: 'Test asset',
    prompt: 'Build a simple test asset.',
    parts: [
      {
        id: 'test-base',
        name: 'Base',
        parentId: null,
        visuals: [],
      },
    ],
    joints: [],
    materials: [
      {
        id: 'mat-white',
        name: 'White',
        color: '#ffffff',
        metalness: 0,
        roughness: 0.5,
      },
    ],
    tests: [],
    metadata: {
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
      sourceImageIds: [],
      generationStatus: 'ready',
    },
  }
}

describe('selectionStore', () => {
  it('tracks selected asset and emits repeated focus requests', () => {
    const store = createSelectionStore()
    let notifications = 0

    store.subscribe(() => {
      notifications += 1
    })

    store.selectAsset('test-asset', 'test-base')
    store.selectAsset('test-asset', 'test-base')

    expect(store.getSnapshot().selection).toEqual({
      assetId: 'test-asset',
      partId: 'test-base',
    })
    expect(store.getSnapshot().revision).toBe(2)
    expect(notifications).toBe(2)

    store.clearSelection()

    expect(store.getSnapshot().selection.assetId).toBeNull()
    expect(notifications).toBe(3)
  })
})
