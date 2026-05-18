import { describe, expect, it } from 'vitest'
import {
  createAllowedOverlapValidationFixtureAsset,
  createInvalidValidationFixtureAsset,
  createOverlappingValidationFixtureAsset,
  createValidValidationFixtureAsset,
} from '../examples/validationFixtures'
import { createSceneStore } from '../scene/sceneStore'
import { createValidationTimeline } from '../agent/validationTimeline'
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
  })
})

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
