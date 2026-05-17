import { describe, expect, it } from 'vitest'
import type { ManifestAsset, ManifestScene } from '../schema/manifestTypes'
import { createSceneStore } from './sceneStore'

describe('createSceneStore', () => {
  it('keeps the create workspace to one asset', () => {
    const firstAsset = createTestAsset('first-asset')
    const secondAsset = createTestAsset('second-asset')
    const store = createSceneStore(createTestScene(firstAsset))
    const initialSnapshot = store.getSnapshot()

    store.upsertAsset(secondAsset)

    expect(initialSnapshot.scene.assets[0].id).toBe('first-asset')
    expect(store.getSnapshot().activeWorkspace).toBe('create')
    expect(store.getSnapshot().scene.assets.map((asset) => asset.id)).toEqual([
      'second-asset',
    ])
    expect(store.getAsset('first-asset')).toBeUndefined()
  })

  it('adds and duplicates assets in the compose workspace as independent instances', () => {
    const asset = createTestAsset('test-asset')
    const store = createSceneStore(createTestScene())

    store.setWorkspace('compose')
    const firstInstance = store.addComposeAsset(asset, 'test-asset:v1')
    const duplicate = store.duplicateComposeInstance(firstInstance.instanceId)

    expect(store.getSnapshot().scene.assets.map((candidate) => candidate.id)).toEqual([
      'test-asset',
      'test-asset',
    ])
    expect(duplicate?.instanceId).not.toBe(firstInstance.instanceId)
    expect(duplicate?.transform.position[0]).toBeGreaterThan(
      firstInstance.transform.position[0],
    )
  })

  it('updates compose instance transforms and versions', () => {
    const assetV1 = createTestAsset('test-asset')
    const assetV2 = {
      ...assetV1,
      name: 'Test Asset V2',
    }
    const store = createSceneStore(createTestScene())

    store.setWorkspace('compose')
    const instance = store.addComposeAsset(assetV1, 'test-asset:v1')

    store.updateComposeInstanceTransform(instance.instanceId, {
      position: [1, 2, 3],
      rotation: [0, 0.5, 0],
      scale: [1.2, 1.2, 1.2],
    })
    store.setComposeInstanceVersion(
      instance.instanceId,
      assetV2,
      'test-asset:v2',
    )

    expect(store.getInstance(instance.instanceId)).toMatchObject({
      asset: expect.objectContaining({
        name: 'Test Asset V2',
      }),
      transform: {
        position: [1, 2, 3],
        rotation: [0, 0.5, 0],
        scale: [1.2, 1.2, 1.2],
      },
      versionId: 'test-asset:v2',
    })
  })

  it('restores compose instances from a snapshot for undo and redo', () => {
    const asset = createTestAsset('test-asset')
    const store = createSceneStore(createTestScene())

    store.setWorkspace('compose')
    const firstInstance = store.addComposeAsset(asset, 'test-asset:v1')
    const snapshot = store.getSnapshot().composeInstances

    store.duplicateComposeInstance(firstInstance.instanceId)
    store.setComposeInstances(snapshot)

    expect(store.getSnapshot().composeInstances).toHaveLength(1)
    expect(store.getSnapshot().composeInstances[0]).toMatchObject({
      assetId: 'test-asset',
      instanceId: firstInstance.instanceId,
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      versionId: 'test-asset:v1',
    })
  })

  it('removes assets from both workspaces by asset id', () => {
    const asset = createTestAsset('test-asset')
    const store = createSceneStore(createTestScene(asset))

    store.setWorkspace('compose')
    store.addComposeAsset(asset, 'test-asset:v1')
    store.removeAsset('test-asset')

    expect(store.getSnapshot().createInstance).toBeNull()
    expect(store.getSnapshot().composeInstances).toEqual([])
  })

  it('clears only the create asset when starting a new create run', () => {
    const createAsset = createTestAsset('create-asset')
    const composeAsset = createTestAsset('compose-asset')
    const store = createSceneStore(createTestScene(createAsset))

    store.setWorkspace('compose')
    store.addComposeAsset(composeAsset, 'compose-asset:v1')
    store.setWorkspace('create')
    store.clearCreateAsset()

    expect(store.getSnapshot().createInstance).toBeNull()
    expect(store.getSnapshot().scene.assets).toEqual([])

    store.setWorkspace('compose')

    expect(
      store.getSnapshot().composeInstances.map((instance) => instance.assetId),
    ).toEqual(['compose-asset'])
  })
})

function createTestScene(asset = createTestAsset()): ManifestScene {
  return {
    schemaVersion: 1,
    units: 'meters',
    assets: [asset],
  }
}

function createTestAsset(assetId = 'test-asset'): ManifestAsset {
  return {
    schemaVersion: 2,
    id: assetId,
    name: 'Test Asset',
    prompt: 'test',
    units: 'meters',
    parts: [
      {
        id: `${assetId}-base`,
        name: 'Base',
        visuals: [
          {
            id: `${assetId}-base-visual`,
            geometry: {
              size: [1, 1, 1],
              type: 'box',
            },
            materialId: `${assetId}-material`,
            transform: {},
          },
        ],
      },
    ],
    joints: [],
    materials: [
      {
        color: '#ffffff',
        id: `${assetId}-material`,
        metalness: 0,
        name: 'White',
        roughness: 0.5,
      },
    ],
    checks: [],
    allowances: [],
    metadata: {
      createdAt: '2026-05-16T00:00:00.000Z',
      generationStatus: 'ready',
      sourceImageIds: [],
      updatedAt: '2026-05-16T00:00:00.000Z',
    },
  }
}
