import type { ManifestAsset } from '../schema/manifestTypes'

export function createValidValidationFixtureAsset(): ManifestAsset {
  return {
    schemaVersion: 2,
    id: 'validation-crate',
    name: 'Validation Crate',
    prompt: 'Build a compact utility crate with a hinged lid.',
    units: 'meters',
    parts: [
      {
        id: 'crate-base',
        name: 'Base',
        role: 'base',
        visuals: [
          {
            id: 'crate-base-shell',
            name: 'Base shell',
            geometry: {
              size: [0.82, 0.34, 0.52],
              type: 'box',
            },
            materialId: 'mat-violet',
            transform: {
              position: [0, 0.17, 0],
            },
          },
        ],
      },
      {
        id: 'crate-lid',
        name: 'Lid',
        role: 'hinge',
        visuals: [
          {
            id: 'crate-lid-panel',
            name: 'Lid panel',
            geometry: {
              size: [0.86, 0.08, 0.56],
              type: 'box',
            },
            materialId: 'mat-white',
            transform: {
              position: [0, 0.04, 0.28],
            },
          },
        ],
      },
    ],
    joints: [
      {
        axis: [1, 0, 0],
        childPartId: 'crate-lid',
        id: 'crate-lid-hinge',
        limits: {
          effort: 10,
          lower: -1.9,
          upper: 0,
          velocity: 2,
        },
        name: 'Lid Hinge',
        origin: {
          position: [0, 0.34, -0.28],
        },
        parentPartId: 'crate-base',
        type: 'revolute',
      },
    ],
    materials: [
      {
        color: '#a8a0ff',
        id: 'mat-violet',
        metalness: 0.05,
        name: 'Soft violet',
        roughness: 0.46,
      },
      {
        color: '#f7f6ff',
        id: 'mat-white',
        metalness: 0,
        name: 'Frosted white',
        roughness: 0.38,
      },
    ],
    checks: [
      {
        partId: 'crate-base',
        type: 'part_exists',
      },
      {
        jointId: 'crate-lid-hinge',
        jointType: 'revolute',
        type: 'joint_exists',
      },
      {
        partAId: 'crate-base',
        partBId: 'crate-lid',
        type: 'expect_contact',
        visualAId: 'crate-base-shell',
        visualBId: 'crate-lid-panel',
      },
      {
        axes: 'xz',
        minOverlap: 0.5,
        partAId: 'crate-base',
        partBId: 'crate-lid',
        type: 'expect_overlap',
        visualAId: 'crate-base-shell',
        visualBId: 'crate-lid-panel',
      },
      {
        axes: 'xz',
        innerPartId: 'crate-base',
        outerPartId: 'crate-lid',
        margin: 0.03,
        type: 'expect_within',
        innerVisualId: 'crate-base-shell',
        outerVisualId: 'crate-lid-panel',
      },
    ],
    allowances: [],
    metadata: {
      createdAt: '2026-05-16T00:00:00.000Z',
      generationStatus: 'ready',
      sourceImageIds: [],
      updatedAt: '2026-05-16T00:00:00.000Z',
    },
  }
}

export function createInvalidValidationFixtureAsset(): ManifestAsset {
  const asset = createValidValidationFixtureAsset()

  return {
    ...asset,
    id: 'invalid-validation-crate',
    name: 'Invalid Validation Crate',
    joints: [
      {
        axis: [0, 0, 0],
        childPartId: 'missing-lid',
        id: 'crate-lid-hinge',
        name: 'Broken Lid Hinge',
        origin: {},
        parentPartId: 'crate-base',
        type: 'revolute',
      },
    ],
    parts: asset.parts.map((part, index) =>
      index === 1
        ? {
            ...part,
            id: 'crate-base',
            visuals: part.visuals.map((visual) => ({
              ...visual,
              materialId: 'missing-material',
            })),
          }
        : part,
    ),
  }
}

export function createOverlappingValidationFixtureAsset(): ManifestAsset {
  const asset = createValidValidationFixtureAsset()

  return {
    ...asset,
    id: 'overlap-validation-crate',
    joints: [
      {
        ...asset.joints[0],
        origin: {
          position: [0, 0.28, -0.28],
        },
      },
    ],
  }
}

export function createAllowedOverlapValidationFixtureAsset(): ManifestAsset {
  const asset = createOverlappingValidationFixtureAsset()

  return {
    ...asset,
    id: 'allowed-overlap-validation-crate',
    allowances: [
      {
        partAId: 'crate-base',
        partBId: 'crate-lid',
        reason: 'The lid is intentionally seated slightly into the soft gasket represented by the base proxy.',
        type: 'allow_overlap',
        visualAId: 'crate-base-shell',
        visualBId: 'crate-lid-panel',
      },
    ],
  }
}
