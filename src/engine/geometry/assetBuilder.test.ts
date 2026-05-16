import { describe, expect, it } from 'vitest'
import { parseManifestAsset } from '../schema/manifestSchema'
import type { ManifestAsset } from '../schema/manifestTypes'
import {
  buildManifestAsset,
  disposeManifestObject,
  findManifestObjectData,
} from './assetBuilder'

describe('buildManifestAsset', () => {
  it('builds a Manifest3D asset group with selectable metadata', () => {
    const asset = createValidAsset()
    const builtAsset = buildManifestAsset(asset)
    const mesh = builtAsset.visualMeshes.get('test-core-cylinder')

    expect(builtAsset.group.name).toBe(asset.name)
    expect(builtAsset.group.userData.manifest3d).toMatchObject({
      assetId: asset.id,
      kind: 'asset',
    })
    expect(builtAsset.partGroups.size).toBe(asset.parts.length)
    expect(builtAsset.visualMeshes.size).toBe(2)
    expect(mesh).toBeDefined()
    expect(findManifestObjectData(mesh!)).toMatchObject({
      assetId: asset.id,
      kind: 'visual',
      partId: 'test-core',
      visualId: 'test-core-cylinder',
    })
    expect(builtAsset.bounds.isEmpty()).toBe(false)

    disposeManifestObject(builtAsset.group)
  })

  it('fails before building meshes that reference missing materials', () => {
    const asset = createValidAsset()

    asset.parts[0].visuals[0].materialId = 'missing-material'

    expect(() => buildManifestAsset(asset)).toThrow(/missing material/)
  })
})

function createValidAsset(): ManifestAsset {
  return parseManifestAsset({
    id: 'test-asset',
    name: 'Test asset',
    prompt: 'Build a compact test asset.',
    parts: [
      {
        id: 'test-base',
        name: 'Base',
        parentId: null,
        role: 'base',
        visuals: [
          {
            id: 'test-base-box',
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
      {
        id: 'test-core',
        name: 'Core',
        parentId: 'test-base',
        role: 'housing',
        visuals: [
          {
            id: 'test-core-cylinder',
            geometry: {
              type: 'cylinder',
              height: 0.32,
              radialSegments: 16,
              radiusBottom: 0.12,
              radiusTop: 0.08,
            },
            materialId: 'mat-blue',
            transform: {
              position: [0, 0.36, 0],
            },
          },
        ],
      },
    ],
    joints: [
      {
        id: 'test-core-fixed',
        name: 'Core fixed to base',
        type: 'fixed',
        parentPartId: 'test-base',
        childPartId: 'test-core',
      },
    ],
    materials: [
      {
        id: 'mat-white',
        name: 'White',
        color: '#ffffff',
        metalness: 0,
        roughness: 0.5,
      },
      {
        id: 'mat-blue',
        name: 'Blue',
        color: '#6677ff',
        metalness: 0.1,
        roughness: 0.4,
      },
    ],
    tests: [],
    metadata: {
      createdAt: '2026-05-16T00:00:00.000Z',
      updatedAt: '2026-05-16T00:00:00.000Z',
      sourceImageIds: [],
      generationStatus: 'ready',
    },
  })
}
