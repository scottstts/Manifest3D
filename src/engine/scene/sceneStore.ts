import type { ManifestAsset, ManifestScene } from '../schema/manifestTypes'

export type SceneSnapshot = {
  scene: ManifestScene
}

export type SceneStore = {
  clearAssets: () => void
  getAsset: (assetId: string) => ManifestAsset | undefined
  getSnapshot: () => SceneSnapshot
  removeAsset: (assetId: string) => void
  setScene: (scene: ManifestScene) => void
  subscribe: (listener: SceneStoreListener) => () => void
  upsertAsset: (asset: ManifestAsset) => void
}

export type SceneStoreListener = () => void

export function createSceneStore(initialScene: ManifestScene): SceneStore {
  let snapshot: SceneSnapshot = {
    scene: cloneScene(initialScene),
  }
  const listeners = new Set<SceneStoreListener>()

  function emit() {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    clearAssets() {
      snapshot = {
        scene: {
          ...snapshot.scene,
          assets: [],
        },
      }
      emit()
    },
    getAsset(assetId) {
      return snapshot.scene.assets.find((asset) => asset.id === assetId)
    },
    getSnapshot() {
      return snapshot
    },
    removeAsset(assetId) {
      snapshot = {
        scene: {
          ...snapshot.scene,
          assets: snapshot.scene.assets.filter((asset) => asset.id !== assetId),
        },
      }
      emit()
    },
    setScene(scene) {
      snapshot = {
        scene: cloneScene(scene),
      }
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    upsertAsset(asset) {
      const assetIndex = snapshot.scene.assets.findIndex(
        (candidate) => candidate.id === asset.id,
      )
      const nextAssets =
        assetIndex === -1
          ? [...snapshot.scene.assets, asset]
          : snapshot.scene.assets.map((candidate, index) =>
              index === assetIndex ? asset : candidate,
            )

      snapshot = {
        scene: {
          ...snapshot.scene,
          assets: nextAssets,
        },
      }
      emit()
    },
  }
}

function cloneScene(scene: ManifestScene): ManifestScene {
  return {
    ...scene,
    assets: [...scene.assets],
  }
}
