import { describe, expect, it } from 'vitest'
import { createCandidateHistory } from '../agent/candidateHistory'
import { createValidValidationFixtureAsset } from '../testing/validationFixtureAsset'
import { validateManifestAssetCandidate } from '../validation/validateManifest'
import {
  createEmptyAssetLibrarySnapshot,
  saveValidatedAssetVersion,
} from './assetLibraryModel'
import { createMemoryAssetLibraryRepository } from './assetLibraryRepository'
import type { AssetLibraryAsset } from './assetLibraryTypes'

describe('asset library repository', () => {
  it('saves one asset without replacing unrelated assets', async () => {
    const firstAsset = buildSavedAsset('first-crate', 'First Crate')
    const secondAsset = buildSavedAsset('second-crate', 'Second Crate')
    const repository = createMemoryAssetLibraryRepository({
      assets: [firstAsset],
    })

    await repository.saveAsset(secondAsset)

    const snapshot = await repository.loadSnapshot()

    expect(snapshot.assets.map((asset) => asset.assetId)).toEqual([
      'second-crate',
      'first-crate',
    ])
  })

  it('deletes only the requested asset', async () => {
    const firstAsset = buildSavedAsset('first-crate', 'First Crate')
    const secondAsset = buildSavedAsset('second-crate', 'Second Crate')
    const repository = createMemoryAssetLibraryRepository({
      assets: [firstAsset, secondAsset],
    })

    await repository.deleteAsset('first-crate')

    const snapshot = await repository.loadSnapshot()

    expect(snapshot.assets.map((asset) => asset.assetId)).toEqual([
      'second-crate',
    ])
  })
})

function buildSavedAsset(assetId: string, name: string): AssetLibraryAsset {
  const asset = {
    ...createValidValidationFixtureAsset(),
    id: assetId,
    name,
  }
  const history = createCandidateHistory({ runId: `run-${assetId}` })
  const report = validateManifestAssetCandidate(asset).report

  history.recordValidationAttempt(asset, report)

  return saveValidatedAssetVersion(createEmptyAssetLibrarySnapshot(), {
    asset,
    history: history.getSnapshot(),
    now: () =>
      assetId === 'first-crate'
        ? '2026-05-17T00:00:00.000Z'
        : '2026-05-17T00:01:00.000Z',
    validationReport: report,
  }).asset
}
