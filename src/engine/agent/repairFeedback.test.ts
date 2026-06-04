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

  it('prioritizes physical overlap before missing material-side checks', () => {
    const bundle: ValidationSignalBundle = {
      signals: [
        createValidationSignal(
          'authored_checks',
          'surface_side_missing_check',
          'Surface-sensitive visual "nacelle-cutaway-shell" needs an authored material-side check.',
          {
            refs: {
              materialSide: 'double',
              visualId: 'nacelle-cutaway-shell',
            },
            source: 'checks',
            stage: 'structure',
          },
        ),
        createValidationSignal(
          'real_overlap',
          'part_overlap_current_pose',
          'Current-pose overlap detected between "engine-frame" and "rotor-spool".',
          {
            refs: {
              partAId: 'engine-frame',
              partBId: 'rotor-spool',
            },
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
      ],
      status: 'failure',
      summary: 'status=failure failures=2 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle)

    expect(rendered.indexOf('part_overlap_current_pose')).toBeLessThan(
      rendered.indexOf('surface_side_missing_check'),
    )
    expect(rendered).toContain('Decide whether the current-pose overlap')
  })

  it('prioritizes physical overlap before mechanical relation coverage when both are present', () => {
    const bundle: ValidationSignalBundle = {
      signals: [
        createValidationSignal(
          'mechanical_relation_coverage',
          'mechanical_guided_pose_target_missing',
          'Guided mechanical part "piston-1" needs pose-specific guide evidence.',
          {
            refs: { partId: 'piston-1' },
            source: 'checks',
            stage: 'structure',
          },
        ),
        createValidationSignal(
          'real_overlap',
          'part_overlap_current_pose',
          'Current-pose overlap detected between "engine-block" and "crankshaft".',
          {
            refs: {
              partAId: 'engine-block',
              partBId: 'crankshaft',
            },
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
      ],
      status: 'failure',
      summary: 'status=failure failures=2 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle)

    expect(rendered.indexOf('part_overlap_current_pose')).toBeLessThan(
      rendered.indexOf('mechanical_guided_pose_target_missing'),
    )
    expect(rendered).toContain('Decide whether the current-pose overlap')
  })

  it('uses the dominant physical cluster for repair rules when a singleton detail is listed first', () => {
    const bundle: ValidationSignalBundle = {
      signals: [
        createValidationSignal(
          'isolated_part',
          'part_physically_disconnected',
          'Part "oil-pool" is not physically connected to the rest of the asset.',
          {
            refs: { partId: 'oil-pool' },
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
        createValidationSignal(
          'real_overlap',
          'part_overlap_current_pose',
          'Current-pose overlap detected between "crankshaft" and "engine-block".',
          {
            refs: {
              partAId: 'crankshaft',
              partBId: 'engine-block',
              visualAId: 'crank-journal-1',
              visualBId: 'block-lower-rail',
            },
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
      ],
      status: 'failure',
      summary: 'status=failure failures=2 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle, {
      failureClusters: [
        {
          code: 'part_overlap_current_pose',
          count: 12,
          key: 'dominant-overlap',
          kind: 'real_overlap',
          label:
            '[baseline_qc/part_overlap_current_pose] partPair=crankshaft<->engine-block',
          poseKey: null,
          refs: { partPair: 'crankshaft<->engine-block' },
          source: 'baseline_qc',
          stage: 'baseline_qc',
        },
        {
          code: 'part_physically_disconnected',
          count: 1,
          key: 'isolated-detail',
          kind: 'isolated_part',
          label: '[baseline_qc/part_physically_disconnected] partId=oil-pool',
          poseKey: null,
          refs: { partId: 'oil-pool' },
          source: 'baseline_qc',
          stage: 'baseline_qc',
        },
      ],
    })
    const failuresSection = rendered.slice(
      rendered.indexOf('<failures>'),
      rendered.indexOf('</failures>'),
    )
    const responseRules = rendered.slice(rendered.indexOf('<response_rules>'))

    expect(failuresSection.indexOf('part_physically_disconnected')).toBeLessThan(
      failuresSection.indexOf('part_overlap_current_pose'),
    )
    expect(responseRules).toContain('Decide whether the current-pose overlap')
    expect(responseRules).toContain('static housing, block, head, cover')
    expect(responseRules).not.toContain('Fix the floating or disconnected part')
  })

  it('keeps isolated-part repair rules when no larger physical cluster dominates', () => {
    const bundle: ValidationSignalBundle = {
      signals: [
        createValidationSignal(
          'isolated_part',
          'part_physically_disconnected',
          'Part "floating-bracket" is not physically connected to the rest of the asset.',
          {
            refs: { partId: 'floating-bracket' },
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
      ],
      status: 'failure',
      summary: 'status=failure failures=1 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle, {
      failureClusters: [
        {
          code: 'part_physically_disconnected',
          count: 1,
          key: 'isolated-detail',
          kind: 'isolated_part',
          label:
            '[baseline_qc/part_physically_disconnected] partId=floating-bracket',
          poseKey: null,
          refs: { partId: 'floating-bracket' },
          source: 'baseline_qc',
          stage: 'baseline_qc',
        },
      ],
    })

    expect(rendered).toContain('Fix the floating or disconnected part')
    expect(rendered).toContain('Do not respond to physical disconnection with `part_exists`')
    expect(rendered).toContain('visible support/contact path is missing')
  })

  it('warns that existence checks do not repair physical overlap failures', () => {
    const bundle: ValidationSignalBundle = {
      signals: [
        createValidationSignal(
          'real_overlap',
          'part_overlap_current_pose',
          'Current-pose overlap detected between "block" and "shaft".',
          {
            refs: {
              partAId: 'block',
              partBId: 'shaft',
              visualAId: 'block-window',
              visualBId: 'shaft-main',
            },
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
      ],
      status: 'failure',
      summary: 'status=failure failures=1 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle)

    expect(rendered).toContain(
      'Do not respond to physical/mechanical overlap',
    )
    expect(rendered).toContain('`part_exists` or `joint_exists`')
    expect(rendered).toContain('do not change geometry')
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

  it('renders targeted repair rules for invalid visual-scoped allowances', () => {
    const bundle: ValidationSignalBundle = {
      signals: [
        createValidationSignal(
          'model_validity',
          'allowance_visual_wrong_part',
          'Overlap allowance side B references a visual on the wrong part.',
          {
            path: '/allowances/0/visualBId',
            refs: {
              expectedPartId: 'crankshaft',
              visualId: 'upper-sprocket-hub',
            },
            stage: 'structure',
          },
        ),
      ],
      status: 'failure',
      summary: 'status=failure failures=1 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle)

    expect(rendered).toContain('Fix or remove the invalid visual-scoped allowance')
    expect(rendered).toContain('must be an existing visual on `partAId`')
    expect(rendered).toContain('/allowances/-')
    expect(rendered).not.toContain('Keep the joint graph as the assembly source of truth')
  })

  it('renders mechanical component repair rules for relation coverage failures', () => {
    const bundle: ValidationSignalBundle = {
      signals: [
        createValidationSignal(
          'mechanical_relation_coverage',
          'mechanical_guided_part_missing',
          'Prompt asks for a guided mechanical part, but no part is named as one.',
          {
            path: '/parts',
            source: 'checks',
            stage: 'structure',
          },
        ),
      ],
      status: 'failure',
      summary: 'status=failure failures=1 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle)

    expect(rendered).toContain('clearly named part')
    expect(rendered).toContain('piston, slider, valve')
    expect(rendered).toContain('fitted interface')
  })

  it('summarizes repeated mechanical relation coverage as mechanism contracts', () => {
    const bundle: ValidationSignalBundle = {
      signals: [
        ...Array.from({ length: 4 }, (_value, index) =>
          createValidationSignal(
            'mechanical_relation_coverage',
            'mechanical_coupler_pose_targets_missing',
            `Mechanical coupler part "connecting-rod-${index + 1}" needs pose-specific evidence to its moving endpoints.`,
            {
              refs: { partId: `connecting-rod-${index + 1}` },
              source: 'checks',
              stage: 'structure',
            },
          ),
        ),
        ...Array.from({ length: 3 }, (_value, index) =>
          createValidationSignal(
            'mechanical_relation_coverage',
            'mechanical_guided_pose_target_missing',
            `Guided mechanical part "piston-${index + 1}" needs pose-specific guide evidence for linked motion.`,
            {
              refs: { partId: `piston-${index + 1}` },
              source: 'checks',
              stage: 'structure',
            },
          ),
        ),
      ],
      status: 'failure',
      summary: 'status=failure failures=7 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle)

    expect(rendered).toContain('<mechanical_contract_summary>')
    expect(rendered).toContain('[mechanical_coupler_pose_targets_missing] count=4')
    expect(rendered).toContain(
      'parts=connecting-rod-1,connecting-rod-2,connecting-rod-3,connecting-rod-4',
    )
    expect(rendered).toContain('sampled-pose exact checks')
    expect(rendered).toContain('[mechanical_guided_pose_target_missing] count=3')
    expect(rendered).toContain('sampled-pose exact guide containment/contact checks')
    expect(rendered).toContain(
      '[structure/mechanical_coupler_pose_targets_missing] Mechanical couplers need sampled-pose endpoint evidence. x2',
    )
    expect(rendered).toContain('repair repeated component classes together')
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

  it('summarizes exact visual hotspots for repeated physical relation failures', () => {
    const signals = [
      ...Array.from({ length: 4 }, (_, index) =>
        createValidationSignal(
          'sampled_pose_overlap',
          'part_overlap_sampled_pose',
          `Sampled-pose overlap detected between "engine-block" and "connecting-rod-${index + 1}".`,
          {
            details:
              'depth=(0.0200, 0.0300, 0.0040) volume=2.000e-6 pose=cycle-quarter joints=crank=0.7854',
            refs: {
              partAId: 'engine-block',
              partBId: `connecting-rod-${index + 1}`,
              poseValues: 'crank=0.7854',
              visualAId: 'block-lower-back-rail',
              visualBId: `rod-${index + 1}-shank`,
            },
            source: 'baseline_qc',
            stage: 'sampled_poses',
          },
        ),
      ),
      createValidationSignal(
        'path_contact_fit',
        'expect_path_contacts_failed',
        'Expected path part "timing-chain" to contact at least 2 target parts, but only 0 matched.',
        {
          details:
            'contacts=0/2 closestFailedVisualPair=timing-chain-loop<->upper-sprocket-rim',
          refs: {
            partAId: 'timing-chain',
            partBId: 'upper-timing-sprocket',
            pathVisualId: 'timing-chain-loop',
            targetVisualId: 'upper-sprocket-rim',
          },
          source: 'checks',
          stage: 'checks',
        },
      ),
    ]
    const bundle: ValidationSignalBundle = {
      signals,
      status: 'failure',
      summary: 'status=failure failures=5 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle)

    expect(rendered).toContain('<visual_relation_hotspots>')
    expect(rendered).toContain('visual=block-lower-back-rail')
    expect(rendered).toContain(
      'opposingParts=connecting-rod-1,connecting-rod-2,connecting-rod-3,connecting-rod-4',
    )
    expect(rendered).not.toContain('Dominant exact visual pairs:')
    expect(rendered).not.toContain(
      'visuals=timing-chain-loop<->upper-sprocket-rim',
    )
    expect(rendered).toContain('Use these exact visual ids as repair targets')
  })

  it('adds mechanism-level repair strategy for large physical failure sets', () => {
    const signals = Array.from({ length: 50 }, (_value, index) =>
      createValidationSignal(
        'real_overlap',
        'part_overlap_current_pose',
        `Current-pose overlap detected between "housing" and "mover-${index}".`,
        {
          refs: {
            partAId: 'housing',
            partBId: `mover-${index}`,
            visualAId: 'housing-wall',
            visualBId: `mover-${index}-body`,
          },
          source: 'baseline_qc',
          stage: 'baseline_qc',
        },
      ),
    )
    const bundle: ValidationSignalBundle = {
      signals,
      status: 'failure',
      summary: 'status=failure failures=50 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle)

    expect(rendered).toContain('<repair_strategy>')
    expect(rendered).toContain('representation-level problem')
    expect(rendered).toContain('open, split, shrink, or relocate')
    expect(rendered).toContain('exact bounded checks')
  })

  it('classifies mechanical overlap pairs into fit proof or clearance guidance', () => {
    const bundle: ValidationSignalBundle = {
      signals: [
        createValidationSignal(
          'real_overlap',
          'part_overlap_current_pose',
          'Current-pose overlap detected between "guide-block" and "piston".',
          {
            refs: {
              partAId: 'guide-block',
              partBId: 'piston',
              visualAId: 'cylinder-liner-shell',
              visualBId: 'piston-skirt',
            },
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
        createValidationSignal(
          'real_overlap',
          'part_overlap_current_pose',
          'Current-pose overlap detected between "support-block" and "shaft".',
          {
            refs: {
              partAId: 'support-block',
              partBId: 'shaft',
              visualAId: 'main-bearing-collar',
              visualBId: 'shaft-journal',
            },
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
        createValidationSignal(
          'real_overlap',
          'part_overlap_current_pose',
          'Current-pose overlap detected between "crank" and "connecting-rod".',
          {
            refs: {
              partAId: 'crank',
              partBId: 'connecting-rod',
              visualAId: 'crank-pin-journal',
              visualBId: 'rod-big-eye',
            },
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
        createValidationSignal(
          'path_contact_fit',
          'expect_path_contacts_failed',
          'Expected path part "drive-chain" to contact a sprocket target.',
          {
            refs: {
              partAId: 'drive-chain',
              partBId: 'drive-sprocket',
              pathVisualId: 'chain-loop',
              targetVisualId: 'sprocket-teeth',
            },
            source: 'checks',
            stage: 'checks',
          },
        ),
        createValidationSignal(
          'real_overlap',
          'part_overlap_current_pose',
          'Current-pose overlap detected between "engine-block" and "cylinder-liner".',
          {
            refs: {
              partAId: 'engine-block',
              partBId: 'cylinder-liner',
              visualAId: 'block-bore-seat',
              visualBId: 'liner-shell',
            },
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
        createValidationSignal(
          'real_overlap',
          'part_overlap_current_pose',
          'Current-pose overlap detected between "frame" and "connecting-rod".',
          {
            refs: {
              partAId: 'frame',
              partBId: 'connecting-rod',
              visualAId: 'frame-rail',
              visualBId: 'rod-shank',
            },
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
      ],
      status: 'failure',
      summary: 'status=failure failures=6 warnings=0 notes=0',
    }

    const rendered = renderValidationSignals(bundle)

    expect(rendered).toContain('<mechanical_fit_overlap_guidance>')
    expect(rendered).toContain('guided containment fit')
    expect(rendered).toContain('expect_within')
    expect(rendered).toContain('shaft or pin bearing fit')
    expect(rendered).toContain('rod/linkage endpoint fit')
    expect(rendered).toContain('inserted support fit')
    expect(rendered).toContain('seated in')
    expect(rendered).toContain('routed path seating')
    expect(rendered).toContain('expect_path_contacts')
    expect(rendered).toContain('swept-volume clearance')
    expect(rendered).toContain('open, split, shrink, or move')
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
        relations: [
          {
            closestVisualPair: 'chain-visual<->drawbridge-panel',
            distance: 0,
            id: 'relation:1',
            overlapDepth: [0.01, 0.02, 0.03],
            overlapVolume: 0.000006,
            partAId: 'chain',
            partBId: 'drawbridge',
            penetrationDepth: 0.01,
            signalCode: 'part_overlap_sampled_pose',
            signalStage: 'sampled_poses',
          },
        ],
      },
      relationLoopHints: [
        'Recent repairs alternated between overlap and gap/contact failures for chain<->drawbridge.',
      ],
    })

    expect(rendered).toContain('<failure_clusters>')
    expect(rendered).toContain('partPair=chain<->drawbridge')
    expect(rendered).toContain('<probe_report>')
    expect(rendered).toContain('jointOriginDistances')
    expect(rendered).toContain('visual=chain-1')
    expect(rendered).toContain('<relation_loop_hints>')
    expect(rendered).toContain('failedPairRelations')
    expect(rendered).toContain('chain-visual<->drawbridge-panel')
    expect(rendered).toContain('pose-resolved endpoint geometry')
  })
})
