import * as THREE from 'three/webgpu'
import {
  buildManifestAsset,
  disposeManifestObject,
} from '../geometry/assetBuilder'
import { hasMaterialEmissionAnimation } from '../geometry/materialAnimations'
import {
  applyManifestTransform,
  getDefaultJointControlValue,
  getJointPreviewControls,
  getMovableJoints,
  getNormalizedJointAxis,
  normalizeJointControlValue,
  normalizeJointPoseValue,
  resolveJointControlPoseValues,
  type JointPreviewControl,
} from '../geometry/jointPoses'
import type { ManifestAsset, ManifestJoint } from '../schema/manifestTypes'
import { appendMaterialEmissionAnimationsToGlb } from './gltfMaterialAnimation'

export type GlbExportResult = {
  arrayBuffer: ArrayBuffer
  blob: Blob
  fileName: string
}

export type GlbExportMode = 'static' | 'dynamic'

export type ExportManifestAssetGlbOptions = {
  mode?: GlbExportMode
}

type ExportableManifestAsset = {
  animations: THREE.AnimationClip[]
  root: THREE.Object3D
}

type CloneExportableObjectOptions = {
  clonedObjects?: Map<THREE.Object3D, THREE.Object3D>
}

type ControlAnimationKeyframe = {
  controlValue: number
  time: number
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
  options: ExportManifestAssetGlbOptions = {},
): Promise<GlbExportResult> {
  const exportableAsset = createExportableManifestAsset(
    asset,
    options.mode ?? 'static',
  )

  try {
    const { GLTFExporter } = await import(
      'three/examples/jsm/exporters/GLTFExporter.js'
    )
    let gltf = await new GLTFExporter().parseAsync(exportableAsset.root, {
      animations: exportableAsset.animations,
      binary: true,
      includeCustomExtensions: false,
      onlyVisible: true,
      trs: true,
    })

    if (!(gltf instanceof ArrayBuffer)) {
      throw new Error('GLB export did not produce binary output.')
    }

    if ((options.mode ?? 'static') === 'dynamic') {
      gltf = appendMaterialEmissionAnimationsToGlb(gltf, asset)
    }

    return {
      arrayBuffer: gltf,
      blob: new Blob([gltf], { type: 'model/gltf-binary' }),
      fileName: createGlbFileName(asset),
    }
  } finally {
    disposeManifestObject(exportableAsset.root)
  }
}

export function canExportManifestAssetAnimation(asset: ManifestAsset) {
  return getMovableJoints(asset).length > 0 || hasMaterialEmissionAnimation(asset)
}

export function createExportableManifestAssetGroup(asset: ManifestAsset) {
  return createExportableManifestAsset(asset, 'static').root
}

function createExportableManifestAsset(
  asset: ManifestAsset,
  mode: GlbExportMode,
): ExportableManifestAsset {
  const builtAsset = buildManifestAsset(asset)

  try {
    const clonedObjects = new Map<THREE.Object3D, THREE.Object3D>()
    const exportRoot = cloneExportableObject(builtAsset.group, {
      clonedObjects,
    })

    exportRoot.name = asset.name
    exportRoot.updateMatrixWorld(true)

    if (countExportableMeshes(exportRoot) === 0) {
      throw new Error(`Asset "${asset.id}" contains no exportable mesh geometry.`)
    }

    const animations =
      mode === 'dynamic'
        ? createManifestAssetAnimationClips(
            asset,
            builtAsset.jointGroups,
            clonedObjects,
          )
        : []

    if (mode === 'dynamic' && getMovableJoints(asset).length > 0 && animations.length === 0) {
      throw new Error(
        `Asset "${asset.id}" contains movable joints but no exportable animation tracks.`,
      )
    }

    return {
      animations,
      root: exportRoot,
    }
  } finally {
    disposeManifestObject(builtAsset.group)
  }
}

export function cloneExportableObject(
  source: THREE.Object3D,
  options: CloneExportableObjectOptions = {},
) {
  const clone = source.clone(true)
  const materialClones = new Map<THREE.Material, THREE.Material>()

  if (options.clonedObjects) {
    mapClonedObjects(source, clone, options.clonedObjects)
  }

  pruneNonExportableChildren(clone)
  clone.traverse((object) => {
    sanitizeObjectForExport(object)

    if (isMesh(object)) {
      object.geometry = object.geometry.clone()
      object.geometry.userData = {}
      object.material = cloneExportMaterial(object.material, materialClones)
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

function createManifestAssetAnimationClips(
  asset: ManifestAsset,
  sourceJointGroups: ReadonlyMap<string, THREE.Object3D>,
  clonedObjects: ReadonlyMap<THREE.Object3D, THREE.Object3D>,
) {
  return getJointPreviewControls(asset)
    .map((control) =>
      createControlAnimationClip(control, sourceJointGroups, clonedObjects),
    )
    .filter((clip): clip is THREE.AnimationClip => clip !== null)
}

function createControlAnimationClip(
  control: JointPreviewControl,
  sourceJointGroups: ReadonlyMap<string, THREE.Object3D>,
  clonedObjects: ReadonlyMap<THREE.Object3D, THREE.Object3D>,
) {
  const keyframes = createControlAnimationKeyframes(control)

  if (keyframes.length < 2) {
    return null
  }

  const times = keyframes.map((keyframe) => keyframe.time)
  const poseValuesByKeyframe = keyframes.map((keyframe) =>
    resolveAnimationControlPoseValues(control, keyframe.controlValue),
  )
  const tracks: THREE.KeyframeTrack[] = []

  for (const binding of control.bindings) {
    const sourceJointGroup = sourceJointGroups.get(binding.joint.id)
    const exportJointGroup = sourceJointGroup
      ? clonedObjects.get(sourceJointGroup)
      : undefined

    if (!exportJointGroup) {
      continue
    }

    const track = createJointAnimationTrack(
      binding.joint,
      exportJointGroup,
      times,
      poseValuesByKeyframe.map((poseValues) => poseValues[binding.joint.id]),
      control.wrap,
    )

    if (track) {
      tracks.push(track)
    }
  }

  if (tracks.length === 0) {
    return null
  }

  return new THREE.AnimationClip(
    `${control.name} Motion`,
    times[times.length - 1],
    tracks,
  )
}

function createControlAnimationKeyframes(
  control: JointPreviewControl,
): ControlAnimationKeyframe[] {
  if (control.wrap) {
    const min = control.range.min
    const span = control.range.max - control.range.min
    const wrappedSpan = Number.isFinite(span) && span > 0 ? span : Math.PI * 2
    const duration = 2.4

    return [0, 0.25, 0.5, 0.75, 1].map((phase) => ({
      controlValue: min + wrappedSpan * phase,
      time: duration * phase,
    }))
  }

  const defaultValue = getDefaultJointControlValue(control)
  const travelValues = uniqueFiniteValues([
    normalizeJointControlValue(control, control.range.min),
    normalizeJointControlValue(control, control.range.max),
  ]).filter((value) => Math.abs(value - defaultValue) > 1e-8)
  const values = [defaultValue, ...travelValues, defaultValue]

  if (values.length < 3) {
    return []
  }

  const segmentDuration = 1.2

  return values.map((controlValue, index) => ({
    controlValue,
    time: segmentDuration * index,
  }))
}

function resolveAnimationControlPoseValues(
  control: JointPreviewControl,
  value: number,
) {
  if (!control.wrap) {
    return resolveJointControlPoseValues(control, value)
  }

  const poseValues: Record<string, number> = {}

  for (const binding of control.bindings) {
    poseValues[binding.joint.id] = binding.offset + binding.scale * value
  }

  return poseValues
}

function createJointAnimationTrack(
  joint: ManifestJoint,
  exportJointGroup: THREE.Object3D,
  times: readonly number[],
  poseValues: readonly (number | undefined)[],
  useRawContinuousPose: boolean,
) {
  if (joint.type === 'prismatic') {
    const values = createJointPositionTrackValues(
      joint,
      poseValues,
      useRawContinuousPose,
    )

    return hasTrackMotion(values, 3)
      ? new THREE.VectorKeyframeTrack(
          `${exportJointGroup.uuid}.position`,
          times,
          values,
        )
      : null
  }

  if (joint.type === 'revolute' || joint.type === 'continuous') {
    const values = createJointQuaternionTrackValues(
      joint,
      poseValues,
      useRawContinuousPose,
    )

    return hasTrackMotion(values, 4)
      ? new THREE.QuaternionKeyframeTrack(
          `${exportJointGroup.uuid}.quaternion`,
          times,
          values,
        )
      : null
  }

  return null
}

function createJointPositionTrackValues(
  joint: ManifestJoint,
  poseValues: readonly (number | undefined)[],
  useRawContinuousPose: boolean,
) {
  return poseValues.flatMap((poseValue) => {
    const transform = createJointTransformAtPose(
      joint,
      poseValue,
      useRawContinuousPose,
    )

    return transform ? transform.position.toArray() : []
  })
}

function createJointQuaternionTrackValues(
  joint: ManifestJoint,
  poseValues: readonly (number | undefined)[],
  useRawContinuousPose: boolean,
) {
  let previousQuaternion: THREE.Quaternion | null = null

  return poseValues.flatMap((poseValue) => {
    const transform = createJointTransformAtPose(
      joint,
      poseValue,
      useRawContinuousPose,
    )

    if (!transform) {
      return []
    }

    if (
      previousQuaternion &&
      previousQuaternion.dot(transform.quaternion) < 0
    ) {
      transform.quaternion.set(
        -transform.quaternion.x,
        -transform.quaternion.y,
        -transform.quaternion.z,
        -transform.quaternion.w,
      )
    }

    previousQuaternion = transform.quaternion.clone()

    return transform.quaternion.toArray()
  })
}

function createJointTransformAtPose(
  joint: ManifestJoint,
  poseValue: number | undefined,
  useRawContinuousPose: boolean,
) {
  const object = new THREE.Object3D()

  applyManifestTransform(object, joint.origin)

  if (joint.type === 'fixed') {
    return object
  }

  const axis = getNormalizedJointAxis(joint)

  if (!axis) {
    return null
  }

  const value =
    useRawContinuousPose && joint.type === 'continuous'
      ? getFinitePoseValue(poseValue, 0)
      : normalizeJointPoseValue(joint, poseValue)

  if (joint.type === 'prismatic') {
    object.translateOnAxis(axis, value)
  } else {
    object.rotateOnAxis(axis, value)
  }

  object.updateMatrix()

  return object
}

function getFinitePoseValue(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function hasTrackMotion(values: readonly number[], itemSize: number) {
  if (values.length <= itemSize) {
    return false
  }

  for (let index = itemSize; index < values.length; index += itemSize) {
    for (let component = 0; component < itemSize; component += 1) {
      if (Math.abs(values[index + component] - values[component]) > 1e-8) {
        return true
      }
    }
  }

  return false
}

function uniqueFiniteValues(values: readonly number[]) {
  const seenValues = new Set<string>()
  const uniqueValues: number[] = []

  for (const value of values) {
    if (!Number.isFinite(value)) {
      continue
    }

    const key = value.toFixed(8)

    if (seenValues.has(key)) {
      continue
    }

    seenValues.add(key)
    uniqueValues.push(value)
  }

  return uniqueValues
}

function mapClonedObjects(
  source: THREE.Object3D,
  clone: THREE.Object3D,
  clonedObjects: Map<THREE.Object3D, THREE.Object3D>,
) {
  clonedObjects.set(source, clone)

  for (let index = 0; index < source.children.length; index += 1) {
    const sourceChild = source.children[index]
    const cloneChild = clone.children[index]

    if (sourceChild && cloneChild) {
      mapClonedObjects(sourceChild, cloneChild, clonedObjects)
    }
  }
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
  materialClones: Map<THREE.Material, THREE.Material>,
): THREE.Material | THREE.Material[] {
  return Array.isArray(material)
    ? material.map((entry) => cloneExportMaterialInstance(entry, materialClones))
    : cloneExportMaterialInstance(material, materialClones)
}

function cloneExportMaterialInstance(
  material: THREE.Material,
  materialClones: Map<THREE.Material, THREE.Material>,
) {
  const existingClone = materialClones.get(material)

  if (existingClone) {
    return existingClone
  }

  const clonedMaterial = isMeshStandardMaterial(material) && !isNodeMaterial(material)
    ? material.clone()
    : new THREE.MeshStandardMaterial({
        color: readMaterialColor(material),
        emissive: readMaterialColor(material, 'emissive', '#000000'),
        emissiveIntensity: readMaterialNumber(
          material,
          'emissiveIntensity',
          1,
        ),
        metalness: readMaterialNumber(material, 'metalness', 0),
        opacity: readMaterialNumber(material, 'opacity', 1),
        roughness: readMaterialNumber(material, 'roughness', 0.7),
        side: material.side,
        transparent: readMaterialBoolean(material, 'transparent', false),
      })

  clonedMaterial.name = material.name
  clonedMaterial.userData = {}
  materialClones.set(material, clonedMaterial)

  return clonedMaterial
}

function readMaterialColor(
  material: THREE.Material,
  key: 'color' | 'emissive' = 'color',
  fallback = '#ffffff',
) {
  const color = (material as unknown as Record<typeof key, unknown>)[key]

  return color instanceof THREE.Color ? color : new THREE.Color(fallback)
}

function readMaterialNumber(
  material: THREE.Material,
  key: 'emissiveIntensity' | 'metalness' | 'opacity' | 'roughness',
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
