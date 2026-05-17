import * as THREE from 'three/webgpu'
import {
  buildManifestAsset,
  disposeManifestObject,
} from '../geometry/assetBuilder'
import type { ManifestAsset } from '../schema/manifestTypes'

export type GlbExportResult = {
  arrayBuffer: ArrayBuffer
  blob: Blob
  fileName: string
}

const helperObjectTypes = new Set([
  'ArrowHelper',
  'AxesHelper',
  'Box3Helper',
  'BoxHelper',
  'CameraHelper',
  'DirectionalLightHelper',
  'GridHelper',
  'HemisphereLightHelper',
  'PlaneHelper',
  'PointLightHelper',
  'PolarGridHelper',
  'SkeletonHelper',
  'SpotLightHelper',
])

export async function exportManifestAssetGlb(
  asset: ManifestAsset,
): Promise<GlbExportResult> {
  const exportRoot = createExportableManifestAssetGroup(asset)

  try {
    const { GLTFExporter } = await import(
      'three/examples/jsm/exporters/GLTFExporter.js'
    )
    const gltf = await new GLTFExporter().parseAsync(exportRoot, {
      binary: true,
      includeCustomExtensions: false,
      onlyVisible: true,
      trs: true,
    })

    if (!(gltf instanceof ArrayBuffer)) {
      throw new Error('GLB export did not produce binary output.')
    }

    return {
      arrayBuffer: gltf,
      blob: new Blob([gltf], { type: 'model/gltf-binary' }),
      fileName: createGlbFileName(asset),
    }
  } finally {
    disposeManifestObject(exportRoot)
  }
}

export function createExportableManifestAssetGroup(asset: ManifestAsset) {
  const builtAsset = buildManifestAsset(asset)

  try {
    const exportRoot = cloneExportableObject(builtAsset.group)

    exportRoot.name = asset.name
    exportRoot.updateMatrixWorld(true)

    if (countExportableMeshes(exportRoot) === 0) {
      throw new Error(`Asset "${asset.id}" contains no exportable mesh geometry.`)
    }

    return exportRoot
  } finally {
    disposeManifestObject(builtAsset.group)
  }
}

export function cloneExportableObject(source: THREE.Object3D) {
  const clone = source.clone(true)

  pruneNonExportableChildren(clone)
  clone.traverse((object) => {
    sanitizeObjectForExport(object)

    if (isMesh(object)) {
      object.geometry = object.geometry.clone()
      object.geometry.userData = {}
      object.material = cloneExportMaterial(object.material)
    }
  })

  return clone
}

export function countExportableMeshes(root: THREE.Object3D) {
  let meshCount = 0

  root.traverse((object) => {
    if (isMesh(object)) {
      meshCount += 1
    }
  })

  return meshCount
}

export function createGlbFileName(asset: Pick<ManifestAsset, 'id' | 'name'>) {
  const nameSlug = slugifyFileNamePart(asset.name)
  const idSlug = slugifyFileNamePart(asset.id)
  const baseName = nameSlug || idSlug || 'manifest3d-asset'

  return `${baseName}.glb`
}

export function downloadGlbExport(result: GlbExportResult) {
  const href = URL.createObjectURL(result.blob)
  const link = document.createElement('a')

  link.href = href
  link.download = result.fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 0)
}

function pruneNonExportableChildren(object: THREE.Object3D) {
  for (const child of [...object.children]) {
    if (isNonExportableObject(child)) {
      object.remove(child)
      continue
    }

    pruneNonExportableChildren(child)
  }
}

function isNonExportableObject(object: THREE.Object3D) {
  if (
    object.userData.manifest3dExportable === false ||
    object.userData.exportable === false
  ) {
    return true
  }

  if (helperObjectTypes.has(object.type)) {
    return true
  }

  return (
    isCamera(object) ||
    isLight(object) ||
    isLine(object) ||
    isPoints(object) ||
    isSprite(object)
  )
}

function sanitizeObjectForExport(object: THREE.Object3D) {
  object.userData = {}
}

function cloneExportMaterial(
  material: THREE.Material | THREE.Material[],
): THREE.Material | THREE.Material[] {
  return Array.isArray(material)
    ? material.map(cloneExportMaterialInstance)
    : cloneExportMaterialInstance(material)
}

function cloneExportMaterialInstance(material: THREE.Material) {
  const clonedMaterial = isMeshStandardMaterial(material) && !isNodeMaterial(material)
    ? material.clone()
    : new THREE.MeshStandardMaterial({
        color: readMaterialColor(material),
        metalness: readMaterialNumber(material, 'metalness', 0),
        opacity: readMaterialNumber(material, 'opacity', 1),
        roughness: readMaterialNumber(material, 'roughness', 0.7),
        side: material.side,
        transparent: readMaterialBoolean(material, 'transparent', false),
      })

  clonedMaterial.name = material.name
  clonedMaterial.userData = {}

  return clonedMaterial
}

function readMaterialColor(material: THREE.Material) {
  const color = (material as { color?: unknown }).color

  return color instanceof THREE.Color ? color : new THREE.Color('#ffffff')
}

function readMaterialNumber(
  material: THREE.Material,
  key: 'metalness' | 'opacity' | 'roughness',
  fallback: number,
) {
  const value = (material as unknown as Record<typeof key, unknown>)[key]

  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readMaterialBoolean(
  material: THREE.Material,
  key: 'transparent',
  fallback: boolean,
) {
  const value = (material as unknown as Record<typeof key, unknown>)[key]

  return typeof value === 'boolean' ? value : fallback
}

function slugifyFileNamePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true
}

function isCamera(object: THREE.Object3D): object is THREE.Camera {
  return (object as THREE.Camera).isCamera === true
}

function isLight(object: THREE.Object3D): object is THREE.Light {
  return (object as THREE.Light).isLight === true
}

function isLine(object: THREE.Object3D): object is THREE.Line {
  return (object as THREE.Line).isLine === true
}

function isPoints(object: THREE.Object3D): object is THREE.Points {
  return (object as THREE.Points).isPoints === true
}

function isSprite(object: THREE.Object3D): object is THREE.Sprite {
  return (object as THREE.Sprite).isSprite === true
}

function isMeshStandardMaterial(
  material: THREE.Material,
): material is THREE.MeshStandardMaterial {
  return (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true
}

function isNodeMaterial(material: THREE.Material) {
  return (
    (material as { isNodeMaterial?: boolean }).isNodeMaterial === true ||
    (material as { isMeshStandardNodeMaterial?: boolean })
      .isMeshStandardNodeMaterial === true
  )
}
