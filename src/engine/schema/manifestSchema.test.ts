import { describe, expect, it } from 'vitest'
import type { ManifestScene } from './manifestTypes'
import { parseManifestScene, safeParseManifestScene } from './manifestSchema'

describe('manifestSchema', () => {
  it('parses a valid scene document', () => {
    const scene = createValidScene()

    expect(parseManifestScene(scene)).toEqual(scene)
  })

  it('rejects malformed geometry values', () => {
    const invalidScene = createValidScene()

    invalidScene.assets[0].parts[0].visuals[0].geometry = {
      type: 'box',
      size: [0.2, Number.NaN, 0.2],
    }

    expect(safeParseManifestScene(invalidScene).success).toBe(false)
  })

  it('keeps material colors constrained to compact hex values', () => {
    const invalidScene = createValidScene()

    invalidScene.assets[0].materials[0].color = 'lavender'

    expect(safeParseManifestScene(invalidScene).success).toBe(false)
  })
})

function createValidScene(): ManifestScene {
  return {
    schemaVersion: 1,
    units: 'meters',
    assets: [
      {
        id: 'test-asset',
        name: 'Test asset',
        prompt: 'Build a simple test asset.',
        parts: [
          {
            id: 'test-base',
            name: 'Base',
            parentId: null,
            role: 'base',
            visuals: [
              {
                id: 'test-base-visual',
                geometry: {
                  type: 'box',
                  size: [0.4, 0.2, 0.3],
                },
                materialId: 'mat-white',
                transform: {
                  position: [0, 0.1, 0],
                },
              },
            ],
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
      },
    ],
  }
}
