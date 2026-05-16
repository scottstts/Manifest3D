import { describe, expect, it } from 'vitest'
import type { ManifestScene } from './manifestTypes'
import { parseManifestScene, safeParseManifestScene } from './manifestSchema'

describe('manifestSchema', () => {
  it('accepts a valid Contract V2 scene', () => {
    const scene = createValidScene()

    expect(parseManifestScene(scene)).toEqual(scene)
  })

  it('rejects malformed geometry descriptors', () => {
    const invalidScene = createValidScene()

    invalidScene.assets[0].parts[0].visuals[0].geometry = {
      size: [0.8, 0, 0.4],
      type: 'box',
    }

    expect(safeParseManifestScene(invalidScene).success).toBe(false)
  })

  it('rejects legacy parentId and tests fields', () => {
    const invalidScene = createValidScene()
    const legacyPart = invalidScene.assets[0].parts[0] as Record<string, unknown>
    const legacyAsset = invalidScene.assets[0] as Record<string, unknown>

    legacyPart.parentId = null
    legacyAsset.tests = []

    expect(safeParseManifestScene(invalidScene).success).toBe(false)
  })
})

function createValidScene(): ManifestScene {
  return {
    schemaVersion: 1,
    units: 'meters',
    assets: [
      {
        schemaVersion: 2,
        id: 'schema-crate',
        name: 'Schema Crate',
        prompt: 'A schema test crate.',
        units: 'meters',
        parts: [
          {
            id: 'schema-base',
            name: 'Base',
            role: 'base',
            visuals: [
              {
                id: 'schema-base-visual',
                geometry: {
                  size: [0.8, 0.2, 0.4],
                  type: 'box',
                },
                materialId: 'mat-blue',
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
            color: '#88aaff',
            id: 'mat-blue',
            metalness: 0.1,
            name: 'Blue',
            roughness: 0.4,
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
      },
    ],
  }
}
