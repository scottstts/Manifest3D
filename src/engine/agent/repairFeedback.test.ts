import { describe, expect, it } from 'vitest'
import type { ValidationSignalBundle } from '../schema/validationTypes'
import { createValidationSignal } from '../validation/reportBuilder'
import { renderValidationSignals } from './repairFeedback'

describe('renderValidationSignals', () => {
  it('renders validation signal sections and repeated-failure state', () => {
    const bundle: ValidationSignalBundle = {
      signals: [
        createValidationSignal(
          'real_overlap',
          'part_overlap_current_pose',
          'Current-pose overlap detected.',
          {
            details: 'depth=0.02 volume=0.001',
            refs: {
              partAId: 'base',
              partBId: 'lid',
              visualAId: 'base-shell',
              visualBId: 'lid-panel',
            },
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
        createValidationSignal(
          'allowance',
          'allowance_declared',
          'Allowance declared: allow_overlap.',
          {
            details: 'Intentional gasket compression.',
            severity: 'note',
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
      ],
      status: 'failure',
      summary: 'status=failure failures=1 warnings=0 notes=1',
    }

    const rendered = renderValidationSignals(bundle, {
      failureStreak: 3,
      repeated: true,
    })

    expect(rendered).toContain('<validation_signals>')
    expect(rendered).toContain('<failures>')
    expect(rendered).toContain('<notes>')
    expect(rendered).toContain('This failure matches the previous validation attempt.')
    expect(rendered).toContain('This is validation failure 3 in a row.')
    expect(rendered).toContain('refs=partAId=base partBId=lid visualAId=base-shell visualBId=lid-panel')
    expect(rendered).toContain('scoped allowances')
  })

  it('prioritizes schema failures before geometry feedback', () => {
    const bundle: ValidationSignalBundle = {
      signals: [
        createValidationSignal(
          'real_overlap',
          'part_overlap_current_pose',
          'Overlap should be secondary.',
          {
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
        createValidationSignal(
          'schema_parse',
          'schema_invalid',
          'Expected required field.',
          {
            path: '/parts',
            source: 'schema',
            stage: 'schema',
          },
        ),
      ],
      status: 'failure',
      summary: 'status=failure failures=2 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle)

    expect(rendered.indexOf('schema_invalid')).toBeLessThan(
      rendered.indexOf('part_overlap_current_pose'),
    )
    expect(rendered).toContain('Fix the JSON shape first')
  })

  it('prioritizes joint tree failures before overlap repair rules', () => {
    const bundle: ValidationSignalBundle = {
      signals: [
        createValidationSignal(
          'real_overlap',
          'part_overlap_current_pose',
          'Overlap should wait.',
          {
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
        createValidationSignal(
          'single_root_policy',
          'root_part_count',
          'Asset must have exactly one root part.',
          {
            path: '/parts',
            stage: 'structure',
          },
        ),
      ],
      status: 'failure',
      summary: 'status=failure failures=2 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle)

    expect(rendered.indexOf('root_part_count')).toBeLessThan(
      rendered.indexOf('part_overlap_current_pose'),
    )
    expect(rendered).toContain('Keep the joint graph as the assembly source of truth')
  })

  it('renders targeted repair rules for rounded box radius failures', () => {
    const bundle: ValidationSignalBundle = {
      signals: [
        createValidationSignal(
          'model_validity',
          'rounded_box_radius_too_large',
          'Rounded box radius exceeds half the shortest size.',
          {
            path: '/parts/0/visuals/0/geometry/radius',
            stage: 'structure',
          },
        ),
      ],
      status: 'failure',
      summary: 'status=failure failures=1 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle)

    expect(rendered).toContain('radius must be less than or equal to half')
    expect(rendered).toContain('softened manufactured form')
  })

  it('renders targeted repair rules for allowance proof failures', () => {
    const bundle: ValidationSignalBundle = {
      signals: [
        createValidationSignal(
          'allowance',
          'allowance_overlap_missing_proof_check',
          'Overlap allowance needs a matching authored proof check.',
          {
            path: '/allowances/0',
            refs: {
              partAId: 'base',
              partBId: 'lid',
              visualAId: 'base-shell',
              visualBId: 'lid-panel',
            },
            stage: 'structure',
          },
        ),
      ],
      status: 'failure',
      summary: 'status=failure failures=1 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle)

    expect(rendered).toContain('matching authored proof check')
    expect(rendered).toContain('same visual pair')
  })

  it('compacts repeated failure groups while preserving representative refs', () => {
    const repeatedOverlapSignals = Array.from({ length: 40 }, (_, index) =>
      createValidationSignal(
        'sampled_pose_overlap',
        'part_overlap_sampled_pose',
        'Sampled-pose overlap detected between "front-axle" and "front-wheel-1".',
        {
          details: `depth=0.${index} pose=steer-left`,
          refs: {
            partAId: 'front-axle',
            partBId: 'front-wheel-1',
            visualAId: `axle-visual-${index}`,
            visualBId: `wheel-visual-${index}`,
          },
          source: 'baseline_qc',
          stage: 'sampled_poses',
        },
      ),
    )
    const bundle: ValidationSignalBundle = {
      signals: repeatedOverlapSignals,
      status: 'failure',
      summary: 'status=failure failures=40 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle)

    expect(rendered).toContain('visualAId=axle-visual-0')
    expect(rendered).toContain('visualAId=axle-visual-1')
    expect(rendered).not.toContain('visualAId=axle-visual-2')
    expect(rendered).toContain('Omitted 38 of 40 similar signals')
    expect(rendered).toContain(
      '[sampled_poses/part_overlap_sampled_pose] Sampled-pose overlap detected between "front-axle" and "front-wheel-1". x38',
    )
    expect(rendered).toContain('Repair the repeated pattern globally')
  })

  it('injects revision freshness guidance into repair feedback', () => {
    const bundle: ValidationSignalBundle = {
      signals: [
        createValidationSignal(
          'model_validity',
          'missing_material_reference',
          'Visual references a missing material.',
          { stage: 'structure' },
        ),
      ],
      status: 'failure',
      summary: 'status=failure failures=1 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle, {
      candidateFingerprint: 'fnv1a:test',
      revision: 2,
    })

    expect(rendered).toContain('<repair_context>')
    expect(rendered).toContain('candidateRevision=2')
    expect(rendered).toContain('candidateFingerprint=fnv1a:test')
    expect(rendered).toContain('requires fresh validation')
  })

  it('renders semantic clusters and probe context for mechanism repair', () => {
    const bundle: ValidationSignalBundle = {
      signals: [
        createValidationSignal(
          'sampled_pose_overlap',
          'part_overlap_sampled_pose',
          'Sampled-pose overlap detected between "chain" and "drawbridge".',
          {
            details: 'pose=lowered joints=bridge-hinge=-1.2000',
            refs: {
              partAId: 'chain',
              partBId: 'drawbridge',
            },
            source: 'baseline_qc',
            stage: 'sampled_poses',
          },
        ),
      ],
      status: 'failure',
      summary: 'status=failure failures=1 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle, {
      failureClusters: [
        {
          code: 'part_overlap_sampled_pose',
          count: 8,
          key: 'cluster',
          kind: 'sampled_pose_overlap',
          label:
            '[sampled_poses/part_overlap_sampled_pose] partPair=chain<->drawbridge',
          poseKey: 'joints:bridge-hinge=-1.2000',
          refs: {
            partPair: 'chain<->drawbridge',
          },
          source: 'baseline_qc',
          stage: 'sampled_poses',
        },
      ],
      failureStreak: 3,
      probeReport: {
        assetBounds: {
          center: [0, 0.5, 0],
          max: [1, 1, 1],
          min: [-1, 0, -1],
          size: [2, 1, 2],
        },
        assetId: 'gatehouse',
        assetName: 'Gatehouse',
        connectors: [
          {
            endPartId: 'drawbridge',
            endWorld: [0.5, 0.2, 0.1],
            id: 'chain-1',
            length: 1.25,
            ownerPartId: 'gatehouse',
            radius: 0.02,
            startPartId: 'tower',
            startWorld: [0.5, 1.2, 0.1],
          },
        ],
        joints: [
          {
            axis: [1, 0, 0],
            childDistanceToOrigin: 0.18,
            childPartId: 'drawbridge',
            id: 'bridge-hinge',
            originWorld: [0, 0.2, -0.5],
            parentDistanceToOrigin: 0.04,
            parentPartId: 'gatehouse',
            type: 'revolute',
          },
        ],
        parts: [],
      },
    })

    expect(rendered).toContain('<failure_clusters>')
    expect(rendered).toContain('partPair=chain<->drawbridge')
    expect(rendered).toContain('<probe_report>')
    expect(rendered).toContain('jointOriginDistances')
    expect(rendered).toContain('visual=chain-1')
    expect(rendered).toContain('pose-resolved endpoint geometry')
  })
})
