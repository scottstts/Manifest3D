import { useMemo, useSyncExternalStore } from 'react'
import type { ManifestScene } from '../engine/schema/manifestTypes'
import {
  createSceneStore,
  type SceneSnapshot,
  type SceneStore,
} from '../engine/scene/sceneStore'
import {
  createSelectionStore,
  type SelectionSnapshot,
  type SelectionStore,
} from '../engine/scene/selectionStore'
import {
  createAssetLibraryStore,
  type AssetLibraryStore,
  type AssetLibraryStoreSnapshot,
} from '../engine/persistence/assetLibraryStore'

export type AppStores = {
  assetLibraryStore: AssetLibraryStore
  sceneStore: SceneStore
  selectionStore: SelectionStore
}

const initialManifestScene: ManifestScene = {
  schemaVersion: 1,
  units: 'meters',
  assets: [],
}

export function useAppStores(): AppStores {
  return useMemo(
    () => ({
      assetLibraryStore: createAssetLibraryStore(),
      sceneStore: createSceneStore(initialManifestScene),
      selectionStore: createSelectionStore(),
    }),
    [],
  )
}

export function useAssetLibrarySnapshot(
  assetLibraryStore: AssetLibraryStore,
): AssetLibraryStoreSnapshot {
  return useSyncExternalStore(
    assetLibraryStore.subscribe,
    assetLibraryStore.getSnapshot,
    assetLibraryStore.getSnapshot,
  )
}

export function useSceneSnapshot(sceneStore: SceneStore): SceneSnapshot {
  return useSyncExternalStore(
    sceneStore.subscribe,
    sceneStore.getSnapshot,
    sceneStore.getSnapshot,
  )
}

export function useSelectionSnapshot(
  selectionStore: SelectionStore,
): SelectionSnapshot {
  return useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSnapshot,
    selectionStore.getSnapshot,
  )
}
