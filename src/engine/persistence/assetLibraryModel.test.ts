import { describe, expect, it } from 'vitest'
import {
  createInvalidValidationFixtureAsset,
  createValidValidationFixtureAsset,
} from '../examples/validationFixtures'
import { validateManifestAssetCandidate } from '../validation/validateManifest'
import { createCandidateHistory } from '../agent/candidateHistory'
import {
  createEmptyAssetLibrarySnapshot,
  getAdjacentAssetVersions,
  getLastSelectedAssetVersion,
  deleteAssetLibraryAsset,
  saveValidatedAssetVersion,
  setLastSelectedAssetVersion,
} from './assetLibraryModel'

describe('asset library model', () => {
  it('stores validated assets as versions with associated attempts', () => {
    const validAsset = createValidValidationFixtureAsset()
    const invalidAsset = createInvalidValidationFixtureAsset()
    const history = createCandidateHistory({
      now: () => '2026-05-17T00:00:00.000Z',
      runId: 'run-library',
    })

    history.recordValidationAttempt(
      invalidAsset,
      validateManifestAssetCandidate(invalidAsset).report,
    )
    history.recordValidationAttempt(
      validAsset,
      validateManifestAssetCandidate(validAsset).report,
    )

    const saved = saveValidatedAssetVersion(
      createEmptyAssetLibrarySnapshot(),
      {
        agentEvents: [
          {
            detail: 'mode=create',
            id: 'run-library:1:compiling_prompt',
            label: 'Compile prompt',
            state: 'compiling_prompt',
            status: 'passed',
          },
          {
            detail: null,
            id: 'run-library:2:validating_candidate',
            label: 'Validate candidate',
            state: 'validating_candidate',
            status: 'failed',
          },
        ],
        asset: validAsset,
        history: history.getSnapshot(),
        now: () => '2026-05-17T00:00:00.000Z',
        validationReport: validateManifestAssetCandidate(validAsset).report,
      },
    )

    expect(saved.asset.assetId).toBe('validation-crate')
    expect(saved.version.versionId).toBe('validation-crate:v1')
    expect(saved.version.attempts).toHaveLength(2)
    expect(saved.version.attempts[0]).toMatchObject({
      assetId: 'validation-crate',
      status: 'failure',
      versionId: 'validation-crate:v1',
    })
    expect(saved.version.attempts[0].candidate).toMatchObject({
      id: 'invalid-validation-crate',
    })
    expect(saved.version.agentEvents?.map((event) => event.label)).toEqual([
      'Compile prompt',
      'Validate candidate',
    ])
  })

  it('links the submitted user input to the saved asset version', () => {
    const validAsset = createValidValidationFixtureAsset()
    const history = createCandidateHistory({ runId: 'run-user-input' })
    const report = validateManifestAssetCandidate(validAsset).report

    history.recordValidationAttempt(validAsset, report)

    const saved = saveValidatedAssetVersion(
      createEmptyAssetLibrarySnapshot(),
      {
        asset: validAsset,
        history: history.getSnapshot(),
        now: () => '2026-05-17T00:00:00.000Z',
        userInput: {
          imageAttachments: [
            {
              height: 200,
              id: 'ref-front',
              imageUrl: 'data:image/png;base64,front',
              mediaType: 'image/png',
              name: 'front.png',
              width: 300,
            },
          ],
          text: 'Create it from this front reference.',
        },
        validationReport: report,
      },
    )

    expect(saved.version.userInput).toMatchObject({
      imageAttachments: [
        {
          id: 'ref-front',
          imageUrl: 'data:image/png;base64,front',
          mediaType: 'image/png',
        },
      ],
      text: 'Create it from this front reference.',
    })
  })

  it('creates ordered versions and tracks the last selected version', () => {
    const assetV1 = createValidValidationFixtureAsset()
    const assetV2 = {
      ...assetV1,
      name: 'Validation Crate Revised',
    }
    const firstHistory = createCandidateHistory({ runId: 'run-v1' })
    const secondHistory = createCandidateHistory({ runId: 'run-v2' })

    firstHistory.recordValidationAttempt(
      assetV1,
      validateManifestAssetCandidate(assetV1).report,
    )
    secondHistory.recordValidationAttempt(
      assetV2,
      validateManifestAssetCandidate(assetV2).report,
    )

    const first = saveValidatedAssetVersion(
      createEmptyAssetLibrarySnapshot(),
      {
        asset: assetV1,
        history: firstHistory.getSnapshot(),
        now: () => '2026-05-17T00:00:00.000Z',
        validationReport: validateManifestAssetCandidate(assetV1).report,
      },
    )
    const second = saveValidatedAssetVersion(first.snapshot, {
      asset: assetV2,
      history: secondHistory.getSnapshot(),
      now: () => '2026-05-17T00:01:00.000Z',
      parentVersionId: first.version.versionId,
      validationReport: validateManifestAssetCandidate(assetV2).report,
    })
    const asset = second.snapshot.assets[0]

    expect(asset.versions.map((version) => version.versionId)).toEqual([
      'validation-crate:v1',
      'validation-crate:v2',
    ])
    expect(getLastSelectedAssetVersion(asset).versionId).toBe(
      'validation-crate:v2',
    )

    const restoredSnapshot = setLastSelectedAssetVersion(
      second.snapshot,
      'validation-crate',
      'validation-crate:v1',
    )
    const restoredAsset = restoredSnapshot.assets[0]
    const adjacentVersions = getAdjacentAssetVersions(
      restoredAsset,
      'validation-crate:v1',
    )

    expect(restoredAsset.lastSelectedVersionId).toBe('validation-crate:v1')
    expect(adjacentVersions.previous).toBeNull()
    expect(adjacentVersions.next?.versionId).toBe('validation-crate:v2')
  })

  it('orders assets by initial creation time and deletes assets by id', () => {
    const olderAsset = createValidValidationFixtureAsset()
    const newerAsset = {
      ...olderAsset,
      id: 'newer-crate',
      name: 'Newer Crate',
    }
    const olderHistory = createCandidateHistory({ runId: 'run-older' })
    const newerHistory = createCandidateHistory({ runId: 'run-newer' })

    olderHistory.recordValidationAttempt(
      olderAsset,
      validateManifestAssetCandidate(olderAsset).report,
    )
    newerHistory.recordValidationAttempt(
      newerAsset,
      validateManifestAssetCandidate(newerAsset).report,
    )

    const older = saveValidatedAssetVersion(
      createEmptyAssetLibrarySnapshot(),
      {
        asset: olderAsset,
        history: olderHistory.getSnapshot(),
        now: () => '2026-05-17T00:00:00.000Z',
        validationReport: validateManifestAssetCandidate(olderAsset).report,
      },
    )
    const newer = saveValidatedAssetVersion(older.snapshot, {
      asset: newerAsset,
      history: newerHistory.getSnapshot(),
      now: () => '2026-05-17T00:02:00.000Z',
      validationReport: validateManifestAssetCandidate(newerAsset).report,
    })

    expect(newer.snapshot.assets.map((asset) => asset.assetId)).toEqual([
      'newer-crate',
      'validation-crate',
    ])

    const deleted = deleteAssetLibraryAsset(newer.snapshot, 'newer-crate')

    expect(deleted.assets.map((asset) => asset.assetId)).toEqual([
      'validation-crate',
    ])
  })
})
