import {
  createEmptyAssetLibrarySnapshot,
  deleteAssetLibraryAsset,
  saveAssetLibraryAsset,
  sortLibrarySnapshot,
} from './assetLibraryModel'
import type {
  AssetLibraryAsset,
  AssetLibrarySnapshot,
  AssetLibraryVersion,
  PersistedCandidateAttempt,
} from './assetLibraryTypes'

export type AssetLibraryRepository = {
  deleteAsset: (assetId: string) => Promise<void>
  loadSnapshot: () => Promise<AssetLibrarySnapshot>
  saveAsset: (asset: AssetLibraryAsset) => Promise<void>
}

type AssetRecordRow = Omit<AssetLibraryAsset, 'versions'> & {
  versionIds: string[]
}

type VersionRow = Omit<AssetLibraryVersion, 'attempts'> & {
  attemptIds: string[]
}

const databaseName = 'manifest3d-library'
const databaseVersion = 1
const assetStoreName = 'assets'
const versionStoreName = 'versions'
const attemptStoreName = 'attempts'

export function createIndexedDbAssetLibraryRepository(): AssetLibraryRepository {
  if (typeof indexedDB === 'undefined') {
    return createMemoryAssetLibraryRepository()
  }

  return {
    async deleteAsset(assetId) {
      const database = await openAssetLibraryDatabase()

      try {
        await deleteAssetRows(database, assetId)
      } finally {
        database.close()
      }
    },
    async loadSnapshot() {
      const database = await openAssetLibraryDatabase()

      try {
        const [assetRows, versionRows, attemptRows] = await Promise.all([
          getAllRows<AssetRecordRow>(database, assetStoreName),
          getAllRows<VersionRow>(database, versionStoreName),
          getAllRows<PersistedCandidateAttempt>(database, attemptStoreName),
        ])

        return assembleSnapshot(assetRows, versionRows, attemptRows)
      } finally {
        database.close()
      }
    },
    async saveAsset(asset) {
      const database = await openAssetLibraryDatabase()

      try {
        await writeAsset(database, asset)
      } finally {
        database.close()
      }
    },
  }
}

export function createMemoryAssetLibraryRepository(
  initialSnapshot: AssetLibrarySnapshot = createEmptyAssetLibrarySnapshot(),
): AssetLibraryRepository {
  let snapshot = initialSnapshot

  return {
    async deleteAsset(assetId) {
      snapshot = deleteAssetLibraryAsset(snapshot, assetId)
    },
    async loadSnapshot() {
      return snapshot
    },
    async saveAsset(asset) {
      snapshot = saveAssetLibraryAsset(snapshot, asset)
    },
  }
}

function openAssetLibraryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)

    request.addEventListener('upgradeneeded', () => {
      const database = request.result

      if (!database.objectStoreNames.contains(assetStoreName)) {
        database.createObjectStore(assetStoreName, {
          keyPath: 'assetId',
        })
      }

      if (!database.objectStoreNames.contains(versionStoreName)) {
        const versionStore = database.createObjectStore(versionStoreName, {
          keyPath: 'versionId',
        })

        versionStore.createIndex('assetId', 'assetId')
      }

      if (!database.objectStoreNames.contains(attemptStoreName)) {
        const attemptStore = database.createObjectStore(attemptStoreName, {
          keyPath: 'id',
        })

        attemptStore.createIndex('assetId', 'assetId')
        attemptStore.createIndex('versionId', 'versionId')
      }
    })
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('Asset library database failed to open.'))
    })
  })
}

function getAllRows<T>(
  database: IDBDatabase,
  storeName: string,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly')
    const store = transaction.objectStore(storeName)
    const request = store.getAll()

    request.addEventListener('success', () => resolve(request.result as T[]))
    request.addEventListener('error', () => {
      reject(request.error ?? new Error(`Failed to read ${storeName}.`))
    })
  })
}

function writeAsset(
  database: IDBDatabase,
  asset: AssetLibraryAsset,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [assetStoreName, versionStoreName, attemptStoreName],
      'readwrite',
    )
    const assetStore = transaction.objectStore(assetStoreName)
    const versionStore = transaction.objectStore(versionStoreName)
    const attemptStore = transaction.objectStore(attemptStoreName)
    const { versions, ...assetRecord } = asset

    assetStore.put({
      ...assetRecord,
      versionIds: versions.map((version) => version.versionId),
    } satisfies AssetRecordRow)

    for (const version of versions) {
      const { attempts, ...versionRecord } = version

      versionStore.put({
        ...versionRecord,
        attemptIds: attempts.map((attempt) => attempt.id),
      } satisfies VersionRow)

      for (const attempt of attempts) {
        attemptStore.put(attempt)
      }
    }

    transaction.addEventListener('complete', () => resolve())
    transaction.addEventListener('error', () => {
      reject(
        transaction.error ?? new Error('Asset library asset failed to save.'),
      )
    })
  })
}

function deleteAssetRows(
  database: IDBDatabase,
  assetId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [assetStoreName, versionStoreName, attemptStoreName],
      'readwrite',
    )
    const assetStore = transaction.objectStore(assetStoreName)
    const versionStore = transaction.objectStore(versionStoreName)
    const attemptStore = transaction.objectStore(attemptStoreName)
    const versionAssetIndex = versionStore.index('assetId')
    const attemptAssetIndex = attemptStore.index('assetId')

    assetStore.delete(assetId)

    const versionKeysRequest = versionAssetIndex.getAllKeys(assetId)

    versionKeysRequest.addEventListener('success', () => {
      for (const versionKey of versionKeysRequest.result) {
        versionStore.delete(versionKey)
      }
    })

    const attemptKeysRequest = attemptAssetIndex.getAllKeys(assetId)

    attemptKeysRequest.addEventListener('success', () => {
      for (const attemptKey of attemptKeysRequest.result) {
        attemptStore.delete(attemptKey)
      }
    })

    transaction.addEventListener('complete', () => resolve())
    transaction.addEventListener('error', () => {
      reject(
        transaction.error ?? new Error('Asset library asset failed to delete.'),
      )
    })
  })
}

function assembleSnapshot(
  assetRows: readonly AssetRecordRow[],
  versionRows: readonly VersionRow[],
  attemptRows: readonly PersistedCandidateAttempt[],
): AssetLibrarySnapshot {
  const versionsById = new Map<string, VersionRow>()
  const attemptsById = new Map<string, PersistedCandidateAttempt>()

  for (const version of versionRows) {
    versionsById.set(version.versionId, version)
  }

  for (const attempt of attemptRows) {
    attemptsById.set(attempt.id, attempt)
  }

  return sortLibrarySnapshot({
    assets: assetRows.map((assetRow) => {
      const versions: AssetLibraryVersion[] = assetRow.versionIds
        .map((versionId) => versionsById.get(versionId))
        .filter((version): version is VersionRow => Boolean(version))
        .map((version) => ({
          ...version,
          attempts: version.attemptIds
            .map((attemptId) => attemptsById.get(attemptId))
            .filter(
              (attempt): attempt is PersistedCandidateAttempt =>
                Boolean(attempt),
            ),
        }))
      return {
        assetId: assetRow.assetId,
        createdAt: assetRow.createdAt,
        lastSelectedVersionId: assetRow.lastSelectedVersionId,
        name: assetRow.name,
        updatedAt: assetRow.updatedAt,
        versions,
      }
    }),
  })
}
