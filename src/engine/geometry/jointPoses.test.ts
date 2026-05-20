import { describe, expect, it } from 'vitest'
import { createValidValidationFixtureAsset } from '../examples/validationFixtures'
import type { ManifestAsset } from '../schema/manifestTypes'
import {
  createGeneratedJointPoseSamples,
  getJointPreviewControls,
  resolveJointControlPoseValues,
} from './jointPoses'

describe('joint preview controls', () => {
  it('uses manifest controls to group linked movable joints', () => {
    const asset = createTwoWheelAsset()
    const controls = getJointPreviewControls(asset)

    expect(controls.map((control) => control.id)).toEqual(['wheel-spin-control'])
    expect(controls[0].bindings.map((binding) => binding.joint.id)).toEqual([
      'left-wheel-spin',
      'right-wheel-spin',
    ])
    expect(resolveJointControlPoseValues(controls[0], 1)).toMatchObject({
      'left-wheel-spin': 1,
      'right-wheel-spin': Math.PI * 2 - 1,
    })
  })

  it('falls back to one control per uncovered movable joint', () => {
    const asset = createValidValidationFixtureAsset()

    asset.controls = []

    expect(getJointPreviewControls(asset).map((control) => control.id)).toEqual([
      'crate-lid-hinge',
    ])
  })

  it('generates sampled poses from controls instead of isolated linked joints', () => {
    const asset = createTwoWheelAsset()
    const samples = createGeneratedJointPoseSamples(asset)

    expect(samples).toHaveLength(3)
    expect(samples.every((sample) => sample.id.startsWith('sample:wheel-spin-control:'))).toBe(true)
    expect(
      samples.every(
        (sample) =>
          sample.poses['left-wheel-spin'] !== undefined &&
          sample.poses['right-wheel-spin'] !== undefined,
      ),
    ).toBe(true)
  })
})

function createTwoWheelAsset(): ManifestAsset {
  const asset = createValidValidationFixtureAsset()

  return {
    ...asset,
    controls: [
      {
        id: 'wheel-spin-control',
        name: 'Wheel spin',
        joints: [
          { jointId: 'left-wheel-spin', offset: 0, scale: 1 },
          { jointId: 'right-wheel-spin', offset: 0, scale: -1 },
        ],
        limits: { lower: 0, upper: Math.PI * 2 },
      },
    ],
    joints: [
      {
        ...asset.joints[0],
        childPartId: 'crate-lid',
        id: 'left-wheel-spin',
        name: 'Left wheel spin',
        type: 'continuous',
      },
      {
        ...asset.joints[0],
        childPartId: 'crate-lid',
        id: 'right-wheel-spin',
        name: 'Right wheel spin',
        type: 'continuous',
      },
    ],
  }
}
