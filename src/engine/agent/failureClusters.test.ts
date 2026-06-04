import { describe, expect, it } from 'vitest'
import { createValidationSignal } from '../validation/reportBuilder'
import { createValidationFailureClusters } from './failureClusters'

describe('createValidationFailureClusters', () => {
  it('groups sampled-pose failures by mechanism pair instead of joint vector', () => {
    const clusters = createValidationFailureClusters([
      createValidationSignal(
        'sampled_pose_overlap',
        'part_overlap_sampled_pose',
        'Sampled-pose overlap detected between "frame" and "linkage".',
        {
          details:
            'depth=(0.0100,0.0200,0.0300) pose=cycle quarter joints=crank=0.2500,slider=0.1000,rod=-0.0500',
          refs: {
            partAId: 'frame',
            partBId: 'linkage',
            visualAId: 'frame-rail',
            visualBId: 'linkage-arm',
          },
          source: 'baseline_qc',
          stage: 'sampled_poses',
        },
      ),
      createValidationSignal(
        'sampled_pose_overlap',
        'part_overlap_sampled_pose',
        'Sampled-pose overlap detected between "frame" and "linkage".',
        {
          details:
            'depth=(0.0100,0.0200,0.0300) pose=cycle half joints=crank=0.5000,slider=0.2000,rod=-0.1000',
          refs: {
            partAId: 'linkage',
            partBId: 'frame',
            visualAId: 'linkage-arm',
            visualBId: 'frame-rail',
          },
          source: 'baseline_qc',
          stage: 'sampled_poses',
        },
      ),
    ])

    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toMatchObject({
      count: 2,
      poseKey: null,
      refs: {
        partPair: 'frame<->linkage',
      },
    })
    expect(clusters[0].label).not.toContain('crank=0.2500')
  })
})
