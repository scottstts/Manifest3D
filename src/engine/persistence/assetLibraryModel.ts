import type {
  AssetLibraryAsset,
  AssetLibrarySnapshot,
  AssetLibraryVersion,
  PersistedCandidateAttempt,
  SaveValidatedAssetVersionInput,
  SaveValidatedAssetVersionResult,
} from './assetLibraryTypes'

export function createEmptyAssetLibrarySnapshot(): AssetLibrarySnapshot {
  return {
    assets: [],
  }
}

export function saveValidatedAssetVersion(
  snapshot: AssetLibrarySnapshot,
  input: SaveValidatedAssetVersionInput,
): SaveValidatedAssetVersionResult {
  const now = input.now?.() ?? new Date().toISOString()
  const assetId = input.asset.id
  const existingAsset = snapshot.assets.find((asset) => asset.assetId === assetId)
  const versionNumber = (existingAsset?.versions.length ?? 0) + 1
  const versionId = createAssetVersionId(assetId, versionNumber)
  const attempts: PersistedCandidateAttempt[] = input.history.attempts.map(
    (attempt) => ({
      ...attempt,
      assetId,
      versionId,
    }),
  )
  const version: AssetLibraryVersion = {
    asset: input.asset,
    assetId,
    attempts,
    createdAt: now,
    parentVersionId: input.parentVersionId ?? null,
    sourceRunId: input.history.runId,
    validationReport: input.validationReport,
    versionId,
    versionNumber,
  }
  const nextAsset: AssetLibraryAsset = {
    assetId,
    createdAt: existingAsset?.createdAt ?? now,
    lastSelectedVersionId: versionId,
    name: input.asset.name,
    updatedAt: now,
    versions: [...(existingAsset?.versions ?? []), version],
  }
  const nextAssets = existingAsset
    ? snapshot.assets.map((asset) =>
        asset.assetId === assetId ? nextAsset : asset,
      )
    : [...snapshot.assets, nextAsset]
  const nextSnapshot = sortLibrarySnapshot({
    assets: nextAssets,
  })

  return {
    asset: nextAsset,
    snapshot: nextSnapshot,
    version,
  }
}

export function saveAssetLibraryAsset(
  snapshot: AssetLibrarySnapshot,
  nextAsset: AssetLibraryAsset,
): AssetLibrarySnapshot {
  const existingAsset = snapshot.assets.find(
    (asset) => asset.assetId === nextAsset.assetId,
  )
  const nextAssets = existingAsset
    ? snapshot.assets.map((asset) =>
        asset.assetId === nextAsset.assetId ? nextAsset : asset,
      )
    : [...snapshot.assets, nextAsset]

  return sortLibrarySnapshot({
    assets: nextAssets,
  })
}

export function setLastSelectedAssetVersion(
  snapshot: AssetLibrarySnapshot,
  assetId: string,
  versionId: string,
): AssetLibrarySnapshot {
  return {
    assets: snapshot.assets.map((asset) => {
      if (asset.assetId !== assetId) {
        return asset
      }

      if (!asset.versions.some((version) => version.versionId === versionId)) {
        return asset
      }

      return {
        ...asset,
        lastSelectedVersionId: versionId,
      }
    }),
  }
}

export function deleteAssetLibraryAsset(
  snapshot: AssetLibrarySnapshot,
  assetId: string,
): AssetLibrarySnapshot {
  return {
    assets: snapshot.assets.filter((asset) => asset.assetId !== assetId),
  }
}

export function findAssetLibraryVersion(
  snapshot: AssetLibrarySnapshot,
  assetId: string,
  versionId: string,
): AssetLibraryVersion | null {
  return (
    snapshot.assets
      .find((asset) => asset.assetId === assetId)
      ?.versions.find((version) => version.versionId === versionId) ?? null
  )
}

export function getLastSelectedAssetVersion(
  asset: AssetLibraryAsset,
): AssetLibraryVersion {
  return (
    asset.versions.find(
      (version) => version.versionId === asset.lastSelectedVersionId,
    ) ?? asset.versions.at(-1)
  ) as AssetLibraryVersion
}

export function getAdjacentAssetVersions(
  asset: AssetLibraryAsset | null,
  versionId: string | null,
) {
  if (!asset || !versionId) {
    return {
      currentIndex: -1,
      next: null,
      previous: null,
    }
  }

  const currentIndex = asset.versions.findIndex(
    (version) => version.versionId === versionId,
  )

  return {
    currentIndex,
    next: currentIndex >= 0 ? asset.versions[currentIndex + 1] ?? null : null,
    previous: currentIndex > 0 ? asset.versions[currentIndex - 1] : null,
  }
}

export function sortLibrarySnapshot(
  snapshot: AssetLibrarySnapshot,
): AssetLibrarySnapshot {
  return {
    assets: [...snapshot.assets]
      .map((asset) => ({
        ...asset,
        versions: [...asset.versions].sort(
          (left, right) => left.versionNumber - right.versionNumber,
        ),
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  }
}

function createAssetVersionId(assetId: string, versionNumber: number) {
  return `${assetId}:v${versionNumber}`
}
