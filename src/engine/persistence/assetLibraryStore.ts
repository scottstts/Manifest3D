import {
  createEmptyAssetLibrarySnapshot,
  deleteAssetLibraryAsset,
  findAssetLibraryVersion,
  saveValidatedAssetVersion,
  setLastSelectedAssetVersion,
} from './assetLibraryModel'
import {
  createIndexedDbAssetLibraryRepository,
  type AssetLibraryRepository,
} from './assetLibraryRepository'
import type {
  AssetLibrarySnapshot,
  AssetLibraryVersion,
  SaveValidatedAssetVersionInput,
} from './assetLibraryTypes'

export type AssetLibraryStoreStatus = 'loading' | 'ready' | 'error'

export type AssetLibraryStoreSnapshot = {
  error: string | null
  library: AssetLibrarySnapshot
  status: AssetLibraryStoreStatus
}

export type AssetLibraryStore = {
  getSnapshot: () => AssetLibraryStoreSnapshot
  load: () => Promise<void>
  deleteAsset: (assetId: string) => Promise<void>
  saveValidatedVersion: (
    input: SaveValidatedAssetVersionInput,
  ) => Promise<AssetLibraryVersion>
  setLastSelectedVersion: (
    assetId: string,
    versionId: string,
  ) => Promise<AssetLibraryVersion | null>
  subscribe: (listener: AssetLibraryStoreListener) => () => void
}

export type AssetLibraryStoreListener = () => void

export function createAssetLibraryStore(
  repository: AssetLibraryRepository = createIndexedDbAssetLibraryRepository(),
): AssetLibraryStore {
  let snapshot: AssetLibraryStoreSnapshot = {
    error: null,
    library: createEmptyAssetLibrarySnapshot(),
    status: 'loading',
  }
  const listeners = new Set<AssetLibraryStoreListener>()

  function emit() {
    for (const listener of listeners) {
      listener()
    }
  }

  async function persist(nextLibrary: AssetLibrarySnapshot) {
    snapshot = {
      error: null,
      library: nextLibrary,
      status: 'ready',
    }
    emit()

    try {
      await repository.saveSnapshot(nextLibrary)
    } catch (error) {
      snapshot = {
        ...snapshot,
        error:
          error instanceof Error
            ? error.message
            : 'Asset library failed to save.',
        status: 'error',
      }
      emit()
    }
  }

  return {
    getSnapshot() {
      return snapshot
    },
    async deleteAsset(assetId) {
      await persist(deleteAssetLibraryAsset(snapshot.library, assetId))
    },
    async load() {
      try {
        const library = await repository.loadSnapshot()

        snapshot = {
          error: null,
          library,
          status: 'ready',
        }
      } catch (error) {
        snapshot = {
          error:
            error instanceof Error
              ? error.message
              : 'Asset library failed to load.',
          library: createEmptyAssetLibrarySnapshot(),
          status: 'error',
        }
      }

      emit()
    },
    async saveValidatedVersion(input) {
      const result = saveValidatedAssetVersion(snapshot.library, input)

      await persist(result.snapshot)

      return result.version
    },
    async setLastSelectedVersion(assetId, versionId) {
      const library = setLastSelectedAssetVersion(
        snapshot.library,
        assetId,
        versionId,
      )
      const version = findAssetLibraryVersion(library, assetId, versionId)

      if (!version) {
        return null
      }

      await persist(library)

      return version
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
  }
}
