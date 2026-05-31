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

  it('does not treat the swept AABB of a long rotated solid as filled overlap', () => {
    const asset = createDiagonalBeamAsset()
    const builtAsset = buildManifestAsset(asset)

    try {
      expect(findVisualPairs(builtAsset)).toEqual([])
    } finally {
      disposeManifestObject(builtAsset.group)
    }
  })

  it('allows connectorTube endpoint contact with referenced parts', () => {
    const asset = createConnectorContactAsset()
    const builtAsset = buildManifestAsset(asset)

    try {
      expect(findVisualPairs(builtAsset)).toEqual([])
    } finally {
      disposeManifestObject(builtAsset.group)
    }
  })

  it('still detects connectorTube overlap with unrelated obstruction parts', () => {
    const asset = createConnectorContactAsset({ includeObstruction: true })
    const builtAsset = buildManifestAsset(asset)

    try {
      expect(findVisualPairs(builtAsset)).toContain('cable-visual|obstruction-visual')
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

function createDiagonalBeamAsset(): ManifestAsset {
  return {
    allowances: [],
    checks: [],
    controls: [],
    id: 'diagonal-beam-overlap-test',
    joints: [
      {
        childPartId: 'nearby-block-part',
        id: 'nearby-block-fixed-joint',
        name: 'Nearby block fixed joint',
        origin: {},
        parentPartId: 'beam-part',
        type: 'fixed',
      },
    ],
    materials: [
      {
        color: '#cccccc',
        id: 'mat-grey',
        metalness: 0.1,
        name: 'Grey',
        roughness: 0.5,
      },
    ],
    metadata: {
      createdAt: '2026-05-31T00:00:00.000Z',
      generationStatus: 'ready',
      sourceImageIds: [],
      updatedAt: '2026-05-31T00:00:00.000Z',
    },
    name: 'Diagonal Beam Overlap Test',
    parts: [
      {
        id: 'beam-part',
        name: 'Beam',
        role: 'support',
        visuals: [
          {
            geometry: {
              size: [2, 0.05, 0.05],
              type: 'box',
            },
            id: 'beam-visual',
            materialId: 'mat-grey',
            name: 'Beam visual',
            transform: {
              position: [0, 0, 0],
              rotation: [0, 0, Math.PI / 4],
              scale: [1, 1, 1],
            },
          },
        ],
      },
      {
        id: 'nearby-block-part',
        name: 'Nearby Block',
        role: 'support',
        visuals: [
          {
            geometry: {
              size: [0.1, 0.1, 0.1],
              type: 'box',
            },
            id: 'nearby-block-visual',
            materialId: 'mat-grey',
            name: 'Nearby block visual',
            transform: {
              position: [0, 0.6, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
          },
        ],
      },
    ],
    prompt: 'Test segmented solid relation proxies.',
    schemaVersion: 2,
    units: 'meters',
  }
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

function createConnectorContactAsset({
  includeObstruction = false,
}: {
  includeObstruction?: boolean
} = {}): ManifestAsset {
  return {
    allowances: [],
    checks: [],
    controls: [],
    id: 'connector-contact-test',
    joints: [
      {
        childPartId: 'moving-part',
        id: 'moving-fixed-joint',
        name: 'Moving fixed joint',
        origin: {},
        parentPartId: 'anchor-part',
        type: 'fixed',
      },
      ...(includeObstruction
        ? [
            {
              childPartId: 'obstruction-part',
              id: 'obstruction-fixed-joint',
              name: 'Obstruction fixed joint',
              origin: {},
              parentPartId: 'anchor-part',
              type: 'fixed' as const,
            },
          ]
        : []),
      {
        childPartId: 'cable-part',
        id: 'cable-fixed-joint',
        name: 'Cable fixed joint',
        origin: {},
        parentPartId: 'anchor-part',
        type: 'fixed',
      },
    ],
    materials: [
      {
        color: '#999999',
        id: 'mat-anchor',
        metalness: 0.1,
        name: 'Anchor material',
        roughness: 0.5,
      },
      {
        color: '#111111',
        id: 'mat-cable',
        metalness: 0.4,
        name: 'Cable material',
        roughness: 0.35,
      },
    ],
    metadata: {
      createdAt: '2026-05-26T00:00:00.000Z',
      generationStatus: 'ready',
      sourceImageIds: [],
      updatedAt: '2026-05-26T00:00:00.000Z',
    },
    name: 'Connector Contact Test',
    parts: [
      createConnectorBoxPart('anchor-part', 'Anchor', 'anchor-visual', [0, 0, 0]),
      createConnectorBoxPart('moving-part', 'Moving Part', 'moving-visual', [1, 0, 0]),
      ...(includeObstruction
        ? [
            createConnectorBoxPart(
              'obstruction-part',
              'Obstruction',
              'obstruction-visual',
              [0.5, 0, 0],
            ),
          ]
        : []),
      {
        id: 'cable-part',
        name: 'Cable',
        role: 'support',
        visuals: [
          {
            geometry: {
              end: {
                partId: 'moving-part',
                position: [0.9, 0, 0],
              },
              radius: 0.02,
              start: {
                partId: 'anchor-part',
                position: [0.1, 0, 0],
              },
              type: 'connectorTube',
            },
            id: 'cable-visual',
            materialId: 'mat-cable',
            name: 'Cable visual',
            transform: {
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
          },
        ],
      },
    ],
    prompt: 'Test connector tube endpoint overlap behavior.',
    schemaVersion: 2,
    units: 'meters',
  }
}

function createConnectorBoxPart(
  id: string,
  name: string,
  visualId: string,
  position: [number, number, number],
): ManifestAsset['parts'][number] {
  return {
    id,
    name,
    role: 'support',
    visuals: [
      {
        geometry: {
          size: [0.18, 0.18, 0.18],
          type: 'box',
        },
        id: visualId,
        materialId: 'mat-anchor',
        name: `${name} visual`,
        transform: {
          position,
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      },
    ],
  }
}
