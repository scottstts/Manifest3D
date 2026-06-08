import { describe, expect, it } from 'vitest'
import {
  createAllowedOverlapValidationFixtureAsset,
  createInvalidValidationFixtureAsset,
  createOverlappingValidationFixtureAsset,
  createValidValidationFixtureAsset,
} from '../testing/validationFixtureAsset'
import type { ManifestAsset } from '../schema/manifestTypes'
import { createSceneStore } from '../scene/sceneStore'
import { createValidationTimeline } from '../agent/session/validationTimeline'
import { commitValidatedAsset } from './commitValidatedAsset'
import { validateManifestAssetCandidate } from './validateManifest'
import { createValidationReport } from './reportBuilder'

describe('validateManifestAssetCandidate', () => {
  it('accepts a valid Contract V2 asset fixture', () => {
    const result = validateManifestAssetCandidate(
      createValidValidationFixtureAsset(),
    )

    expect(result.asset?.id).toBe('validation-crate')
    expect(result.report.valid).toBe(true)
    expect(result.report.summary).toEqual({
      failureCount: 0,
      noteCount: 0,
      warningCount: 0,
    })
    expect(result.report.steps.map((step) => step.status)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
    ])
  })

  it('accepts connectorTube visuals with identity transforms and records connector probe measurements', () => {
    const asset = createValidValidationFixtureAsset()

    asset.parts[0].visuals.push({
      geometry: {
        end: {
          partId: 'crate-lid',
          position: [0.55, 0.12, 0],
        },
        radius: 0.008,
        sag: 0.03,
        start: {
          partId: 'crate-base',
          position: [0.55, 0.42, 0],
        },
        type: 'connectorTube',
      },
      id: 'lid-retainer-cable',
      materialId: 'mat-white',
      name: 'Lid retainer cable',
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    })

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(true)
    expect(result.probeReport?.connectors[0]).toMatchObject({
      endPartId: 'crate-lid',
      id: 'lid-retainer-cable',
      ownerPartId: 'crate-base',
      startPartId: 'crate-base',
    })
    expect(result.probeReport?.connectors[0]?.length).toBeGreaterThan(0.1)
  })

  it('rejects movable joints without a close visible mechanical fit', () => {
    const asset = createValidValidationFixtureAsset()

    asset.parts[1].visuals[0].transform.position = [2, 0.04, 0.28]

    const result = validateManifestAssetCandidate(asset)
    const signalCodes = result.report.bundle.signals.map((signal) => signal.code)

    expect(result.report.valid).toBe(false)
    expect(signalCodes).toContain('movable_joint_missing_close_fit')
  })

  it('rejects disconnected visual islands in mechanically critical parts', () => {
    const asset = createValidValidationFixtureAsset()

    asset.parts[0].role = 'support'
    asset.parts[0].visuals.push({
      geometry: {
        size: [0.08, 0.08, 0.08],
        type: 'box',
      },
      id: 'detached-support-boss',
      materialId: 'mat-violet',
      name: 'Detached support boss',
      transform: {
        position: [1.6, 0.17, 0],
      },
    })

    const result = validateManifestAssetCandidate(asset)
    const signal = result.report.bundle.signals.find(
      (candidate) => candidate.code === 'part_disconnected_geometry_islands',
    )

    expect(result.report.valid).toBe(false)
    expect(signal).toMatchObject({
      kind: 'disconnected_geometry_island',
      severity: 'failure',
    })
  })

  it('rejects connectorTube visuals with transforms or missing endpoint parts', () => {
    const asset = createValidValidationFixtureAsset()

    asset.parts[0].visuals.push({
      geometry: {
        end: {
          partId: 'missing-part',
          position: [0.55, 0.12, 0],
        },
        radius: 0.008,
        start: {
          partId: 'crate-base',
          position: [0.55, 0.42, 0],
        },
        type: 'connectorTube',
      },
      id: 'broken-cable',
      materialId: 'mat-white',
      transform: {
        position: [0, 0.1, 0],
      },
    })

    const result = validateManifestAssetCandidate(asset)
    const signalCodes = result.report.bundle.signals.map((signal) => signal.code)

    expect(result.report.valid).toBe(false)
    expect(signalCodes).toContain('connector_missing_part_reference')
    expect(signalCodes).toContain('connector_tube_transform_not_supported')
    expect(result.probeReport).toBeNull()
  })

  it('reports schema paths for malformed candidates', () => {
    const malformedAsset = createValidValidationFixtureAsset()

    malformedAsset.parts[0].visuals[0].geometry = {
      size: [0.82, Number.NaN, 0.52],
      type: 'box',
    }

    const result = validateManifestAssetCandidate(malformedAsset)

    expect(result.asset).toBeNull()
    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals[0]).toMatchObject({
      code: 'schema_invalid',
      path: '/parts/0/visuals/0/geometry/size/1',
      stage: 'schema',
    })
    expect(
      result.report.steps.find((step) => step.stage === 'structure')?.status,
    ).toBe('skipped')
  })

  it('reports structural failures with repairable refs and paths', () => {
    const result = validateManifestAssetCandidate(
      createInvalidValidationFixtureAsset(),
    )
    const signalCodes = result.report.bundle.signals.map((signal) => signal.code)

    expect(result.report.valid).toBe(false)
    expect(signalCodes).toContain('duplicate_part_id')
    expect(signalCodes).toContain('missing_material_reference')
    expect(signalCodes).toContain('joint_missing_child')
    expect(signalCodes).toContain('joint_axis_required')
    expect(signalCodes).toContain('revolute_limits_required')
    expect(
      result.report.bundle.signals.find(
        (signal) => signal.code === 'missing_material_reference',
      ),
    ).toMatchObject({
      path: '/parts/1/visuals/0/materialId',
      refs: {
        partId: 'crate-base',
        visualId: 'crate-lid-panel',
      },
      stage: 'structure',
    })
    expect(
      result.report.steps.find((step) => step.stage === 'build')?.status,
    ).toBe('skipped')
  })

  it('catches invalid prismatic joint limits', () => {
    const asset = createValidValidationFixtureAsset()

    asset.joints = [
      {
        axis: [0, 1, 0],
        childPartId: 'crate-lid',
        id: 'bad-slider',
        limits: {
          effort: 10,
          lower: 1,
          upper: 0,
          velocity: 1,
        },
        name: 'Bad Slider',
        origin: {
          position: [0, 0.34, 0],
        },
        parentPartId: 'crate-base',
        type: 'prismatic',
      },
    ]

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'joint_limits_order',
          stage: 'structure',
        }),
      ]),
    )
  })

  it('rejects rounded boxes whose radius exceeds their shortest half extent', () => {
    const asset = createValidValidationFixtureAsset()

    asset.parts[0].visuals[0].geometry = {
      radius: 0.3,
      size: [0.4, 0.2, 0.5],
      type: 'roundedBox',
    }

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'rounded_box_radius_too_large',
          path: '/parts/0/visuals/0/geometry/radius',
          stage: 'structure',
        }),
      ]),
    )
  })

  it('flags candidates with implausibly tiny built bounds', () => {
    const asset = createValidValidationFixtureAsset()

    asset.parts = [
      {
        ...asset.parts[0],
        visuals: [
          {
            ...asset.parts[0].visuals[0],
            geometry: {
              size: [0.005, 0.005, 0.005],
              type: 'box',
            },
          },
        ],
      },
    ]
    asset.joints = []
    asset.controls = []
    asset.checks = []

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'asset_too_tiny',
          stage: 'baseline_qc',
        }),
      ]),
    )
  })

  it('runs exact authored checks against contact, overlap, and containment', () => {
    const asset = createValidValidationFixtureAsset()

    asset.checks = [
      {
        partAId: 'crate-base',
        partBId: 'crate-lid',
        type: 'expect_contact',
      },
      {
        axes: 'xz',
        minOverlap: 0.5,
        partAId: 'crate-base',
        partBId: 'crate-lid',
        type: 'expect_overlap',
      },
      {
        axes: 'xz',
        innerPartId: 'crate-lid',
        outerPartId: 'crate-base',
        margin: 0,
        type: 'expect_within',
      },
    ]

    const result = validateManifestAssetCandidate(asset)
    const signalCodes = result.report.bundle.signals.map((signal) => signal.code)

    expect(result.report.valid).toBe(false)
    expect(signalCodes).toContain('expect_within_failed')
    expect(signalCodes).not.toContain('expect_contact_failed')
    expect(signalCodes).not.toContain('expect_overlap_failed')
  })

  it('runs authored path-contact checks against multiple generic targets', () => {
    const passingAsset = createBeltDriveFixtureAsset()
    const failingAsset = createBeltDriveFixtureAsset()

    failingAsset.parts[2].visuals[0] = {
      ...failingAsset.parts[2].visuals[0],
      transform: {
        position: [0.55, 0.25, 0],
      },
    }

    const passingResult = validateManifestAssetCandidate(passingAsset)
    const failingResult = validateManifestAssetCandidate(failingAsset)

    expect(passingResult.report.valid).toBe(true)
    expect(failingResult.report.valid).toBe(false)
    expect(failingResult.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'expect_path_contacts_failed',
          kind: 'path_contact_fit',
          refs: expect.objectContaining({
            pathPartId: 'timing-belt',
            targetPartIds: 'left-pulley, right-pulley',
          }),
          stage: 'checks',
        }),
      ]),
    )
  })

  it('requires generic mechanical path parts to declare multi-target contact evidence', () => {
    const asset = createBeltDriveFixtureAsset()

    asset.checks = asset.checks.filter(
      (check) => check.type !== 'expect_path_contacts',
    )

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_path_contacts_missing',
          kind: 'mechanical_relation_coverage',
          refs: expect.objectContaining({
            partId: 'timing-belt',
            requiredContacts: '2',
          }),
          stage: 'structure',
        }),
      ]),
    )
  })

  it('does not count weak one-off contacts as wrapped path evidence', () => {
    const asset = createBeltDriveFixtureAsset()

    asset.checks = [
      {
        contactTolerance: 0.004,
        maxPenetration: 0.004,
        partAId: 'timing-belt',
        partBId: 'left-pulley',
        type: 'expect_contact',
        visualAId: 'timing-belt-run',
        visualBId: 'left-pulley-block',
      },
      {
        contactTolerance: 0.004,
        maxPenetration: 0.004,
        partAId: 'timing-belt',
        partBId: 'right-pulley',
        type: 'expect_contact',
        visualAId: 'timing-belt-run',
        visualBId: 'right-pulley-block',
      },
    ]

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_path_contacts_missing',
          kind: 'mechanical_relation_coverage',
          refs: expect.objectContaining({
            currentContacts: '0',
            partId: 'timing-belt',
          }),
          stage: 'structure',
        }),
      ]),
    )
  })

  it('does not classify belt pulleys or related descriptions as path parts', () => {
    const asset = createBeltDriveFixtureAsset()
    const rightPulley = asset.parts.find((part) => part.id === 'right-pulley')
    const base = asset.parts.find((part) => part.id === 'drive-base')

    expect(rightPulley).toBeDefined()
    expect(base).toBeDefined()
    rightPulley!.name = 'Right belt pulley'
    base!.description = 'Support frame with a belt guard and pulley brackets.'
    asset.checks = asset.checks.filter(
      (check) => check.type !== 'expect_path_contacts',
    )

    const result = validateManifestAssetCandidate(asset)
    const pathContactPartIds = result.report.bundle.signals
      .filter((signal) => signal.code === 'mechanical_path_contacts_missing')
      .map((signal) => signal.refs?.partId)

    expect(pathContactPartIds).toEqual(['timing-belt'])
  })

  it('requires rods and linkages in mechanical assets to prove both coupled ends', () => {
    const asset = createBeltDriveFixtureAsset()

    asset.parts.push({
      id: 'connecting-rod',
      name: 'Connecting rod',
      role: 'mechanism',
      visuals: [
        {
          geometry: {
            size: [0.24, 0.035, 0.035],
            type: 'box',
          },
          id: 'connecting-rod-bar',
          materialId: 'mat-steel',
          name: 'Rod bar',
          transform: {
            position: [-0.17, 0.36, 0],
          },
        },
      ],
    })
    asset.joints.push({
      childPartId: 'connecting-rod',
      id: 'connecting-rod-mount',
      name: 'Connecting rod mount',
      origin: {
        position: [0, 0.3, 0],
      },
      parentPartId: 'belt-drive-base',
      type: 'fixed',
    })
    asset.checks.push({
      contactTolerance: 0.004,
      maxPenetration: 0.004,
      partAId: 'connecting-rod',
      partBId: 'left-pulley',
      type: 'expect_contact',
      visualAId: 'connecting-rod-bar',
      visualBId: 'left-pulley-block',
    })

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_coupler_contacts_missing',
          kind: 'mechanical_relation_coverage',
          refs: expect.objectContaining({
            currentContacts: '1',
            partId: 'connecting-rod',
            requiredContacts: '2',
          }),
          stage: 'structure',
        }),
      ]),
    )
  })

  it('does not count broad multi-visual coupler checks as exact mechanical evidence', () => {
    const asset = createBeltDriveFixtureAsset()

    asset.parts.push({
      id: 'linkage-arm',
      name: 'Linkage arm',
      role: 'mechanism',
      visuals: [
        {
          geometry: {
            size: [0.18, 0.03, 0.03],
            type: 'box',
          },
          id: 'linkage-arm-bar',
          materialId: 'mat-steel',
          name: 'Linkage bar',
          transform: {
            position: [-0.16, 0.35, 0],
          },
        },
        {
          geometry: {
            radius: 0.03,
            type: 'sphere',
          },
          id: 'linkage-arm-eye',
          materialId: 'mat-steel',
          name: 'Linkage eye',
          transform: {
            position: [-0.34, 0.25, 0],
          },
        },
      ],
    })
    asset.joints.push({
      childPartId: 'linkage-arm',
      id: 'linkage-arm-mount',
      name: 'Linkage arm mount',
      origin: {},
      parentPartId: 'belt-drive-base',
      type: 'fixed',
    })
    asset.checks.push(
      {
        contactTolerance: 0.004,
        maxPenetration: 0.004,
        partAId: 'linkage-arm',
        partBId: 'left-pulley',
        type: 'expect_contact',
      },
      {
        contactTolerance: 0.004,
        maxPenetration: 0.004,
        partAId: 'linkage-arm',
        partBId: 'right-pulley',
        type: 'expect_contact',
      },
    )

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_coupler_contacts_missing',
          kind: 'mechanical_relation_coverage',
          refs: expect.objectContaining({
            currentContacts: '0',
            partId: 'linkage-arm',
          }),
          stage: 'structure',
        }),
      ]),
    )
  })

  it('requires prompt-critical mechanical path components to be represented as parts', () => {
    const asset = createBeltDriveFixtureAsset()

    asset.parts = asset.parts.filter((part) => part.id !== 'timing-belt')
    asset.joints = asset.joints.filter((joint) => joint.childPartId !== 'timing-belt')
    asset.checks = []

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_path_part_missing',
          kind: 'mechanical_relation_coverage',
          stage: 'structure',
        }),
      ]),
    )
  })

  it('does not count visual-only labels as named mechanical path parts', () => {
    const asset = createBeltDriveFixtureAsset()
    const beltPart = asset.parts.find((part) => part.id === 'timing-belt')

    expect(beltPart).toBeDefined()
    beltPart!.id = 'drive-loop-carrier'
    beltPart!.name = 'Drive loop carrier'
    asset.joints = asset.joints.map((joint) =>
      joint.childPartId === 'timing-belt'
        ? {
            ...joint,
            childPartId: 'drive-loop-carrier',
          }
        : joint,
    )
    asset.checks = asset.checks.map((check) =>
      check.type === 'expect_path_contacts'
        ? {
            ...check,
            pathPartId: 'drive-loop-carrier',
          }
        : check,
    )

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_path_part_missing',
          kind: 'mechanical_relation_coverage',
          stage: 'structure',
        }),
      ]),
    )
  })

  it('requires prompt-critical guided and rotary components to be represented as parts', () => {
    const asset = createBeltDriveFixtureAsset()

    asset.name = 'Piston Pump Study'
    asset.prompt =
      'A CAD-like piston pump with a piston sliding in a cylinder and driven by a crankshaft.'

    const result = validateManifestAssetCandidate(asset)
    const signalCodes = result.report.bundle.signals.map((signal) => signal.code)

    expect(result.report.valid).toBe(false)
    expect(signalCodes).toContain('mechanical_guided_part_missing')
    expect(signalCodes).toContain('mechanical_rotary_part_missing')
  })

  it('requires wrapped connector-style paths to prove support contacts', () => {
    const asset = createBeltDriveFixtureAsset()
    const cablePart = asset.parts.find((part) => part.id === 'timing-belt')

    expect(cablePart).toBeDefined()
    asset.prompt =
      'A CAD-like wrapped cable drive with a cable wound around two pulleys.'
    cablePart!.id = 'drive-cable'
    cablePart!.name = 'Drive cable'
    cablePart!.visuals[0] = {
      geometry: {
        end: {
          partId: 'right-pulley',
          position: [0, 0.04, 0],
        },
        radius: 0.012,
        sag: 0.01,
        start: {
          partId: 'left-pulley',
          position: [0, 0.04, 0],
        },
        type: 'connectorTube',
      },
      id: 'drive-cable-span',
      materialId: 'mat-belt',
      name: 'Drive cable span',
      transform: {},
    }
    asset.joints = asset.joints.map((joint) =>
      joint.childPartId === 'timing-belt'
        ? {
            ...joint,
            childPartId: 'drive-cable',
          }
        : joint,
    )
    asset.checks = []

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_path_contacts_missing',
          kind: 'mechanical_relation_coverage',
          refs: expect.objectContaining({
            currentContacts: '0',
            partId: 'drive-cable',
          }),
          stage: 'structure',
        }),
      ]),
    )
  })

  it('requires wrapped path contacts to target requested rotary supports', () => {
    const asset = createBeltDriveFixtureAsset()

    asset.parts.push({
      id: 'belt-guard',
      name: 'Belt guard support',
      role: 'support',
      visuals: [
        {
          geometry: {
            size: [0.7, 0.03, 0.04],
            type: 'box',
          },
          id: 'belt-guard-rail',
          materialId: 'mat-steel',
          name: 'Guard rail',
          transform: {
            position: [0, 0.32, 0],
          },
        },
      ],
    })
    asset.joints.push({
      childPartId: 'belt-guard',
      id: 'belt-guard-mount',
      name: 'Belt guard mount',
      origin: {},
      parentPartId: 'drive-base',
      type: 'fixed',
    })
    asset.checks = asset.checks.map((check) =>
      check.type === 'expect_path_contacts'
        ? {
            ...check,
            targets: [
              {
                partId: 'drive-base',
                visualId: 'drive-base-plate',
              },
              {
                partId: 'belt-guard',
                visualId: 'belt-guard-rail',
              },
            ],
          }
        : check,
    )

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_path_rotary_contacts_missing',
          kind: 'mechanical_relation_coverage',
          refs: expect.objectContaining({
            currentRotaryContacts: '0',
            partId: 'timing-belt',
            requiredRotaryContacts: '2',
          }),
          stage: 'structure',
        }),
      ]),
    )
  })

  it('requires rod and linkage checks to target guided and rotary endpoints when both are requested', () => {
    const asset = createBeltDriveFixtureAsset()

    asset.name = 'Piston Pump Linkage'
    asset.prompt =
      'A CAD-like piston pump with a piston connected by a connecting rod to a crankshaft.'
    asset.parts.push(
      {
        id: 'piston-1',
        name: 'Piston',
        role: 'mechanism',
        visuals: [
          {
            geometry: {
              size: [0.08, 0.08, 0.08],
              type: 'box',
            },
            id: 'piston-1-body',
            materialId: 'mat-steel',
            name: 'Piston body',
            transform: {
              position: [-0.14, 0.35, 0],
            },
          },
        ],
      },
      {
        id: 'crankshaft',
        name: 'Crankshaft',
        role: 'mechanism',
        visuals: [
          {
            geometry: {
              height: 0.34,
              radiusBottom: 0.025,
              radiusTop: 0.025,
              radialSegments: 16,
              type: 'cylinder',
            },
            id: 'crankshaft-journal',
            materialId: 'mat-steel',
            name: 'Crankshaft journal',
            transform: {
              position: [0.16, 0.2, 0],
              rotation: [Math.PI / 2, 0, 0],
            },
          },
        ],
      },
      {
        id: 'connecting-rod',
        name: 'Connecting rod',
        role: 'mechanism',
        visuals: [
          {
            geometry: {
              size: [0.28, 0.025, 0.025],
              type: 'box',
            },
            id: 'connecting-rod-bar',
            materialId: 'mat-steel',
            name: 'Rod bar',
            transform: {
              position: [0, 0.28, 0],
            },
          },
        ],
      },
      {
        id: 'rod-support',
        name: 'Rod support pad',
        role: 'support',
        visuals: [
          {
            geometry: {
              size: [0.08, 0.04, 0.04],
              type: 'box',
            },
            id: 'rod-support-pad',
            materialId: 'mat-steel',
            name: 'Support pad',
            transform: {
              position: [0.18, 0.28, 0],
            },
          },
        ],
      },
    )
    asset.joints.push(
      {
        childPartId: 'piston-1',
        id: 'piston-1-mount',
        name: 'Piston mount',
        origin: {},
        parentPartId: 'drive-base',
        type: 'fixed',
      },
      {
        childPartId: 'crankshaft',
        id: 'crankshaft-mount',
        name: 'Crankshaft mount',
        origin: {},
        parentPartId: 'drive-base',
        type: 'fixed',
      },
      {
        childPartId: 'connecting-rod',
        id: 'connecting-rod-mount',
        name: 'Connecting rod mount',
        origin: {},
        parentPartId: 'drive-base',
        type: 'fixed',
      },
      {
        childPartId: 'rod-support',
        id: 'rod-support-mount',
        name: 'Rod support mount',
        origin: {},
        parentPartId: 'drive-base',
        type: 'fixed',
      },
    )
    asset.checks.push(
      {
        partAId: 'connecting-rod',
        partBId: 'piston-1',
        type: 'expect_contact',
        visualAId: 'connecting-rod-bar',
        visualBId: 'piston-1-body',
      },
      {
        partAId: 'connecting-rod',
        partBId: 'rod-support',
        type: 'expect_contact',
        visualAId: 'connecting-rod-bar',
        visualBId: 'rod-support-pad',
      },
    )

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_coupler_endpoint_targets_missing',
          kind: 'mechanical_relation_coverage',
          refs: expect.objectContaining({
            hasGuidedEndpoint: 'true',
            hasRotaryEndpoint: 'false',
            partId: 'connecting-rod',
          }),
          stage: 'structure',
        }),
      ]),
    )
  })

  it('requires guided movers to prove a constraining guide or housing target', () => {
    const asset = createBeltDriveFixtureAsset()

    asset.name = 'Piston Guide Study'
    asset.prompt =
      'A CAD-like piston sliding in a cylinder with the piston visibly constrained.'
    asset.parts.push(
      {
        id: 'piston-1',
        name: 'Piston',
        role: 'mechanism',
        visuals: [
          {
            geometry: {
              size: [0.08, 0.08, 0.08],
              type: 'box',
            },
            id: 'piston-1-body',
            materialId: 'mat-steel',
            name: 'Piston body',
            transform: {
              position: [0, 0.35, 0],
            },
          },
        ],
      },
      {
        id: 'loose-pin',
        name: 'Loose mechanism pin',
        role: 'mechanism',
        visuals: [
          {
            geometry: {
              height: 0.12,
              radiusBottom: 0.012,
              radiusTop: 0.012,
              radialSegments: 12,
              type: 'cylinder',
            },
            id: 'loose-pin-body',
            materialId: 'mat-steel',
            name: 'Loose pin',
            transform: {
              position: [0, 0.28, 0],
              rotation: [Math.PI / 2, 0, 0],
            },
          },
        ],
      },
    )
    asset.joints.push(
      {
        childPartId: 'piston-1',
        id: 'piston-1-mount',
        name: 'Piston mount',
        origin: {},
        parentPartId: 'drive-base',
        type: 'fixed',
      },
      {
        childPartId: 'loose-pin',
        id: 'loose-pin-mount',
        name: 'Loose pin mount',
        origin: {},
        parentPartId: 'drive-base',
        type: 'fixed',
      },
    )
    asset.checks.push({
      partAId: 'piston-1',
      partBId: 'loose-pin',
      type: 'expect_contact',
      visualAId: 'piston-1-body',
      visualBId: 'loose-pin-body',
    })

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_guided_interface_target_missing',
          kind: 'mechanical_relation_coverage',
          refs: {
            partId: 'piston-1',
          },
          stage: 'structure',
        }),
      ]),
    )
  })

  it('runs exact authored checks against material side choices', () => {
    const passingAsset = createValidValidationFixtureAsset()
    const failingAsset = createValidValidationFixtureAsset()

    passingAsset.materials[0] = {
      ...passingAsset.materials[0],
      side: 'double',
    }
    passingAsset.checks = [
      {
        side: 'double',
        type: 'expect_material_side',
        visualId: 'crate-base-shell',
      },
    ]
    failingAsset.checks = [
      {
        side: 'double',
        type: 'expect_material_side',
        visualId: 'crate-base-shell',
      },
    ]

    const passingResult = validateManifestAssetCandidate(passingAsset)
    const failingResult = validateManifestAssetCandidate(failingAsset)

    expect(passingResult.report.valid).toBe(true)
    expect(failingResult.report.valid).toBe(false)
    expect(failingResult.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'expect_material_side_failed',
          stage: 'checks',
        }),
      ]),
    )
  })

  it('requires authored material-side checks for open lathe surfaces', () => {
    const missingCheckAsset = createOpenLatheSurfaceAsset()
    const checkedAsset = createOpenLatheSurfaceAsset()

    checkedAsset.checks = [
      {
        side: 'double',
        type: 'expect_material_side',
        visualId: 'shade-open-shell',
      },
    ]

    const missingCheckResult = validateManifestAssetCandidate(missingCheckAsset)
    const checkedResult = validateManifestAssetCandidate(checkedAsset)

    expect(missingCheckResult.report.valid).toBe(false)
    expect(missingCheckResult.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'surface_side_missing_check',
          refs: expect.objectContaining({
            materialSide: 'double',
            visualId: 'shade-open-shell',
          }),
          stage: 'structure',
        }),
      ]),
    )
    expect(checkedResult.report.valid).toBe(true)
  })

  it('keeps downstream physical QC visible when material-side checks are missing', () => {
    const asset = createOpenLatheSurfaceAsset()

    asset.parts.push({
      id: 'shade-overlap-pin',
      name: 'Overlap pin',
      role: 'support',
      visuals: [
        {
          geometry: {
            size: [0.18, 0.18, 0.18],
            type: 'box',
          },
          id: 'shade-overlap-box',
          materialId: 'mat-shade',
          name: 'Overlap box',
          transform: {
            position: [0.28, 0.18, 0],
          },
        },
      ],
    })
    asset.joints = [
      {
        childPartId: 'shade-overlap-pin',
        id: 'shade-overlap-fixed',
        name: 'Overlap fixed mount',
        origin: {
          position: [0, 0, 0],
        },
        parentPartId: 'shade-body',
        type: 'fixed',
      },
    ]

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'surface_side_missing_check',
          stage: 'structure',
        }),
        expect.objectContaining({
          code: 'part_overlap_current_pose',
          stage: 'baseline_qc',
        }),
      ]),
    )
    expect(
      result.report.steps.find((step) => step.stage === 'build')?.status,
    ).not.toBe('skipped')
    expect(
      result.report.steps.find((step) => step.stage === 'baseline_qc')?.status,
    ).toBe('failed')
  })

  it('keeps downstream physical QC visible when mechanical relation coverage is missing', () => {
    const asset = createBeltDriveFixtureAsset()
    const leftPulley = asset.parts.find((part) => part.id === 'left-pulley')

    asset.checks = []
    leftPulley!.visuals[0].transform = {
      position: [0, 0.1, 0],
    }

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_path_contacts_missing',
          stage: 'structure',
        }),
        expect.objectContaining({
          code: 'part_overlap_current_pose',
          stage: 'baseline_qc',
        }),
      ]),
    )
    expect(
      result.report.steps.find((step) => step.stage === 'build')?.status,
    ).not.toBe('skipped')
    expect(
      result.report.steps.find((step) => step.stage === 'baseline_qc')?.status,
    ).toBe('failed')
  })

  it('fails current-pose overlaps unless they are explicitly allowed', () => {
    const overlapResult = validateManifestAssetCandidate(
      createOverlappingValidationFixtureAsset(),
    )
    const allowedResult = validateManifestAssetCandidate(
      createAllowedOverlapValidationFixtureAsset(),
    )

    expect(overlapResult.report.valid).toBe(false)
    expect(overlapResult.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'part_overlap_current_pose',
          stage: 'baseline_qc',
        }),
      ]),
    )
    expect(allowedResult.report.valid).toBe(true)
    expect(allowedResult.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'part_overlap_allowed',
          severity: 'note',
        }),
      ]),
    )
  })

  it('accepts exact bounded fit checks as proof for current-pose visual overlap', () => {
    const asset = createOverlappingValidationFixtureAsset()

    asset.checks = asset.checks.map((check) =>
      check.type === 'expect_contact'
        ? {
            ...check,
            maxPenetration: 0.08,
          }
        : check,
    )

    const result = validateManifestAssetCandidate(asset)
    const signalCodes = result.report.bundle.signals.map((signal) => signal.code)

    expect(result.report.valid).toBe(true)
    expect(signalCodes).toContain('part_overlap_proven_fit')
    expect(signalCodes).not.toContain('part_overlap_current_pose')
  })

  it('accepts exact bounded containment checks as proof for current-pose visual overlap', () => {
    const asset = createContainedOverlapValidationFixtureAsset()
    const result = validateManifestAssetCandidate(asset)
    const overlapProofSignals = result.report.bundle.signals.filter(
      (signal) => signal.code === 'part_overlap_proven_fit',
    )
    const signalCodes = result.report.bundle.signals.map((signal) => signal.code)

    expect(result.report.valid).toBe(true)
    expect(overlapProofSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: expect.stringContaining('proofCheck=expect_within'),
        }),
      ]),
    )
    expect(signalCodes).not.toContain('part_overlap_current_pose')
  })

  it('does not let expect_contact hide deep penetration unless it is explicitly bounded', () => {
    const asset = createOverlappingValidationFixtureAsset()

    asset.allowances = [
      {
        partAId: 'crate-base',
        partBId: 'crate-lid',
        reason: 'The lid is intentionally seated into the gasket.',
        type: 'allow_overlap',
        visualAId: 'crate-base-shell',
        visualBId: 'crate-lid-panel',
      },
    ]

    const unboundedResult = validateManifestAssetCandidate(asset)

    asset.checks = asset.checks.map((check) =>
      check.type === 'expect_contact'
        ? {
            ...check,
            maxPenetration: 0.08,
          }
        : check,
    )

    const boundedResult = validateManifestAssetCandidate(asset)

    expect(unboundedResult.report.valid).toBe(false)
    expect(unboundedResult.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'expect_contact_failed',
          stage: 'checks',
        }),
      ]),
    )
    expect(boundedResult.report.valid).toBe(true)
  })

  it('warns when authored relation checks are broad on multi-visual parts', () => {
    const asset = createValidValidationFixtureAsset()

    asset.parts[0].visuals.push({
      geometry: {
        size: [0.2, 0.04, 0.12],
        type: 'box',
      },
      id: 'crate-base-front-lip',
      materialId: 'mat-violet',
      name: 'Base front lip',
      transform: {
        position: [0, 0.17, 0],
      },
    })
    asset.checks.push({
      partAId: 'crate-base',
      partBId: 'crate-lid',
      type: 'expect_contact',
    })

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(true)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'authored_relation_check_broad_scope',
          severity: 'warning',
          stage: 'structure',
        }),
      ]),
    )
  })

  it('rejects isolation allowances for mechanical support parts', () => {
    const asset = createValidValidationFixtureAsset()

    asset.joints[0] = {
      ...asset.joints[0],
      origin: {
        position: [4, 0.34, 0],
      },
    }
    asset.allowances = [
      {
        partId: 'crate-lid',
        reason: 'This lid should not be allowed to float.',
        type: 'allow_isolated_part',
      },
    ]

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'isolated_part_allowance_rejected',
          refs: {
            partId: 'crate-lid',
          },
        }),
      ]),
    )
  })

  it('adds failed-pair relation measurements to the probe report', () => {
    const result = validateManifestAssetCandidate(
      createOverlappingValidationFixtureAsset(),
    )

    expect(result.probeReport?.relations[0]).toMatchObject({
      closestVisualPair: 'crate-base-shell<->crate-lid-panel',
      partAId: 'crate-base',
      partBId: 'crate-lid',
      signalCode: 'part_overlap_current_pose',
      signalStage: 'baseline_qc',
    })
    expect(result.probeReport?.relations[0]?.penetrationDepth).toBeGreaterThan(0)
  })

  it('rejects allowances that reference missing or mismatched ids', () => {
    const asset = createValidValidationFixtureAsset()

    asset.allowances = [
      {
        partAId: 'crate-base',
        partBId: 'missing-lid',
        reason: 'This allowance intentionally references a missing part.',
        type: 'allow_overlap',
        visualAId: 'crate-lid-panel',
        visualBId: 'missing-visual',
      },
      {
        partId: 'missing-fastener',
        reason: 'This isolation allowance intentionally references a missing part.',
        type: 'allow_isolated_part',
      },
    ]

    const result = validateManifestAssetCandidate(asset)
    const signalCodes = result.report.bundle.signals.map((signal) => signal.code)

    expect(result.report.valid).toBe(false)
    expect(signalCodes).toContain('allowance_missing_part')
    expect(signalCodes).toContain('allowance_missing_visual')
    expect(signalCodes).toContain('allowance_visual_wrong_part')
    expect(
      result.report.steps.find((step) => step.stage === 'build')?.status,
    ).toBe('skipped')
  })

  it('rejects overlap allowances without matching authored proof checks', () => {
    const asset = createOverlappingValidationFixtureAsset()

    asset.allowances = [
      {
        partAId: 'crate-base',
        partBId: 'crate-lid',
        reason: 'The lid is intentionally seated into the gasket.',
        type: 'allow_overlap',
        visualAId: 'crate-base-shell',
        visualBId: 'crate-lid-panel',
      },
    ]
    asset.checks = asset.checks.filter(
      (check) => check.type === 'part_exists' || check.type === 'joint_exists',
    )

    const result = validateManifestAssetCandidate(asset)
    const signalCodes = result.report.bundle.signals.map((signal) => signal.code)

    expect(result.report.valid).toBe(false)
    expect(signalCodes).toContain('allowance_overlap_missing_proof_check')
    expect(
      result.report.steps.find((step) => step.stage === 'build')?.status,
    ).toBe('skipped')
  })

  it('warns when an overlap allowance is not scoped to exact visuals', () => {
    const asset = createAllowedOverlapValidationFixtureAsset()

    asset.allowances = [
      {
        partAId: 'crate-base',
        partBId: 'crate-lid',
        reason: 'The lid is intentionally seated slightly into the soft gasket represented by the base proxy.',
        type: 'allow_overlap',
      },
    ]

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(true)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'allowance_overlap_broad_scope',
          severity: 'warning',
          stage: 'structure',
        }),
      ]),
    )
    expect(result.report.bundle.signals).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'allowance_overlap_missing_proof_check',
        }),
      ]),
    )
  })

  it('rejects controls that reference missing, fixed, or duplicated joints', () => {
    const asset = createValidValidationFixtureAsset()

    asset.joints.push({
      childPartId: 'crate-lid',
      id: 'crate-lid-fixed-helper',
      name: 'Fixed helper',
      origin: {},
      parentPartId: 'crate-base',
      type: 'fixed',
    })
    asset.controls = [
      {
        id: 'bad-control',
        name: 'Bad control',
        joints: [
          { jointId: 'missing-joint', offset: 0, scale: 1 },
          { jointId: 'crate-lid-fixed-helper', offset: 0, scale: 1 },
          { jointId: 'crate-lid-hinge', offset: 0, scale: 1 },
          { jointId: 'crate-lid-hinge', offset: 0, scale: 1 },
        ],
        limits: { lower: 1, upper: 0 },
      },
    ]

    const result = validateManifestAssetCandidate(asset)
    const signalCodes = result.report.bundle.signals.map((signal) => signal.code)

    expect(result.report.valid).toBe(false)
    expect(signalCodes).toContain('control_limits_order')
    expect(signalCodes).toContain('control_missing_joint')
    expect(signalCodes).toContain('control_fixed_joint')
    expect(signalCodes).toContain('control_duplicate_joint')
  })

  it('rejects malformed material emission animations', () => {
    const asset = createValidValidationFixtureAsset()

    asset.materials[0] = {
      ...asset.materials[0],
      emission: {
        color: '#ff0000',
        hasEmission: true,
        intensity: 2,
      },
      emissionAnimation: {
        id: 'bad-emission',
        interpolation: 'linear',
        keyframes: [
          {
            color: '#ff0000',
            hasEmission: true,
            intensity: 2,
            time: 0.4,
          },
          {
            color: '#ff0000',
            hasEmission: true,
            intensity: 2,
            time: 0.2,
          },
        ],
        loop: true,
        name: 'Bad emission',
      },
    }
    asset.materials[1] = {
      ...asset.materials[1],
      emission: null,
      emissionAnimation: {
        id: 'bad-emission',
        interpolation: 'step',
        keyframes: [
          {
            color: '#0000ff',
            hasEmission: false,
            intensity: 0,
            time: 0,
          },
          {
            color: '#0000ff',
            hasEmission: false,
            intensity: 0,
            time: 0.5,
          },
        ],
        loop: true,
        name: 'Duplicate bad emission',
      },
    }

    const result = validateManifestAssetCandidate(asset)
    const signalCodes = result.report.bundle.signals.map((signal) => signal.code)

    expect(result.report.valid).toBe(false)
    expect(signalCodes).toContain('duplicate_material_animation_id')
    expect(signalCodes).toContain('material_emission_animation_start_time')
    expect(signalCodes).toContain('material_emission_keyframe_time_order')
    expect(signalCodes).toContain('material_emission_animation_static')
  })

  it('requires manifest controls for multi-joint articulated assets', () => {
    const asset = createValidValidationFixtureAsset()

    asset.parts.push({
      id: 'crate-latch',
      name: 'Latch',
      role: 'control',
      visuals: [
        {
          id: 'crate-latch-tab',
          geometry: {
            size: [0.12, 0.05, 0.02],
            type: 'box',
          },
          materialId: 'mat-white',
          transform: {
            position: [0, 0.03, 0],
          },
        },
      ],
    })
    asset.joints.push({
      axis: [1, 0, 0],
      childPartId: 'crate-latch',
      id: 'crate-latch-hinge',
      limits: {
        effort: 2,
        lower: -1,
        upper: 0,
        velocity: 2,
      },
      name: 'Latch Hinge',
      origin: {
        position: [0, 0.34, 0.28],
      },
      parentPartId: 'crate-base',
      type: 'revolute',
    })
    asset.controls = []

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'movable_joints_missing_controls',
          path: '/controls',
          stage: 'structure',
        }),
      ]),
    )
  })

  it('requires controls to cover every movable joint when controls are authored', () => {
    const asset = createValidValidationFixtureAsset()

    asset.parts.push({
      id: 'crate-latch',
      name: 'Latch',
      role: 'control',
      visuals: [
        {
          id: 'crate-latch-tab',
          geometry: {
            radius: 0.02,
            height: 0.12,
            type: 'capsule',
          },
          materialId: 'mat-white',
          transform: {
            position: [0, 0.03, 0],
            rotation: [0, 0, Math.PI / 2],
          },
        },
      ],
    })
    asset.joints.push({
      axis: [1, 0, 0],
      childPartId: 'crate-latch',
      id: 'crate-latch-hinge',
      limits: {
        effort: 2,
        lower: -1,
        upper: 0,
        velocity: 2,
      },
      name: 'Latch Hinge',
      origin: {
        position: [0, 0.34, 0.28],
      },
      parentPartId: 'crate-base',
      type: 'revolute',
    })

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'movable_joint_missing_control',
          refs: {
            jointIds: 'crate-latch-hinge',
          },
          stage: 'structure',
        }),
      ]),
    )
  })

  it('requires linked mechanical prompts to group coupled movable joints in one control', () => {
    const asset = createValidValidationFixtureAsset()

    asset.prompt =
      'A mechanical linkage with a lid and latch moving together through coupled motion.'
    asset.parts.push({
      id: 'crate-latch',
      name: 'Latch',
      role: 'control',
      visuals: [
        {
          id: 'crate-latch-tab',
          geometry: {
            radius: 0.02,
            height: 0.12,
            type: 'capsule',
          },
          materialId: 'mat-white',
          transform: {
            position: [0, 0.03, 0],
            rotation: [0, 0, Math.PI / 2],
          },
        },
      ],
    })
    asset.joints.push({
      axis: [1, 0, 0],
      childPartId: 'crate-latch',
      id: 'crate-latch-hinge',
      limits: {
        effort: 2,
        lower: -1,
        upper: 0,
        velocity: 2,
      },
      name: 'Latch Hinge',
      origin: {
        position: [0, 0.34, 0.28],
      },
      parentPartId: 'crate-base',
      type: 'revolute',
    })
    asset.controls.push({
      id: 'crate-latch-control',
      name: 'Latch',
      joints: [{ jointId: 'crate-latch-hinge', offset: 0, scale: 1 }],
      limits: { lower: -1, upper: 0 },
    })

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_linked_control_missing',
          kind: 'mechanical_relation_coverage',
          path: '/controls',
          refs: {
            movableJointCount: '2',
          },
          stage: 'structure',
        }),
      ]),
    )
  })

  it('rejects controls whose limits do not produce joint motion', () => {
    const asset = createValidValidationFixtureAsset()

    asset.joints[0] = {
      ...asset.joints[0],
      limits: {
        effort: 10,
        lower: 0,
        upper: 1.9,
        velocity: 2,
      },
    }

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'control_no_effective_motion',
          path: '/controls/0/limits',
          refs: {
            controlId: 'crate-lid-control',
          },
          stage: 'structure',
        }),
      ]),
    )
  })

  it('flags physically disconnected part groups', () => {
    const asset = createValidValidationFixtureAsset()

    asset.joints[0] = {
      ...asset.joints[0],
      origin: {
        position: [4, 0.34, 0],
      },
    }

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'part_physically_disconnected',
          refs: expect.objectContaining({
            partId: 'crate-lid',
          }),
        }),
      ]),
    )
  })

  it('warns when a joint origin is close to only one connected part', () => {
    const asset = createValidValidationFixtureAsset()

    asset.parts[1].visuals[0] = {
      ...asset.parts[1].visuals[0],
      transform: {
        position: [0, 0.04, 0.7],
      },
    }

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'joint_origin_far_from_geometry',
          severity: 'warning',
        }),
      ]),
    )
  })

  it('runs pose-specific authored checks in the sampled-pose stage', () => {
    const passingAsset = createValidValidationFixtureAsset()
    const failingAsset = createValidValidationFixtureAsset()
    const poseCheck = {
      axis: 'y' as const,
      maxGap: 0.6,
      minGap: -0.05,
      negativePartId: 'crate-base',
      negativeVisualId: 'crate-base-shell',
      pose: {
        joints: [
          {
            jointId: 'crate-lid-hinge',
            value: -1.9,
          },
        ],
        name: 'lid-open',
      },
      positivePartId: 'crate-lid',
      positiveVisualId: 'crate-lid-panel',
      type: 'expect_gap' as const,
    }

    passingAsset.checks = [...passingAsset.checks, poseCheck]
    failingAsset.checks = [
      ...failingAsset.checks,
      {
        ...poseCheck,
        minGap: 0.1,
      },
    ]

    const passingResult = validateManifestAssetCandidate(passingAsset)
    const failingResult = validateManifestAssetCandidate(failingAsset)

    expect(passingResult.report.valid).toBe(true)
    expect(failingResult.report.valid).toBe(false)
    expect(failingResult.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'expect_gap_failed',
          stage: 'sampled_poses',
        }),
      ]),
    )
  })

  it('flags generated sampled-pose overlaps separately from rest-pose overlaps', () => {
    const asset = createValidValidationFixtureAsset()

    asset.joints[0] = {
      ...asset.joints[0],
      limits: {
        effort: 10,
        lower: 0,
        upper: 1.9,
        velocity: 2,
      },
    }
    asset.controls[0] = {
      ...asset.controls[0],
      limits: {
        lower: 0,
        upper: 1.9,
      },
    }

    const result = validateManifestAssetCandidate(asset)

    expect(result.report.valid).toBe(false)
    expect(result.report.bundle.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'part_overlap_sampled_pose',
          stage: 'sampled_poses',
        }),
      ]),
    )
    expect(
      result.report.bundle.signals.some(
        (signal) => signal.code === 'part_overlap_current_pose',
      ),
    ).toBe(false)
    expect(
      result.probeReport?.relations.find(
        (relation) =>
          relation.signalCode === 'part_overlap_sampled_pose' &&
          relation.signalStage === 'sampled_poses',
      )?.penetrationDepth,
    ).toBeGreaterThan(0)
  })

  it('does not duplicate static rest-pose overlaps in sampled-pose validation', () => {
    const asset = createValidValidationFixtureAsset()

    asset.parts.push({
      id: 'fixed-obstruction',
      name: 'Fixed Obstruction',
      role: 'support',
      visuals: [
        {
          geometry: {
            size: [0.14, 0.14, 0.14],
            type: 'box',
          },
          id: 'fixed-obstruction-block',
          materialId: 'mat-white',
          name: 'Fixed Obstruction Block',
          transform: {
            position: [0, 0.17, 0],
          },
        },
      ],
    })
    asset.joints.push({
      childPartId: 'fixed-obstruction',
      id: 'fixed-obstruction-mount',
      name: 'Fixed Obstruction Mount',
      origin: {},
      parentPartId: 'crate-base',
      type: 'fixed',
    })

    const result = validateManifestAssetCandidate(asset)
    const staticOverlapSignals = result.report.bundle.signals.filter(
      (signal) =>
        signal.refs?.partAId === 'fixed-obstruction' ||
        signal.refs?.partBId === 'fixed-obstruction',
    )

    expect(result.report.valid).toBe(false)
    expect(staticOverlapSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'part_overlap_current_pose',
          stage: 'baseline_qc',
        }),
      ]),
    )
    expect(staticOverlapSignals).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'part_overlap_sampled_pose',
          stage: 'sampled_poses',
        }),
      ]),
    )
  })
})

function createBeltDriveFixtureAsset(): ManifestAsset {
  return {
    schemaVersion: 2,
    id: 'generic-belt-drive',
    name: 'Generic Belt Drive',
    prompt: 'A CAD-like belt drive with a taut belt riding on two pulleys.',
    units: 'meters',
    parts: [
      {
        id: 'drive-base',
        name: 'Drive base',
        role: 'base',
        visuals: [
          {
            geometry: {
              size: [0.9, 0.2, 0.22],
              type: 'box',
            },
            id: 'drive-base-plate',
            materialId: 'mat-steel',
            name: 'Base plate',
            transform: {
              position: [0, 0.1, 0],
            },
          },
        ],
      },
      {
        id: 'left-pulley',
        name: 'Left pulley',
        role: 'wheel',
        visuals: [
          {
            geometry: {
              size: [0.08, 0.1, 0.1],
              type: 'box',
            },
            id: 'left-pulley-block',
            materialId: 'mat-steel',
            name: 'Left pulley block',
            transform: {
              position: [-0.34, 0.25, 0],
            },
          },
        ],
      },
      {
        id: 'right-pulley',
        name: 'Right pulley',
        role: 'wheel',
        visuals: [
          {
            geometry: {
              size: [0.08, 0.1, 0.1],
              type: 'box',
            },
            id: 'right-pulley-block',
            materialId: 'mat-steel',
            name: 'Right pulley block',
            transform: {
              position: [0.34, 0.25, 0],
            },
          },
        ],
      },
      {
        id: 'timing-belt',
        name: 'Timing belt',
        role: 'mechanism',
        visuals: [
          {
            geometry: {
              size: [0.6, 0.04, 0.04],
              type: 'box',
            },
            id: 'timing-belt-run',
            materialId: 'mat-belt',
            name: 'Taut belt run',
            transform: {
              position: [0, 0.25, 0],
            },
          },
        ],
      },
    ],
    joints: [
      {
        childPartId: 'left-pulley',
        id: 'left-pulley-mount',
        name: 'Left pulley mount',
        origin: {},
        parentPartId: 'drive-base',
        type: 'fixed',
      },
      {
        childPartId: 'right-pulley',
        id: 'right-pulley-mount',
        name: 'Right pulley mount',
        origin: {},
        parentPartId: 'drive-base',
        type: 'fixed',
      },
      {
        childPartId: 'timing-belt',
        id: 'timing-belt-mount',
        name: 'Timing belt mount',
        origin: {},
        parentPartId: 'drive-base',
        type: 'fixed',
      },
    ],
    controls: [],
    materials: [
      {
        color: '#8a8d86',
        id: 'mat-steel',
        metalness: 0.6,
        name: 'Brushed steel',
        roughness: 0.32,
      },
      {
        color: '#171717',
        id: 'mat-belt',
        metalness: 0,
        name: 'Rubber belt',
        roughness: 0.72,
      },
    ],
    checks: [
      {
        contactTolerance: 0.004,
        maxPenetration: 0.004,
        minContacts: 2,
        pathPartId: 'timing-belt',
        pathVisualId: 'timing-belt-run',
        targets: [
          {
            partId: 'left-pulley',
            visualId: 'left-pulley-block',
          },
          {
            partId: 'right-pulley',
            visualId: 'right-pulley-block',
          },
        ],
        type: 'expect_path_contacts',
      },
    ],
    allowances: [],
    metadata: {
      createdAt: '2026-06-03T00:00:00.000Z',
      generationStatus: 'ready',
      sourceImageIds: [],
      updatedAt: '2026-06-03T00:00:00.000Z',
    },
  }
}

function createContainedOverlapValidationFixtureAsset(): ManifestAsset {
  const asset = createValidValidationFixtureAsset()

  return {
    ...asset,
    checks: [
      {
        innerPartId: 'guided-slider',
        innerVisualId: 'slider-block',
        axes: 'xyz',
        maxPenetration: 0.22,
        outerPartId: 'guide-housing',
        outerVisualId: 'guide-cavity-proxy',
        type: 'expect_within',
      },
    ],
    controls: [],
    id: 'contained-overlap-validation-fixture',
    joints: [
      {
        childPartId: 'guided-slider',
        id: 'slider-fixed-in-guide',
        name: 'Slider fixed in guide',
        origin: {},
        parentPartId: 'guide-housing',
        type: 'fixed',
      },
    ],
    name: 'Contained Overlap Validation Fixture',
    parts: [
      {
        id: 'guide-housing',
        name: 'Guide housing',
        role: 'base',
        visuals: [
          {
            geometry: {
              size: [0.4, 0.4, 0.4],
              type: 'box',
            },
            id: 'guide-cavity-proxy',
            materialId: 'mat-violet',
            name: 'Guide cavity proxy',
            transform: {
              position: [0, 0, 0],
            },
          },
        ],
      },
      {
        id: 'guided-slider',
        name: 'Guided slider',
        role: 'mechanism',
        visuals: [
          {
            geometry: {
              size: [0.2, 0.2, 0.2],
              type: 'box',
            },
            id: 'slider-block',
            materialId: 'mat-white',
            name: 'Slider block',
            transform: {
              position: [0, 0, 0],
            },
          },
        ],
      },
    ],
    prompt: 'A compact fitted slider seated inside a guide housing.',
  }
}

function createOpenLatheSurfaceAsset(): ManifestAsset {
  const asset = createValidValidationFixtureAsset()

  return {
    ...asset,
    controls: [],
    checks: [],
    id: 'open-lathe-shade',
    joints: [],
    materials: [
      {
        color: '#f7f6ff',
        id: 'mat-shade',
        metalness: 0,
        name: 'Thin shade',
        roughness: 0.42,
        side: 'double' as const,
      },
    ],
    name: 'Open Lathe Shade',
    parts: [
      {
        id: 'shade-body',
        name: 'Shade body',
        role: 'housing' as const,
        visuals: [
          {
            geometry: {
              phiLength: Math.PI * 1.55,
              phiStart: 0,
              points: [
                [0.08, 0],
                [0.32, 0.14],
                [0.38, 0.34],
              ],
              segments: 32,
              type: 'lathe' as const,
            },
            id: 'shade-open-shell',
            materialId: 'mat-shade',
            name: 'Open shell',
            transform: {
              position: [0, 0, 0],
            },
          },
        ],
      },
    ],
  }
}

describe('commitValidatedAsset', () => {
  it('upserts only fresh valid candidates into the scene store', () => {
    const store = createSceneStore({
      assets: [],
      schemaVersion: 1,
      units: 'meters',
    })
    const validResult = commitValidatedAsset(
      store,
      createValidValidationFixtureAsset(),
    )
    const invalidResult = commitValidatedAsset(
      store,
      createInvalidValidationFixtureAsset(),
    )

    expect(validResult.committed).toBe(true)
    expect(validResult.report.steps.at(-1)).toMatchObject({
      stage: 'commit',
      status: 'passed',
    })
    expect(invalidResult.committed).toBe(false)
    expect(invalidResult.report.steps.at(-1)).toMatchObject({
      stage: 'commit',
      status: 'skipped',
    })
    expect(store.getSnapshot().scene.assets.map((asset) => asset.id)).toEqual([
      'validation-crate',
    ])
  })
})

describe('createValidationTimeline', () => {
  it('converts validation signal reports into deterministic timeline rows', () => {
    const result = validateManifestAssetCandidate(
      createInvalidValidationFixtureAsset(),
    )
    const timeline = createValidationTimeline(result.report)

    expect(timeline.map((item) => item.id)).toEqual([
      'validation:invalid-validation-crate:schema',
      'validation:invalid-validation-crate:structure',
      'validation:invalid-validation-crate:build',
      'validation:invalid-validation-crate:baseline_qc',
      'validation:invalid-validation-crate:checks',
      'validation:invalid-validation-crate:sampled_poses',
      'validation:invalid-validation-crate:export',
    ])
    expect(timeline[1]).toMatchObject({
      kind: 'validation_failure',
      label: 'Check asset structure',
      status: 'failed',
    })
    expect(timeline[1].detail).toBe(
      'The candidate reused an id that must be unique.',
    )
  })

  it('shows a fallback explanation when a failed step has no signal detail', () => {
    const baseReport = createValidationReport({
      asset: createValidValidationFixtureAsset(),
      signals: [],
      stages: ['baseline_qc'],
    })
    const timeline = createValidationTimeline({
      ...baseReport,
      steps: [
        {
          ...baseReport.steps[0],
          signalIds: [],
          status: 'failed',
        },
      ],
    })

    expect(timeline[0].detail).toBe(
      'This step found an issue the agent needs to fix. The generated geometry failed a physical quality check.',
    )
  })
})
