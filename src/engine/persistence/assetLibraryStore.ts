import {
  createEmptyAssetLibrarySnapshot,
  deleteAssetLibraryAsset,
  findAssetLibraryVersion,
  saveAssetLibraryAsset,
  saveValidatedAssetVersion,
  setLastSelectedAssetVersion,
} from './assetLibraryModel'
import {
  createIndexedDbAssetLibraryRepository,
  type AssetLibraryRepository,
} from './assetLibraryRepository'
import type {
  AssetLibraryAsset,
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

  function setReadyLibrary(library: AssetLibrarySnapshot) {
    snapshot = {
      error: null,
      library,
      status: 'ready',
    }
    emit()
  }

  function setPersistError(error: unknown, fallbackMessage: string) {
    snapshot = {
      ...snapshot,
      error: error instanceof Error ? error.message : fallbackMessage,
      status: 'error',
    }
    emit()
  }

  async function persistAsset(asset: AssetLibraryAsset) {
    setReadyLibrary(saveAssetLibraryAsset(snapshot.library, asset))

    try {
      await repository.saveAsset(asset)
    } catch (error) {
      setPersistError(error, 'Asset library failed to save.')
    }
  }

  async function persistDelete(assetId: string) {
    setReadyLibrary(deleteAssetLibraryAsset(snapshot.library, assetId))

    try {
      await repository.deleteAsset(assetId)
    } catch (error) {
      setPersistError(error, 'Asset library failed to delete.')
    }
  }

  return {
    getSnapshot() {
      return snapshot
    },
    async deleteAsset(assetId) {
      await persistDelete(assetId)
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
      let baseLibrary = snapshot.library

      try {
        baseLibrary = await repository.loadSnapshot()
        snapshot = {
          error: null,
          library: baseLibrary,
          status: 'ready',
        }
      } catch {
        // Keep the optimistic in-memory library if the pre-save refresh fails.
      }

      const result = saveValidatedAssetVersion(baseLibrary, input)

      await persistAsset(result.asset)

      return result.version
    },
    async setLastSelectedVersion(assetId, versionId) {
      const library = setLastSelectedAssetVersion(
        snapshot.library,
        assetId,
        versionId,
      )
      const version = findAssetLibraryVersion(library, assetId, versionId)
      const asset = library.assets.find((candidate) => candidate.assetId === assetId)

      if (!version || !asset) {
        return null
      }

      await persistAsset(asset)

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
