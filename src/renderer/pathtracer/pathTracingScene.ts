import * as THREE from 'three'
import { GradientEquirectTexture } from 'three-gpu-pathtracer'
import {
  applyBuiltManifestJointPoses,
  applyBuiltManifestMaterialAnimations,
  buildManifestAsset,
  disposeManifestObject,
} from '../../engine/geometry/assetBuilder'
import type { JointPoseValues } from '../../engine/geometry/jointPoses'
import type { MaterialAnimationValues } from '../../engine/geometry/materialAnimations'
import type { SceneAssetInstance } from '../../engine/scene/sceneStore'
import {
  getViewportWorldEnvironment,
  type ViewportWorldMode,
} from '../viewportWorld'
import { pathTracingViewportConfig } from './pathTracingConfig'

type BuiltPathTracingAssetHandle = {
  object: THREE.Object3D
  sourceObject: THREE.Object3D
}

type PathTracingMaterialOptions = {
  emissionGain?: number
}

type MeshLike = THREE.Object3D & {
  geometry: THREE.BufferGeometry
  isMesh: true
  material: THREE.Material | THREE.Material[]
}

type MaterialWithCommonPbrFields = THREE.Material & {
  alphaMap?: THREE.Texture | null
  alphaTest?: number
  aoMap?: THREE.Texture | null
  color?: THREE.Color
  emissive?: THREE.Color
  emissiveIntensity?: number
  envMap?: THREE.Texture | null
  map?: THREE.Texture | null
  metalness?: number
  metalnessMap?: THREE.Texture | null
  normalMap?: THREE.Texture | null
  opacity: number
  roughness?: number
  roughnessMap?: THREE.Texture | null
  side: THREE.Side
  transparent: boolean
}

const defaultJointPoseValues: JointPoseValues = {}
const defaultMaterialAnimationValues: MaterialAnimationValues = {}
const pathTracingBloomRoleUserDataKey = 'manifest3dPathTracingBloomRole'

export function rebuildPathTracingViewportScene({
  assets,
  jointPreviewPosesByInstance,
  materialAnimationValuesByInstance,
  scene,
  worldMode,
}: {
  assets: readonly SceneAssetInstance[]
  jointPreviewPosesByInstance: Readonly<Record<string, JointPoseValues>>
  materialAnimationValuesByInstance: Readonly<Record<string, MaterialAnimationValues>>
  scene: THREE.Scene
  worldMode: ViewportWorldMode
}) {
  clearPathTracingScene(scene)
  addPathTracingViewportWorld(scene, worldMode)

  const assetHandles = assets.map((asset) =>
    addPathTracingAssetToScene(scene, asset, {
      jointPreviewPoses:
        jointPreviewPosesByInstance[asset.instanceId] ?? defaultJointPoseValues,
      materialAnimationValues:
        materialAnimationValuesByInstance[asset.instanceId] ??
        defaultMaterialAnimationValues,
    }),
  )

  scene.updateMatrixWorld(true)

  return () => {
    for (const handle of assetHandles) {
      scene.remove(handle.object)
      disposeManifestObject(handle.sourceObject as never)
    }

    clearPathTracingScene(scene)
  }
}

export function createPathTracingStandardMaterial(
  sourceMaterial: THREE.Material,
  { emissionGain = pathTracingViewportConfig.emissionGain }: PathTracingMaterialOptions = {},
) {
  const source = sourceMaterial as MaterialWithCommonPbrFields
  const emissiveColor = cloneColor(source.emissive, '#000000')
  const emissiveIntensity = isBlackColor(emissiveColor)
    ? 0
    : (source.emissiveIntensity ?? 0) * emissionGain
  const material = new THREE.MeshStandardMaterial({
    alphaMap: source.alphaMap ?? null,
    alphaTest: source.alphaTest ?? 0,
    aoMap: source.aoMap ?? null,
    color: cloneColor(source.color, '#ffffff'),
    emissive: emissiveColor,
    emissiveIntensity,
    envMap: source.envMap ?? null,
    map: source.map ?? null,
    metalness: source.metalness ?? 0,
    metalnessMap: source.metalnessMap ?? null,
    name: source.name,
    normalMap: source.normalMap ?? null,
    opacity: source.opacity,
    roughness: source.roughness ?? 1,
    roughnessMap: source.roughnessMap ?? null,
    side: source.side,
    transparent: source.transparent || source.opacity < 1,
  })

  material.depthTest = source.depthTest
  material.depthWrite = source.depthWrite
  material.visible = source.visible

  return material
}

export function convertManifestGroupMaterialsForPathTracing(
  object: THREE.Object3D,
  options: PathTracingMaterialOptions = {},
) {
  const convertedMaterials = new Map<THREE.Material, THREE.MeshStandardMaterial>()
  const sourceMaterials = new Set<THREE.Material>()

  object.traverse((child) => {
    if (!isMeshLike(child)) {
      return
    }

    if (Array.isArray(child.material)) {
      child.material = child.material.map((material) => {
        sourceMaterials.add(material)
        return getConvertedMaterial(material, convertedMaterials, options)
      })
      return
    }

    sourceMaterials.add(child.material)
    child.material = getConvertedMaterial(
      child.material,
      convertedMaterials,
      options,
    )
  })

  for (const material of sourceMaterials) {
    material.dispose()
  }

  return [...convertedMaterials.values()]
}

function addPathTracingViewportWorld(
  scene: THREE.Scene,
  mode: ViewportWorldMode,
) {
  const environment = getViewportWorldEnvironment(mode)

  scene.background = new THREE.Color(environment.backgroundColor)
  scene.fog = new THREE.FogExp2(environment.fog.color, environment.fog.density)

  const hemisphere = new THREE.HemisphereLight(
    environment.lights.hemisphere.skyColor,
    environment.lights.hemisphere.groundColor,
    environment.lights.hemisphere.intensity,
  )
  scene.add(hemisphere)
  scene.environment = createPathTracingFillEnvironment(mode)
  scene.environmentIntensity =
    environment.lights.fill.intensity *
    pathTracingViewportConfig.environmentFillIntensity

  const key = new THREE.DirectionalLight(
    environment.lights.key.color,
    environment.lights.key.intensity,
  )
  key.name = 'Manifest3D path tracing key directional light'
  key.position.set(...environment.lights.key.position)
  key.castShadow = true
  scene.add(key)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshStandardMaterial({
      color: environment.ground.color,
      metalness: environment.ground.metalness,
      roughness: environment.ground.roughness,
    }),
  )
  ground.name = 'Manifest3D path tracing ground plane'
  ground.receiveShadow = true
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)
}

function createPathTracingFillEnvironment(mode: ViewportWorldMode) {
  const environment = getViewportWorldEnvironment(mode)
  const fillEnvironment = new GradientEquirectTexture(32)

  fillEnvironment.topColor.set(environment.lights.hemisphere.skyColor)
  fillEnvironment.bottomColor
    .set(environment.ground.color)
    .lerp(new THREE.Color(environment.lights.fill.color), 0.35)
  fillEnvironment.exponent = 1.7
  fillEnvironment.update()

  return fillEnvironment
}

function addPathTracingAssetToScene(
  scene: THREE.Scene,
  instance: SceneAssetInstance,
  {
    jointPreviewPoses,
    materialAnimationValues,
  }: {
    jointPreviewPoses: JointPoseValues
    materialAnimationValues: MaterialAnimationValues
  },
): BuiltPathTracingAssetHandle {
  const builtAsset = buildManifestAsset(instance.asset)

  applyBuiltManifestJointPoses(builtAsset, jointPreviewPoses)
  applyBuiltManifestMaterialAnimations(builtAsset, materialAnimationValues)
  convertManifestGroupMaterialsForPathTracing(
    builtAsset.group as unknown as THREE.Object3D,
  )

  const localPlacement = computeLocalPlacement(
    builtAsset.group as unknown as THREE.Object3D,
  )
  const assetRoot = new THREE.Group()
  const centeredAsset = new THREE.Group()

  assetRoot.name = `${instance.asset.name} path tracing viewport root`
  assetRoot.userData[pathTracingBloomRoleUserDataKey] = 'asset'
  assetRoot.position.set(
    instance.transform.position[0] + localPlacement.anchorOffset.x,
    instance.transform.position[1] + localPlacement.anchorOffset.y,
    instance.transform.position[2] + localPlacement.anchorOffset.z,
  )
  assetRoot.rotation.set(...instance.transform.rotation)
  assetRoot.scale.set(...instance.transform.scale)
  centeredAsset.position.copy(localPlacement.center).multiplyScalar(-1)
  centeredAsset.add(builtAsset.group as unknown as THREE.Object3D)
  assetRoot.add(centeredAsset)
  scene.add(assetRoot)

  return {
    object: assetRoot,
    sourceObject: builtAsset.group as unknown as THREE.Object3D,
  }
}

function clearPathTracingScene(scene: THREE.Scene) {
  for (const child of [...scene.children]) {
    scene.remove(child)
    disposeObjectTree(child)
  }

  if (isTextureLike(scene.background)) {
    scene.background.dispose()
  }

  if (isTextureLike(scene.environment)) {
    scene.environment.dispose()
  }

  scene.background = null
  scene.environment = null
  scene.environmentIntensity = 1
  scene.fog = null
}


function isTextureLike(value: unknown): value is THREE.Texture {
  return Boolean((value as THREE.Texture | null)?.isTexture)
}

function disposeObjectTree(object: THREE.Object3D) {
  object.traverse((child) => {
    if (isMeshLike(child)) {
      child.geometry.dispose()

      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material]

      for (const material of materials) {
        material.dispose()
      }
    }
  })
}

function computeLocalPlacement(object: THREE.Object3D) {
  object.updateWorldMatrix(true, true)

  const bounds = new THREE.Box3().setFromObject(object)

  if (bounds.isEmpty()) {
    const center = new THREE.Vector3()

    return {
      anchorOffset: center.clone(),
      center,
    }
  }

  const center = bounds.getCenter(new THREE.Vector3())
  const anchorOffset = center.clone()

  anchorOffset.y -= bounds.min.y

  return {
    anchorOffset,
    center,
  }
}

function getConvertedMaterial(
  material: THREE.Material,
  convertedMaterials: Map<THREE.Material, THREE.MeshStandardMaterial>,
  options: PathTracingMaterialOptions,
) {
  const convertedMaterial = convertedMaterials.get(material)

  if (convertedMaterial) {
    return convertedMaterial
  }

  const nextMaterial = createPathTracingStandardMaterial(material, options)

  convertedMaterials.set(material, nextMaterial)

  return nextMaterial
}

function cloneColor(colorValue: THREE.Color | undefined, fallback: string) {
  if (colorValue?.isColor) {
    return colorValue.clone()
  }

  return new THREE.Color(fallback)
}

function isBlackColor(color: THREE.Color) {
  return color.r <= 1e-6 && color.g <= 1e-6 && color.b <= 1e-6
}

function isMeshLike(object: THREE.Object3D): object is MeshLike {
  return (object as MeshLike).isMesh === true
}

export function isPathTracingAssetBloomObject(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object

  while (current) {
    if (current.userData[pathTracingBloomRoleUserDataKey] === 'asset') {
      return true
    }

    current = current.parent
  }

  return false
}
