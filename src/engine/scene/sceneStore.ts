import type {
  ManifestAsset,
  ManifestScene,
  ManifestVector3,
} from '../schema/manifestTypes'

export type WorkspaceMode = 'create' | 'compose'

export type SceneTransform = {
  position: ManifestVector3
  rotation: ManifestVector3
  scale: ManifestVector3
}

export type SceneAssetInstance = {
  asset: ManifestAsset
  assetId: string
  instanceId: string
  transform: SceneTransform
  versionId: string | null
}

export type SceneSnapshot = {
  activeWorkspace: WorkspaceMode
  composeInstances: readonly SceneAssetInstance[]
  createInstance: SceneAssetInstance | null
  renderableAssets: readonly SceneAssetInstance[]
  scene: ManifestScene
}

export type SceneStore = {
  addComposeAsset: (
    asset: ManifestAsset,
    versionId?: string | null,
  ) => SceneAssetInstance
  clearAssets: () => void
  clearCreateAsset: () => void
  duplicateComposeInstance: (instanceId: string) => SceneAssetInstance | null
  getAsset: (assetId: string) => ManifestAsset | undefined
  getInstance: (instanceId: string) => SceneAssetInstance | undefined
  getSnapshot: () => SceneSnapshot
  removeAsset: (assetId: string) => void
  removeComposeInstance: (instanceId: string) => void
  setComposeInstanceVersion: (
    instanceId: string,
    asset: ManifestAsset,
    versionId: string | null,
  ) => void
  setComposeInstances: (instances: readonly SceneAssetInstance[]) => void
  setCreateAsset: (asset: ManifestAsset, versionId?: string | null) => void
  setCreateAssetVersionId: (assetId: string, versionId: string | null) => void
  setScene: (scene: ManifestScene) => void
  setWorkspace: (workspace: WorkspaceMode) => void
  subscribe: (listener: SceneStoreListener) => () => void
  updateComposeInstanceTransform: (
    instanceId: string,
    transform: SceneTransform,
  ) => void
  upsertAsset: (asset: ManifestAsset) => void
}

export type SceneStoreListener = () => void

const identityTransform: SceneTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
}

export function createSceneStore(initialScene: ManifestScene): SceneStore {
  let instanceCounter = 0
  let createInstance = initialScene.assets[0]
    ? createSceneAssetInstance(initialScene.assets[0], null, 'create')
    : null
  let composeInstances: SceneAssetInstance[] = []
  let activeWorkspace: WorkspaceMode = 'create'
  let snapshot = createSnapshot(activeWorkspace, createInstance, composeInstances)
  const listeners = new Set<SceneStoreListener>()

  function emit() {
    snapshot = createSnapshot(activeWorkspace, createInstance, composeInstances)

    for (const listener of listeners) {
      listener()
    }
  }

  function nextComposeInstanceId(assetId: string) {
    instanceCounter += 1

    return `${assetId}:instance:${instanceCounter}`
  }

  function createSceneAssetInstance(
    asset: ManifestAsset,
    versionId: string | null,
    instanceId: string,
    transform: SceneTransform = identityTransform,
  ): SceneAssetInstance {
    return {
      asset,
      assetId: asset.id,
      instanceId,
      transform: cloneTransform(transform),
      versionId,
    }
  }

  return {
    addComposeAsset(asset, versionId = null) {
      const instance = createSceneAssetInstance(
        asset,
        versionId,
        nextComposeInstanceId(asset.id),
      )

      composeInstances = [...composeInstances, instance]
      emit()

      return instance
    },
    clearAssets() {
      createInstance = null
      composeInstances = []
      emit()
    },
    clearCreateAsset() {
      createInstance = null
      emit()
    },
    duplicateComposeInstance(instanceId) {
      const sourceInstance = composeInstances.find(
        (instance) => instance.instanceId === instanceId,
      )

      if (!sourceInstance) {
        return null
      }

      const duplicate = createSceneAssetInstance(
        sourceInstance.asset,
        sourceInstance.versionId,
        nextComposeInstanceId(sourceInstance.assetId),
        {
          ...sourceInstance.transform,
          position: [
            sourceInstance.transform.position[0] + 0.35,
            sourceInstance.transform.position[1],
            sourceInstance.transform.position[2] + 0.12,
          ],
        },
      )

      composeInstances = [...composeInstances, duplicate]
      emit()

      return duplicate
    },
    getAsset(assetId) {
      return getAllInstances(createInstance, composeInstances).find(
        (instance) => instance.assetId === assetId,
      )?.asset
    },
    getInstance(instanceId) {
      return getAllInstances(createInstance, composeInstances).find(
        (instance) => instance.instanceId === instanceId,
      )
    },
    getSnapshot() {
      return snapshot
    },
    removeAsset(assetId) {
      if (createInstance?.assetId === assetId) {
        createInstance = null
      }

      composeInstances = composeInstances.filter(
        (instance) => instance.assetId !== assetId,
      )
      emit()
    },
    removeComposeInstance(instanceId) {
      composeInstances = composeInstances.filter(
        (instance) => instance.instanceId !== instanceId,
      )
      emit()
    },
    setComposeInstanceVersion(instanceId, asset, versionId) {
      composeInstances = composeInstances.map((instance) =>
        instance.instanceId === instanceId
          ? {
              ...instance,
              asset,
              assetId: asset.id,
              versionId,
            }
          : instance,
      )
      emit()
    },
    setComposeInstances(instances) {
      composeInstances = instances.map(cloneSceneAssetInstance)
      emit()
    },
    setCreateAsset(asset, versionId = null) {
      createInstance = createSceneAssetInstance(asset, versionId, 'create')
      emit()
    },
    setCreateAssetVersionId(assetId, versionId) {
      if (!createInstance || createInstance.assetId !== assetId) {
        return
      }

      createInstance = {
        ...createInstance,
        versionId,
      }
      emit()
    },
    setScene(scene) {
      createInstance = scene.assets[0]
        ? createSceneAssetInstance(scene.assets[0], null, 'create')
        : null
      activeWorkspace = 'create'
      emit()
    },
    setWorkspace(workspace) {
      activeWorkspace = workspace
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    updateComposeInstanceTransform(instanceId, transform) {
      composeInstances = composeInstances.map((instance) =>
        instance.instanceId === instanceId
          ? {
              ...instance,
              transform: cloneTransform(transform),
            }
          : instance,
      )
      emit()
    },
    upsertAsset(asset) {
      createInstance = createSceneAssetInstance(asset, null, 'create')
      activeWorkspace = 'create'
      emit()
    },
  }
}

function cloneSceneAssetInstance(instance: SceneAssetInstance): SceneAssetInstance {
  return {
    ...instance,
    transform: cloneTransform(instance.transform),
  }
}

function createSnapshot(
  activeWorkspace: WorkspaceMode,
  createInstance: SceneAssetInstance | null,
  composeInstances: readonly SceneAssetInstance[],
): SceneSnapshot {
  const renderableAssets =
    activeWorkspace === 'create'
      ? createInstance
        ? [createInstance]
        : []
      : composeInstances

  return {
    activeWorkspace,
    composeInstances: [...composeInstances],
    createInstance,
    renderableAssets,
    scene: {
      assets: renderableAssets.map((instance) => instance.asset),
      schemaVersion: 1,
      units: 'meters',
    },
  }
}

function getAllInstances(
  createInstance: SceneAssetInstance | null,
  composeInstances: readonly SceneAssetInstance[],
) {
  return [...(createInstance ? [createInstance] : []), ...composeInstances]
}

function cloneTransform(transform: SceneTransform): SceneTransform {
  return {
    position: [
      transform.position[0],
      transform.position[1],
      transform.position[2],
    ],
    rotation: [
      transform.rotation[0],
      transform.rotation[1],
      transform.rotation[2],
    ],
    scale: [transform.scale[0], transform.scale[1], transform.scale[2]],
  }
}
