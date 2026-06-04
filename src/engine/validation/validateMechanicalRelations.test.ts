import { describe, expect, it } from 'vitest'
import type { ManifestAsset, ManifestCheck } from '../schema/manifestTypes'
import { validateMechanicalRelationCoverage } from './validateMechanicalRelations'

describe('validateMechanicalRelationCoverage', () => {
  it('requires guided movers in linked mechanical prompts to use prismatic guide joints', () => {
    const asset = createLinkedPumpFixture()

    asset.joints = asset.joints.map((joint) =>
      joint.id === 'piston-slide' ? { ...joint, type: 'fixed' } : joint,
    )
    asset.controls[0] = {
      ...asset.controls[0],
      joints: asset.controls[0].joints.filter(
        (binding) => binding.jointId !== 'piston-slide',
      ),
    }

    const signals = validateMechanicalRelationCoverage(asset)

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_guided_motion_joint_missing',
          refs: expect.objectContaining({
            partId: 'piston',
            requiredJointType: 'prismatic',
          }),
        }),
      ]),
    )
  })

  it('does not count a prismatic joint to a loose coupler as guided motion', () => {
    const asset = createLinkedPumpFixture()

    asset.joints = asset.joints.map((joint) =>
      joint.id === 'piston-slide'
        ? { ...joint, parentPartId: 'connecting-rod' }
        : joint,
    )

    const signals = validateMechanicalRelationCoverage(asset)

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_guided_motion_joint_missing',
          refs: expect.objectContaining({
            currentPrismaticJoints: 'piston-slide',
            partId: 'piston',
          }),
        }),
      ]),
    )
  })

  it('requires linked controls to drive guided linear and rotary joints together', () => {
    const asset = createLinkedPumpFixture()

    asset.joints.push({
      axis: [0, 0, 1],
      childPartId: 'idler-pulley',
      id: 'idler-pulley-spin',
      limits: { effort: 4, lower: -Math.PI, upper: Math.PI, velocity: 2 },
      name: 'Idler pulley spin',
      origin: {},
      parentPartId: 'pump-base',
      type: 'revolute',
    })
    asset.controls = [
      {
        id: 'rotary-cycle',
        joints: [
          { jointId: 'crank-spin', offset: 0, scale: Math.PI * 2 },
          { jointId: 'idler-pulley-spin', offset: 0, scale: Math.PI * 2 },
        ],
        limits: { lower: 0, upper: 1 },
        name: 'Rotary cycle',
      },
      {
        id: 'piston-stroke',
        joints: [{ jointId: 'piston-slide', offset: 0, scale: 0.12 }],
        limits: { lower: 0, upper: 1 },
        name: 'Piston stroke',
      },
    ]

    const signals = validateMechanicalRelationCoverage(asset)

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_guided_linked_control_missing',
          refs: expect.objectContaining({
            guidedJointIds: 'piston-slide',
          }),
        }),
      ]),
    )
  })

  it('requires linked controls even when no controls are authored', () => {
    const asset = createLinkedPumpFixture()

    asset.controls = []

    const signals = validateMechanicalRelationCoverage(asset)

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_linked_control_missing',
          refs: expect.objectContaining({
            movableJointCount: '3',
          }),
        }),
      ]),
    )
  })

  it('requires rotary movers in linked mechanical prompts to use rotary support joints', () => {
    const asset = createLinkedPumpFixture()

    asset.joints = asset.joints.map((joint) =>
      joint.id === 'crank-spin' ? { ...joint, type: 'fixed' } : joint,
    )
    asset.controls[0] = {
      ...asset.controls[0],
      joints: asset.controls[0].joints.filter(
        (binding) => binding.jointId !== 'crank-spin',
      ),
    }

    const signals = validateMechanicalRelationCoverage(asset)

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_rotary_motion_joint_missing',
          refs: expect.objectContaining({
            partId: 'crankshaft',
            requiredJointType: 'revolute_or_continuous',
          }),
        }),
      ]),
    )
  })

  it('requires pose-specific relation evidence for linked mechanical motion', () => {
    const asset = createLinkedPumpFixture()

    const signals = validateMechanicalRelationCoverage(asset)

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_coupler_pose_targets_missing',
          refs: expect.objectContaining({
            hasPoseGuidedEndpoint: 'false',
            hasPoseRotaryEndpoint: 'false',
            partId: 'connecting-rod',
          }),
        }),
        expect.objectContaining({
          code: 'mechanical_guided_pose_target_missing',
          refs: { partId: 'piston' },
        }),
        expect.objectContaining({
          code: 'mechanical_path_pose_contacts_missing',
          refs: expect.objectContaining({
            currentPoseRotaryContacts: '0',
            partId: 'timing-belt',
            requiredPoseRotaryContacts: '2',
          }),
        }),
      ]),
    )
  })

  it('requires rods and linkages in linked mechanisms to use a movable pivot joint', () => {
    const asset = createLinkedPumpFixture()

    asset.joints = asset.joints.map((joint) =>
      joint.id === 'rod-wrist-pivot' ? { ...joint, type: 'fixed' } : joint,
    )
    asset.controls[0] = {
      ...asset.controls[0],
      joints: asset.controls[0].joints.filter(
        (binding) => binding.jointId !== 'rod-wrist-pivot',
      ),
    }

    const signals = validateMechanicalRelationCoverage(asset)

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_coupler_motion_joint_missing',
          refs: expect.objectContaining({
            partId: 'connecting-rod',
            requiredMovableJoints: '1',
          }),
        }),
      ]),
    )
  })

  it('accepts pose-specific relation evidence for linked mechanical motion', () => {
    const asset = createLinkedPumpFixture()
    const drivenPose = {
      joints: [
        { jointId: 'piston-slide', value: 0.08 },
        { jointId: 'crank-spin', value: Math.PI / 2 },
        { jointId: 'rod-wrist-pivot', value: Math.PI / 6 },
      ],
      name: 'driven-pose',
    }

    asset.checks.push(
      withPose(createContactCheck('connecting-rod', 'rod-bar', 'piston', 'piston-face'), drivenPose),
      withPose(
        createContactCheck(
          'connecting-rod',
          'rod-bar',
          'crankshaft',
          'crank-journal',
        ),
        drivenPose,
      ),
      withPose(createContactCheck('piston', 'piston-face', 'cylinder', 'cylinder-liner'), drivenPose),
      withPose(
        {
          minContacts: 2,
          pathPartId: 'timing-belt',
          pathVisualId: 'belt-loop',
          targets: [
            { partId: 'drive-pulley', visualId: 'drive-pulley-wheel' },
            { partId: 'idler-pulley', visualId: 'idler-pulley-wheel' },
          ],
          type: 'expect_path_contacts',
        },
        drivenPose,
      ),
    )

    const codes = validateMechanicalRelationCoverage(asset).map(
      (signal) => signal.code,
    )

    expect(codes).not.toContain('mechanical_coupler_pose_targets_missing')
    expect(codes).not.toContain('mechanical_guided_pose_target_missing')
    expect(codes).not.toContain('mechanical_path_pose_contacts_missing')
    expect(codes).not.toContain('mechanical_guided_motion_joint_missing')
    expect(codes).not.toContain('mechanical_guided_linked_control_missing')
    expect(codes).not.toContain('mechanical_coupler_motion_joint_missing')
  })

  it('does not require passive valves to move when pistons are the requested reciprocating parts', () => {
    const asset = createLinkedPumpFixture()

    asset.prompt =
      'A cutaway engine with pistons reciprocating in cylinders, a crankshaft, and valves and springs aligned above the bores.'
    asset.parts.push(
      createPart('valve-guide', 'Valve guide', 'housing', 'valve-guide-bore'),
      createPart('valve-1', 'Valve 1', 'mechanism', 'valve-1-stem'),
    )
    asset.joints.push({
      childPartId: 'valve-1',
      id: 'valve-1-mount',
      name: 'Valve 1 fixed in guide',
      origin: {},
      parentPartId: 'valve-guide',
      type: 'fixed',
    })
    asset.checks.push(
      createContactCheck(
        'valve-1',
        'valve-1-stem',
        'valve-guide',
        'valve-guide-bore',
      ),
    )

    const valveSignals = validateMechanicalRelationCoverage(asset).filter(
      (signal) => signal.refs?.partId === 'valve-1',
    )

    expect(valveSignals.map((signal) => signal.code)).not.toContain(
      'mechanical_guided_motion_joint_missing',
    )
    expect(valveSignals.map((signal) => signal.code)).not.toContain(
      'mechanical_guided_pose_target_missing',
    )
  })

  it('requires valve guide motion when the prompt explicitly asks valves to open and close', () => {
    const asset = createLinkedPumpFixture()

    asset.prompt =
      'A cutaway engine with pistons reciprocating in cylinders, a crankshaft, and valves opening and closing in their guides.'
    asset.parts.push(
      createPart('valve-guide', 'Valve guide', 'housing', 'valve-guide-bore'),
      createPart('valve-1', 'Valve 1', 'mechanism', 'valve-1-stem'),
    )
    asset.joints.push({
      childPartId: 'valve-1',
      id: 'valve-1-mount',
      name: 'Valve 1 fixed in guide',
      origin: {},
      parentPartId: 'valve-guide',
      type: 'fixed',
    })
    asset.checks.push(
      createContactCheck(
        'valve-1',
        'valve-1-stem',
        'valve-guide',
        'valve-guide-bore',
      ),
    )

    const valveSignals = validateMechanicalRelationCoverage(asset).filter(
      (signal) => signal.refs?.partId === 'valve-1',
    )

    expect(valveSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_guided_motion_joint_missing',
        }),
      ]),
    )
  })

  it('rejects connectorTube-only visuals for rigid mechanical couplers', () => {
    const asset = createLinkedPumpFixture()
    const rod = asset.parts.find((part) => part.id === 'connecting-rod')

    expect(rod).toBeDefined()
    rod!.visuals = [
      {
        geometry: {
          end: { partId: 'crankshaft', position: [0, 0, 0] },
          radius: 0.01,
          start: { partId: 'piston', position: [0, 0, 0] },
          type: 'connectorTube',
        },
        id: 'rod-flexible-looking-tube',
        materialId: 'mat-steel',
        transform: { position: [0, 0, 0] },
      },
    ]

    const signals = validateMechanicalRelationCoverage(asset)

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'mechanical_coupler_rigid_visual_missing',
          refs: expect.objectContaining({
            connectorTubeVisualIds: 'rod-flexible-looking-tube',
            partId: 'connecting-rod',
          }),
        }),
      ]),
    )
  })
})

function createLinkedPumpFixture(): ManifestAsset {
  return {
    schemaVersion: 2,
    id: 'linked-pump',
    name: 'Linked Pump',
    prompt:
      'A CAD-like belt driven piston pump with a piston sliding in a cylinder, a connecting rod coupled to a crankshaft, and a timing belt wrapped around two pulleys.',
    units: 'meters',
    parts: [
      createPart('pump-base', 'Pump base', 'base', 'base-plate'),
      createPart('piston', 'Piston', 'mechanism', 'piston-face'),
      createPart('cylinder', 'Cylinder liner', 'housing', 'cylinder-liner'),
      createPart('connecting-rod', 'Connecting rod', 'mechanism', 'rod-bar'),
      createPart('crankshaft', 'Crankshaft', 'mechanism', 'crank-journal'),
      createPart('timing-belt', 'Timing belt', 'mechanism', 'belt-loop'),
      createPart('drive-pulley', 'Drive pulley', 'wheel', 'drive-pulley-wheel'),
      createPart('idler-pulley', 'Idler pulley', 'wheel', 'idler-pulley-wheel'),
    ],
    joints: [
      {
        axis: [0, 1, 0],
        childPartId: 'piston',
        id: 'piston-slide',
        limits: { effort: 4, lower: 0, upper: 0.12, velocity: 1 },
        name: 'Piston slide',
        origin: {},
        parentPartId: 'pump-base',
        type: 'prismatic',
      },
      {
        axis: [0, 0, 1],
        childPartId: 'crankshaft',
        id: 'crank-spin',
        limits: { effort: 4, lower: -Math.PI, upper: Math.PI, velocity: 2 },
        name: 'Crank spin',
        origin: {},
        parentPartId: 'pump-base',
        type: 'revolute',
      },
      {
        axis: [0, 0, 1],
        childPartId: 'connecting-rod',
        id: 'rod-wrist-pivot',
        limits: { effort: 4, lower: -Math.PI / 3, upper: Math.PI / 3, velocity: 2 },
        name: 'Rod wrist pin pivot',
        origin: {},
        parentPartId: 'piston',
        type: 'revolute',
      },
    ],
    controls: [
      {
        id: 'pump-cycle',
        joints: [
          { jointId: 'piston-slide', offset: 0, scale: 0.12 },
          { jointId: 'crank-spin', offset: 0, scale: Math.PI * 2 },
          { jointId: 'rod-wrist-pivot', offset: -Math.PI / 6, scale: Math.PI / 3 },
        ],
        limits: { lower: 0, upper: 1 },
        name: 'Pump cycle',
      },
    ],
    materials: [
      {
        color: '#777777',
        id: 'mat-steel',
        metalness: 0.5,
        name: 'Steel',
        roughness: 0.35,
      },
    ],
    checks: [
      createContactCheck('connecting-rod', 'rod-bar', 'piston', 'piston-face'),
      createContactCheck(
        'connecting-rod',
        'rod-bar',
        'crankshaft',
        'crank-journal',
      ),
      createContactCheck('piston', 'piston-face', 'cylinder', 'cylinder-liner'),
      {
        minContacts: 2,
        pathPartId: 'timing-belt',
        pathVisualId: 'belt-loop',
        targets: [
          { partId: 'drive-pulley', visualId: 'drive-pulley-wheel' },
          { partId: 'idler-pulley', visualId: 'idler-pulley-wheel' },
        ],
        type: 'expect_path_contacts',
      },
    ],
    allowances: [],
    metadata: {
      createdAt: '2026-06-04T00:00:00.000Z',
      generationStatus: 'ready',
      sourceImageIds: [],
      updatedAt: '2026-06-04T00:00:00.000Z',
    },
  }
}

function createPart(
  id: string,
  name: string,
  role: ManifestAsset['parts'][number]['role'],
  visualId: string,
): ManifestAsset['parts'][number] {
  return {
    id,
    name,
    role,
    visuals: [
      {
        geometry: {
          size: [0.1, 0.1, 0.1],
          type: 'box',
        },
        id: visualId,
        materialId: 'mat-steel',
        transform: { position: [0, 0, 0] },
      },
    ],
  }
}

function createContactCheck(
  partAId: string,
  visualAId: string,
  partBId: string,
  visualBId: string,
): Extract<ManifestCheck, { type: 'expect_contact' }> {
  return {
    partAId,
    partBId,
    type: 'expect_contact',
    visualAId,
    visualBId,
  }
}

function withPose<T extends ManifestCheck>(
  check: T,
  pose: NonNullable<ManifestCheck['pose']>,
): T {
  return {
    ...check,
    pose,
  }
}
