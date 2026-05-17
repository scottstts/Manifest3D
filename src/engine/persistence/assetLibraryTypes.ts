import type { CandidateAttempt } from '../agent/candidateHistory'
import type { ManifestAsset } from '../schema/manifestTypes'
import type { ValidationReport } from '../schema/validationTypes'

export type AssetLibrarySnapshot = {
  assets: AssetLibraryAsset[]
}

export type AssetLibraryAsset = {
  assetId: string
  createdAt: string
  lastSelectedVersionId: string
  name: string
  updatedAt: string
  versions: AssetLibraryVersion[]
}

export type AssetLibraryVersion = {
  asset: ManifestAsset
  assetId: string
  attempts: PersistedCandidateAttempt[]
  createdAt: string
  parentVersionId: string | null
  sourceRunId: string
  validationReport: ValidationReport
  versionId: string
  versionNumber: number
}

export type PersistedCandidateAttempt = CandidateAttempt & {
  assetId: string
  versionId: string
}

export type SaveValidatedAssetVersionInput = {
  asset: ManifestAsset
  history: {
    attempts: readonly CandidateAttempt[]
    runId: string
  }
  now?: () => string
  parentVersionId?: string | null
  validationReport: ValidationReport
}

export type SaveValidatedAssetVersionResult = {
  asset: AssetLibraryAsset
  snapshot: AssetLibrarySnapshot
  version: AssetLibraryVersion
}
