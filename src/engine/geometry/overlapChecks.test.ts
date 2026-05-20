import { describe, expect, it } from 'vitest'
import type { ManifestAsset } from '../schema/manifestTypes'
import { buildManifestAsset, disposeManifestObject } from './assetBuilder'
import { findCurrentPoseVisualOverlaps } from './overlapChecks'

describe('findCurrentPoseVisualOverlaps', () => {
  it('does not treat the empty center of a torus as solid overlap', () => {
    const asset = createRingAndBladeAsset({
      ringGeometry: {
        radius: 0.5,
        radialSegments: 24,
        tube: 0.03,
        tubularSegments: 48,
        type: 'torus',
      },
    })
    const builtAsset = buildManifestAsset(asset)

    try {
      expect(findVisualPairs(builtAsset)).toEqual([])
    } finally {
      disposeManifestObject(builtAsset.group)
    }
  })

  it('does not treat the empty center of a closed tube loop as solid overlap', () => {
    const asset = createRingAndBladeAsset({
      ringGeometry: {
        closed: true,
        points: [
          [0.5, 0, 0],
          [0.25, 0.433, 0],
          [-0.25, 0.433, 0],
          [-0.5, 0, 0],
          [-0.25, -0.433, 0],
          [0.25, -0.433, 0],
        ],
        radialSegments: 8,
        radius: 0.03,
        tubularSegments: 24,
        type: 'tube',
      },
    })
    const builtAsset = buildManifestAsset(asset)

    try {
      expect(findVisualPairs(builtAsset)).toEqual([])
    } finally {
      disposeManifestObject(builtAsset.group)
    }
  })

  it('still detects overlap when another visual crosses torus material', () => {
    const asset = createRingAndBladeAsset({
      bladeTransformPosition: [0.5, 0, 0],
      ringGeometry: {
        radius: 0.5,
        radialSegments: 24,
        tube: 0.03,
        tubularSegments: 48,
        type: 'torus',
      },
    })
    const builtAsset = buildManifestAsset(asset)

    try {
      expect(findVisualPairs(builtAsset)).toEqual(['blade-visual|ring-visual'])
    } finally {
      disposeManifestObject(builtAsset.group)
    }
  })
})

function findVisualPairs(builtAsset: ReturnType<typeof buildManifestAsset>) {
  return findCurrentPoseVisualOverlaps(builtAsset, {
    overlapTolerance: 0.001,
    volumeTolerance: 1e-8,
  }).map((finding) =>
    [finding.visualAId, finding.visualBId].sort().join('|'),
  )
}

function createRingAndBladeAsset({
  bladeTransformPosition = [0, 0, 0],
  ringGeometry,
}: {
  bladeTransformPosition?: [number, number, number]
  ringGeometry: ManifestAsset['parts'][number]['visuals'][number]['geometry']
}): ManifestAsset {
  return {
    allowances: [],
    checks: [],
    controls: [],
    id: 'ring-overlap-test',
    joints: [
      {
        childPartId: 'blade-part',
        id: 'blade-fixed-joint',
        name: 'Blade fixed joint',
        origin: {},
        parentPartId: 'ring-part',
        type: 'fixed',
      },
    ],
    materials: [
      {
        color: '#cccccc',
        id: 'mat-ring',
        metalness: 0.5,
        name: 'Ring material',
        roughness: 0.4,
      },
      {
        color: '#444444',
        id: 'mat-blade',
        metalness: 0.2,
        name: 'Blade material',
        roughness: 0.5,
      },
    ],
    metadata: {
      createdAt: '2026-05-20T00:00:00.000Z',
      generationStatus: 'ready',
      sourceImageIds: [],
      updatedAt: '2026-05-20T00:00:00.000Z',
    },
    name: 'Ring Overlap Test',
    parts: [
      {
        id: 'ring-part',
        name: 'Ring',
        role: 'housing',
        visuals: [
          {
            geometry: ringGeometry,
            id: 'ring-visual',
            materialId: 'mat-ring',
            name: 'Ring visual',
            transform: {
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
          },
        ],
      },
      {
        id: 'blade-part',
        name: 'Blade',
        role: 'mechanism',
        visuals: [
          {
            geometry: {
              size: [0.18, 0.18, 0.02],
              type: 'box',
            },
            id: 'blade-visual',
            materialId: 'mat-blade',
            name: 'Blade visual',
            transform: {
              position: bladeTransformPosition,
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
          },
        ],
      },
    ],
    prompt: 'Test torus and tube overlap proxies.',
    schemaVersion: 2,
    units: 'meters',
  }
}
