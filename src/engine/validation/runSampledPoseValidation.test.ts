import { describe, expect, it } from 'vitest'
import type { ManifestAsset } from '../schema/manifestTypes'
import { runSampledPoseValidation } from './runSampledPoseValidation'

describe('runSampledPoseValidation', () => {
  it('does not report new overlaps when a rigid subassembly yaws without relative motion', () => {
    const asset = createYawingFanCageAsset()
    const signals = runSampledPoseValidation(asset)

    expect(signals).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'part_overlap_sampled_pose',
          refs: expect.objectContaining({
            partAId: expect.stringMatching(/fan-head|blade-rotor/),
            partBId: expect.stringMatching(/fan-head|blade-rotor/),
          }),
        }),
      ]),
    )
  })
})

function createYawingFanCageAsset(): ManifestAsset {
  return {
    allowances: [],
    checks: [],
    controls: [
      {
        id: 'head-turn-control',
        joints: [
          {
            jointId: 'fan-head-yaw',
            offset: 0,
            scale: 1,
          },
        ],
        limits: {
          lower: -0.9,
          upper: 0.9,
        },
        name: 'Fan head turn',
      },
    ],
    id: 'yawing-fan-cage',
    joints: [
      {
        axis: [0, 1, 0],
        childPartId: 'fan-head',
        id: 'fan-head-yaw',
        limits: {
          effort: 12,
          lower: -0.9,
          upper: 0.9,
          velocity: 1.5,
        },
        name: 'Fan head yaw',
        origin: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        parentPartId: 'stand-base',
        type: 'revolute',
      },
      {
        childPartId: 'blade-rotor',
        id: 'blade-fixed',
        name: 'Blade fixed mount',
        origin: {
          position: [0, 0, 0.32],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        parentPartId: 'fan-head',
        type: 'fixed',
      },
    ],
    materials: [
      {
        color: '#cccccc',
        id: 'mat-metal',
        metalness: 0.6,
        name: 'Metal',
        roughness: 0.3,
        side: 'front',
      },
      {
        color: '#9fd8ff',
        id: 'mat-blade',
        metalness: 0,
        name: 'Blade',
        opacity: 0.7,
        roughness: 0.35,
        side: 'front',
      },
    ],
    metadata: {
      createdAt: '2026-05-31T00:00:00.000Z',
      generationStatus: 'ready',
      sourceImageIds: [],
      updatedAt: '2026-05-31T00:00:00.000Z',
    },
    name: 'Yawing Fan Cage',
    parts: [
      {
        id: 'stand-base',
        name: 'Stand Base',
        role: 'base',
        visuals: [
          {
            geometry: {
              size: [0.08, 0.08, 0.08],
              type: 'box',
            },
            id: 'base-block',
            materialId: 'mat-metal',
            name: 'Base block',
            transform: {
              position: [0, 0, -0.08],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
          },
        ],
      },
      {
        id: 'fan-head',
        name: 'Fan Head',
        role: 'housing',
        visuals: [
          {
            geometry: {
              radialSegments: 12,
              radius: 0.27,
              tube: 0.0045,
              tubularSegments: 112,
              type: 'torus',
            },
            id: 'front-guard-middle-ring',
            materialId: 'mat-metal',
            name: 'Front guard middle ring',
            transform: {
              position: [0, 0, 0.405],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
          },
          {
            geometry: {
              radialSegments: 12,
              radius: 0.27,
              tube: 0.0045,
              tubularSegments: 112,
              type: 'torus',
            },
            id: 'rear-guard-middle-ring',
            materialId: 'mat-metal',
            name: 'Rear guard middle ring',
            transform: {
              position: [0, 0, 0.275],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
          },
        ],
      },
      {
        id: 'blade-rotor',
        name: 'Blade Rotor',
        role: 'wheel',
        visuals: [
          {
            geometry: {
              bevelEnabled: true,
              bevelSegments: 2,
              bevelSize: 0.002,
              bevelThickness: 0.002,
              depth: 0.012,
              shape: [
                [-0.045, 0.055],
                [0.045, 0.07],
                [0.12, 0.205],
                [0.105, 0.315],
                [0.02, 0.345],
                [-0.085, 0.285],
                [-0.105, 0.145],
              ],
              type: 'extrude',
            },
            id: 'blade-1',
            materialId: 'mat-blade',
            name: 'Fan blade 1',
            transform: {
              position: [0, 0, -0.006],
              rotation: [0, 0, 0],
              scale: [1, 1, 1],
            },
          },
        ],
      },
    ],
    prompt: 'A fan head where the cage and blade yaw together.',
    schemaVersion: 2,
    units: 'meters',
  }
}
