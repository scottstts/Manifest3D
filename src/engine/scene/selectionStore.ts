export type SceneSelection = {
  assetId: string | null
  partId: string | null
}

export type SelectionSnapshot = {
  revision: number
  selection: SceneSelection
}

export type SelectionStore = {
  clearSelection: () => void
  getSnapshot: () => SelectionSnapshot
  selectAsset: (assetId: string, partId?: string | null) => void
  subscribe: (listener: SelectionStoreListener) => () => void
}

export type SelectionStoreListener = () => void

const emptySelection: SceneSelection = {
  assetId: null,
  partId: null,
}

export function createSelectionStore(
  initialSelection: SceneSelection = emptySelection,
): SelectionStore {
  let snapshot: SelectionSnapshot = {
    revision: 0,
    selection: { ...initialSelection },
  }
  const listeners = new Set<SelectionStoreListener>()

  function emit() {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    clearSelection() {
      if (snapshot.selection.assetId === null) {
        return
      }

      snapshot = {
        revision: snapshot.revision + 1,
        selection: { ...emptySelection },
      }
      emit()
    },
    getSnapshot() {
      return snapshot
    },
    selectAsset(assetId, partId = null) {
      snapshot = {
        revision: snapshot.revision + 1,
        selection: {
          assetId,
          partId,
        },
      }
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
  }
}
