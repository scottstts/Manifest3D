import type { SceneStore } from '../scene/sceneStore'
import type { ManifestAsset } from '../schema/manifestTypes'
import type { ValidationReport } from '../schema/validationTypes'
import { withCommitStep } from './reportBuilder'
import { validateManifestAssetCandidate } from './validateManifest'

export type CommitValidatedAssetResult = {
  asset: ManifestAsset | null
  committed: boolean
  report: ValidationReport
}

export function commitValidatedAsset(
  sceneStore: SceneStore,
  candidate: unknown,
): CommitValidatedAssetResult {
  const validationResult = validateManifestAssetCandidate(candidate)
  const committed = Boolean(
    validationResult.asset && validationResult.report.valid,
  )

  if (committed && validationResult.asset) {
    sceneStore.upsertAsset(validationResult.asset)
  }

  return {
    asset: validationResult.asset,
    committed,
    report: withCommitStep(validationResult.report, committed),
  }
}
