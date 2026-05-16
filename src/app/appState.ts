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

export type AppStores = {
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
      sceneStore: createSceneStore(initialManifestScene),
      selectionStore: createSelectionStore(),
    }),
    [],
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
