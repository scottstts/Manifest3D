import { describe, expect, it } from 'vitest'
import * as THREE from 'three/webgpu'
import { createValidValidationFixtureAsset } from '../examples/validationFixtures'
import { parseManifestAsset } from '../schema/manifestSchema'
import {
  applyBuiltManifestJointPoses,
  applyBuiltManifestMaterialAnimations,
  buildManifestAsset,
  disposeManifestObject,
  findManifestObjectData,
} from './assetBuilder'

describe('buildManifestAsset', () => {
  it('builds a joint-driven selectable asset group', () => {
    const asset = createValidValidationFixtureAsset()
    const builtAsset = buildManifestAsset(asset)

    expect(builtAsset.group.name).toBe('Validation Crate')
    expect(builtAsset.partGroups.size).toBe(2)
    expect(builtAsset.jointGroups.size).toBe(1)
    expect(builtAsset.visualMeshes.size).toBe(2)
    expect(builtAsset.bounds.isEmpty()).toBe(false)

    const lidGroup = builtAsset.partGroups.get('crate-lid')
    const lidJointGroup = builtAsset.jointGroups.get('crate-lid-hinge')

    expect(lidGroup?.parent).toBe(lidJointGroup)
    expect(lidJointGroup?.parent).toBe(builtAsset.partGroups.get('crate-base'))

    const visual = builtAsset.visualMeshes.get('crate-lid-panel')

    expect(visual).toBeDefined()
    expect(visual ? findManifestObjectData(visual) : null).toMatchObject({
      assetId: 'validation-crate',
      kind: 'visual',
      partId: 'crate-lid',
      visualId: 'crate-lid-panel',
    })

    disposeManifestObject(builtAsset.group)
  })

  it('throws when a visual references a missing material', () => {
    const asset = createValidValidationFixtureAsset()

    asset.parts[0].visuals[0].materialId = 'missing'

    expect(() => buildManifestAsset(asset)).toThrow(/missing material/)
  })

  it('applies movable joint preview poses while building the hierarchy', () => {
    const asset = createValidValidationFixtureAsset()
    const builtAsset = buildManifestAsset(asset, {
      jointPoses: {
        'crate-lid-hinge': -1.2,
      },
    })
    const lidJointGroup = builtAsset.jointGroups.get('crate-lid-hinge')

    expect(lidJointGroup?.rotation.x).toBeCloseTo(-1.2)

    disposeManifestObject(builtAsset.group)
  })

  it('resolves connectorTube visuals from current endpoint part poses', () => {
    const asset = createValidValidationFixtureAsset()

    asset.parts[0].visuals.push({
      geometry: {
        end: {
          partId: 'crate-lid',
          position: [0.5, 0.1, 0],
        },
        radius: 0.01,
        sag: 0.02,
        start: {
          partId: 'crate-base',
          position: [0.5, 0.45, 0],
        },
        type: 'connectorTube',
      },
      id: 'lid-retainer-cable',
      materialId: 'mat-white',
      name: 'Lid retainer cable',
      transform: {},
    })

    const builtAsset = buildManifestAsset(asset)
    const connector = builtAsset.connectorVisuals[0]
    const initialEnd = connector.centerlinePoints.at(-1)?.clone()

    applyBuiltManifestJointPoses(builtAsset, {
      'crate-lid-hinge': -1.2,
    })

    const movedEnd = connector.centerlinePoints.at(-1)

    expect(connector.visualId).toBe('lid-retainer-cable')
    expect(initialEnd).toBeDefined()
    expect(movedEnd).toBeDefined()
    expect(initialEnd && movedEnd ? initialEnd.distanceTo(movedEnd) : 0).toBeGreaterThan(
      0.05,
    )

    disposeManifestObject(builtAsset.group)
  })

  it('applies material emission animation preview values', () => {
    const asset = createValidValidationFixtureAsset()

    asset.materials[0] = {
      ...asset.materials[0],
      emission: {
        color: '#ff0000',
        hasEmission: true,
        intensity: 2,
      },
      emissionAnimation: {
        id: 'crate-warning-flash',
        interpolation: 'linear',
        keyframes: [
          {
            color: '#ff0000',
            hasEmission: true,
            intensity: 2,
            time: 0,
          },
          {
            color: '#0000ff',
            hasEmission: true,
            intensity: 6,
            time: 1,
          },
        ],
        loop: false,
        name: 'Warning flash',
      },
    }

    const builtAsset = buildManifestAsset(asset)
    const material = builtAsset.materials.get('mat-violet') as
      | THREE.MeshStandardMaterial
      | undefined

    expect(material?.emissiveIntensity).toBeCloseTo(2)
    expect(material?.emissive.getHexString()).toBe('ff0000')

    applyBuiltManifestMaterialAnimations(builtAsset, {
      'mat-violet': 1,
    })

    expect(material?.emissiveIntensity).toBeCloseTo(6)
    expect(material?.emissive.getHexString()).toBe('0000ff')

    disposeManifestObject(builtAsset.group)
  })

  it('applies authored material side to rendered node materials', () => {
    const asset = createValidValidationFixtureAsset()

    asset.materials[0] = {
      ...asset.materials[0],
      side: 'double',
    }
    asset.materials[1] = {
      ...asset.materials[1],
      side: 'back',
    }

    const builtAsset = buildManifestAsset(asset)

    expect(builtAsset.materials.get('mat-violet')?.side).toBe(THREE.DoubleSide)
    expect(builtAsset.materials.get('mat-white')?.side).toBe(THREE.BackSide)

    disposeManifestObject(builtAsset.group)
  })

  it('throws when the joint graph has more than one root', () => {
    const asset = parseManifestAsset({
      ...createValidValidationFixtureAsset(),
      joints: [],
    })

    expect(() => buildManifestAsset(asset)).toThrow(/exactly one root/)
  })
})
