export type SceneSelection = {
  assetId: string | null
  partId: string | null
  targetId: string | null
}

export type SelectionSnapshot = {
  revision: number
  selection: SceneSelection
}

export type SelectionStore = {
  clearSelection: () => void
  getSnapshot: () => SelectionSnapshot
  selectAsset: (
    targetId: string,
    assetId?: string | null,
    partId?: string | null,
  ) => void
  subscribe: (listener: SelectionStoreListener) => () => void
}

export type SelectionStoreListener = () => void

const emptySelection: SceneSelection = {
  assetId: null,
  partId: null,
  targetId: null,
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
      if (snapshot.selection.targetId === null) {
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
    selectAsset(targetId, assetId = targetId, partId = null) {
      snapshot = {
        revision: snapshot.revision + 1,
        selection: {
          assetId,
          partId,
          targetId,
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
