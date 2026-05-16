import { describe, expect, it } from 'vitest'
import type { ManifestAsset, ManifestScene } from '../schema/manifestTypes'
import { createSceneStore } from './sceneStore'

describe('createSceneStore', () => {
  it('upserts assets without mutating previous snapshots', () => {
    const scene = createTestScene()
    const store = createSceneStore(scene)
    const initialSnapshot = store.getSnapshot()
    const replacementAsset: ManifestAsset = {
      ...scene.assets[0],
      name: 'Replacement Asset',
    }

    store.upsertAsset(replacementAsset)

    expect(initialSnapshot.scene.assets[0].name).toBe('Test Asset')
    expect(store.getSnapshot().scene.assets).toHaveLength(1)
    expect(store.getAsset('test-asset')?.name).toBe('Replacement Asset')
  })

  it('removes assets by id', () => {
    const store = createSceneStore(createTestScene())

    store.removeAsset('test-asset')

    expect(store.getSnapshot().scene.assets).toEqual([])
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
    schemaVersion: 2,
    id: 'test-asset',
    name: 'Test Asset',
    prompt: 'test',
    units: 'meters',
    parts: [
      {
        id: 'test-base',
        name: 'Base',
        visuals: [
          {
            id: 'test-base-visual',
            geometry: {
              size: [1, 1, 1],
              type: 'box',
            },
            materialId: 'test-material',
            transform: {},
          },
        ],
      },
    ],
    joints: [],
    materials: [
      {
        color: '#ffffff',
        id: 'test-material',
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
