import { describe, expect, it } from 'vitest'
import { createValidValidationFixtureAsset } from '../examples/validationFixtures'
import { parseManifestAsset } from '../schema/manifestSchema'
import {
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

  it('throws when the joint graph has more than one root', () => {
    const asset = parseManifestAsset({
      ...createValidValidationFixtureAsset(),
      joints: [],
    })

    expect(() => buildManifestAsset(asset)).toThrow(/exactly one root/)
  })
})
