import * as THREE from 'three/webgpu'
import {
  applyBuiltManifestJointPoses,
  buildManifestAsset,
  disposeManifestObject,
  type BuiltConnectorVisual,
  type BuiltManifestAsset,
} from '../geometry/assetBuilder'
import {
  getMaterialEmissionAnimationDuration,
  hasMaterialEmissionAnimation,
} from '../geometry/materialAnimations'
import {
  applyManifestTransform,
  getDefaultJointControlValue,
  getJointAnimationSpeed,
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

type ControlAnimationPlan = {
  control: JointPreviewControl
  duration: number
  keyframes: ControlAnimationKeyframe[]
  poseValuesByKeyframe: Readonly<Record<string, number>>[]
  times: number[]
}

type ConnectorSegmentTrackPlan = {
  connector: BuiltConnectorVisual
  exportMesh: THREE.Mesh
  samples: ConnectorSegmentTransform[][]
  segmentCount: number
  times: number[]
}

type ConnectorSegmentTransform = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
}

const animationDurationTickSeconds = 0.1
const maxAnimationClipDurationSeconds = 60
const maxJointAnimationAngularStep = Math.PI / 2
const animationTimeEpsilon = 1e-6
const connectorExportSampleRateHz = 30
const connectorExportMaxSegmentCount = 24
const connectorExportMinSegmentLength = 1e-5
const connectorSegmentUpAxis = new THREE.Vector3(0, 1, 0)
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
      gltf = appendMaterialEmissionAnimationsToGlb(gltf, asset, {
        animationName: createManifestAssetAnimationClipName(asset),
        duration: getManifestAssetAnimationDuration(asset),
      })
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
            builtAsset,
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

function createManifestAssetAnimationClipName(asset: Pick<ManifestAsset, 'name'>) {
  return `${asset.name} Motion`
}

function getManifestAssetAnimationDuration(asset: ManifestAsset) {
  return getCommonAnimationDuration([
    ...getJointPreviewControls(asset).map(getControlAnimationNaturalDuration),
    ...asset.materials.map((material) =>
      material.emissionAnimation
        ? getMaterialEmissionAnimationDuration(material.emissionAnimation)
        : 0,
    ),
  ])
}

function getControlAnimationNaturalDuration(control: JointPreviewControl) {
  const rangeSpan = control.range.max - control.range.min
  const speed = getJointAnimationSpeed(control.range.unit, rangeSpan)

  if (speed <= 0) {
    return 0
  }

  if (control.wrap) {
    const wrappedSpan =
      Number.isFinite(rangeSpan) && rangeSpan > 0 ? rangeSpan : Math.PI * 2

    return Math.abs(wrappedSpan) / speed
  }

  const values = createNonWrappedControlAnimationValues(control)
  const totalDistance = values
    .slice(1)
    .reduce((total, value, index) => total + Math.abs(value - values[index]), 0)

  return totalDistance / speed
}

function getControlAnimationExportDuration(control: JointPreviewControl) {
  return quantizeAnimationDuration(getControlAnimationNaturalDuration(control))
}

function getCommonAnimationDuration(durations: readonly number[]) {
  const durationTicks = durations
    .map(animationDurationToTicks)
    .filter((ticks) => ticks > 0)

  if (durationTicks.length === 0) {
    return 0
  }

  const maxDurationTicks = Math.max(...durationTicks)
  const maxClipTicks = Math.round(
    maxAnimationClipDurationSeconds / animationDurationTickSeconds,
  )
  let commonDurationTicks = 1

  for (const ticks of durationTicks) {
    commonDurationTicks = cappedLcm(commonDurationTicks, ticks, maxClipTicks)

    if (commonDurationTicks > maxClipTicks) {
      return maxDurationTicks * animationDurationTickSeconds
    }
  }

  return commonDurationTicks * animationDurationTickSeconds
}

function quantizeAnimationDuration(duration: number) {
  const ticks = animationDurationToTicks(duration)

  return ticks > 0 ? ticks * animationDurationTickSeconds : 0
}

function animationDurationToTicks(duration: number) {
  return Number.isFinite(duration) && duration > animationTimeEpsilon
    ? Math.max(1, Math.round(duration / animationDurationTickSeconds))
    : 0
}

function gcd(left: number, right: number) {
  let a = Math.abs(left)
  let b = Math.abs(right)

  while (b > 0) {
    const next = a % b

    a = b
    b = next
  }

  return a || 1
}

function cappedLcm(left: number, right: number, max: number) {
  const reducedLeft = Math.abs(left) / gcd(left, right)
  const absRight = Math.abs(right)

  return reducedLeft > max / absRight ? max + 1 : reducedLeft * absRight
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
  builtAsset: BuiltManifestAsset,
  clonedObjects: ReadonlyMap<THREE.Object3D, THREE.Object3D>,
) {
  const duration = getManifestAssetAnimationDuration(asset)
  const plans = getJointPreviewControls(asset)
    .map((control) => createControlAnimationPlan(control, duration))
    .filter((plan): plan is ControlAnimationPlan => plan !== null)
  const connectorAnimationTimes =
    builtAsset.connectorVisuals.length > 0
      ? createBakedConnectorAnimationTimes(plans, duration)
      : null
  const tracks: THREE.KeyframeTrack[] = []

  for (const plan of plans) {
    const times = connectorAnimationTimes ?? plan.times
    const poseValuesByKeyframe = createControlPoseValuesAtTimes(plan, times)

    for (const binding of plan.control.bindings) {
      const sourceJointGroup = builtAsset.jointGroups.get(binding.joint.id)
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
        poseValuesByKeyframe.map(
          (poseValues) => poseValues[binding.joint.id],
        ),
        plan.control.wrap,
      )

      if (track) {
        tracks.push(track)
      }
    }
  }

  tracks.push(
    ...createConnectorTubeAnimationTracks(
      builtAsset,
      clonedObjects,
      plans,
      duration,
      connectorAnimationTimes,
    ),
  )

  if (tracks.length === 0) {
    return []
  }

  return [
    new THREE.AnimationClip(
      createManifestAssetAnimationClipName(asset),
      duration,
      tracks,
    ),
  ]
}

function createControlAnimationPlan(
  control: JointPreviewControl,
  clipDuration: number,
): ControlAnimationPlan | null {
  const duration = getControlAnimationExportDuration(control)
  const keyframes = createControlAnimationKeyframes(
    control,
    duration,
    clipDuration,
  )

  if (keyframes.length < 2) {
    return null
  }

  const times = keyframes.map((keyframe) => keyframe.time)
  const poseValuesByKeyframe = keyframes.map((keyframe) =>
    resolveAnimationControlPoseValues(control, keyframe.controlValue),
  )

  return {
    control,
    duration,
    keyframes,
    poseValuesByKeyframe,
    times,
  }
}

function createControlPoseValuesAtTimes(
  controlPlan: ControlAnimationPlan,
  times: readonly number[],
) {
  return times.map((time) =>
    resolveAnimationControlPoseValues(
      controlPlan.control,
      resolveControlAnimationValueAtTime(controlPlan.keyframes, time),
    ),
  )
}

function createConnectorTubeAnimationTracks(
  builtAsset: BuiltManifestAsset,
  clonedObjects: ReadonlyMap<THREE.Object3D, THREE.Object3D>,
  controlPlans: readonly ControlAnimationPlan[],
  clipDuration: number,
  bakedTimes: readonly number[] | null,
) {
  if (builtAsset.connectorVisuals.length === 0 || controlPlans.length === 0) {
    return []
  }

  const times =
    bakedTimes ?? createBakedConnectorAnimationTimes(controlPlans, clipDuration)

  if (times.length < 2) {
    return []
  }

  const connectorPlans = createConnectorSegmentTrackPlans(
    builtAsset,
    clonedObjects,
    times,
  )

  if (connectorPlans.length === 0) {
    return []
  }

  for (const time of times) {
    applyBuiltManifestJointPoses(
      builtAsset,
      resolveCombinedAnimationPoseValues(controlPlans, time),
    )

    for (const connectorPlan of connectorPlans) {
      connectorPlan.samples.push(
        createConnectorSegmentTransforms(
          connectorPlan.connector,
          connectorPlan.segmentCount,
        ),
      )
    }
  }

  applyBuiltManifestJointPoses(builtAsset, {})

  return connectorPlans.flatMap(createConnectorSegmentAnimationTracks)
}

function createBakedConnectorAnimationTimes(
  controlPlans: readonly ControlAnimationPlan[],
  clipDuration: number,
) {
  const times = new Set<string>()

  for (
    let time = 0;
    time < clipDuration + animationTimeEpsilon;
    time += 1 / connectorExportSampleRateHz
  ) {
    times.add(Math.min(time, clipDuration).toFixed(6))
  }

  times.add('0.000000')
  times.add(clipDuration.toFixed(6))

  for (const controlPlan of controlPlans) {
    for (const time of controlPlan.times) {
      times.add(time.toFixed(6))
    }
  }

  return [...times]
    .map((time) => Number(time))
    .filter((time) => Number.isFinite(time))
    .sort((left, right) => left - right)
}

function resolveCombinedAnimationPoseValues(
  controlPlans: readonly ControlAnimationPlan[],
  time: number,
) {
  const poseValues: Record<string, number> = {}

  for (const controlPlan of controlPlans) {
    Object.assign(
      poseValues,
      resolveAnimationControlPoseValues(
        controlPlan.control,
        resolveControlAnimationValueAtTime(controlPlan.keyframes, time),
      ),
    )
  }

  return poseValues
}

function resolveControlAnimationValueAtTime(
  keyframes: readonly ControlAnimationKeyframe[],
  time: number,
) {
  if (time <= (keyframes[0]?.time ?? 0) + animationTimeEpsilon) {
    return keyframes[0]?.controlValue ?? 0
  }

  return resolveControlCycleValueAtTime(keyframes, time)
}

function createConnectorSegmentTrackPlans(
  builtAsset: BuiltManifestAsset,
  clonedObjects: ReadonlyMap<THREE.Object3D, THREE.Object3D>,
  times: readonly number[],
): ConnectorSegmentTrackPlan[] {
  return builtAsset.connectorVisuals.flatMap((connector) => {
    const exportMesh = clonedObjects.get(connector.mesh)

    if (!exportMesh || !isMesh(exportMesh)) {
      return []
    }

    return [
      {
        connector,
        exportMesh,
        samples: [],
        segmentCount: getConnectorExportSegmentCount(connector),
        times: [...times],
      },
    ]
  })
}

function getConnectorExportSegmentCount(connector: BuiltConnectorVisual) {
  return Math.max(
    1,
    Math.min(
      connectorExportMaxSegmentCount,
      connector.geometry.tubularSegments ?? connectorExportMaxSegmentCount,
    ),
  )
}

function createConnectorSegmentTransforms(
  connector: BuiltConnectorVisual,
  segmentCount: number,
) {
  const points = sampleConnectorCenterlinePoints(
    connector.centerlinePoints,
    segmentCount,
  )
  const transforms: ConnectorSegmentTransform[] = []

  for (let index = 0; index < segmentCount; index += 1) {
    transforms.push(
      createConnectorSegmentTransform(points[index], points[index + 1]),
    )
  }

  return transforms
}

function sampleConnectorCenterlinePoints(
  centerlinePoints: readonly THREE.Vector3[],
  segmentCount: number,
) {
  if (centerlinePoints.length >= 2) {
    return new THREE.CatmullRomCurve3(
      centerlinePoints.map((point) => point.clone()),
    ).getPoints(segmentCount)
  }

  const point = centerlinePoints[0]?.clone() ?? new THREE.Vector3()
  const points = [point]

  for (let index = 0; index < segmentCount; index += 1) {
    points.push(point.clone())
  }

  return points
}

function createConnectorSegmentTransform(
  start: THREE.Vector3,
  end: THREE.Vector3,
): ConnectorSegmentTransform {
  const delta = end.clone().sub(start)
  const length = Math.max(delta.length(), connectorExportMinSegmentLength)
  const direction =
    delta.lengthSq() > connectorExportMinSegmentLength ** 2
      ? delta.normalize()
      : connectorSegmentUpAxis

  return {
    position: start.clone().add(end).multiplyScalar(0.5),
    quaternion: new THREE.Quaternion().setFromUnitVectors(
      connectorSegmentUpAxis,
      direction,
    ),
    scale: new THREE.Vector3(1, length, 1),
  }
}

function createConnectorSegmentAnimationTracks(plan: ConnectorSegmentTrackPlan) {
  if (!connectorSegmentSamplesHaveMotion(plan.samples)) {
    return []
  }

  const parent = plan.exportMesh.parent

  if (!parent || plan.samples.length === 0) {
    return []
  }

  const segments = createConnectorExportSegments(plan)
  const tracks: THREE.KeyframeTrack[] = []

  parent.remove(plan.exportMesh)

  for (const segment of segments) {
    parent.add(segment)
  }

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex]
    const positionValues = plan.samples.flatMap((sample) =>
      sample[segmentIndex].position.toArray(),
    )
    const quaternionValues = createConnectorSegmentQuaternionTrackValues(
      plan.samples,
      segmentIndex,
    )
    const scaleValues = plan.samples.flatMap((sample) =>
      sample[segmentIndex].scale.toArray(),
    )

    if (hasTrackMotion(positionValues, 3)) {
      tracks.push(
        new THREE.VectorKeyframeTrack(
          `${segment.uuid}.position`,
          plan.times,
          positionValues,
        ),
      )
    }

    if (hasTrackMotion(quaternionValues, 4)) {
      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${segment.uuid}.quaternion`,
          plan.times,
          quaternionValues,
        ),
      )
    }

    if (hasTrackMotion(scaleValues, 3)) {
      tracks.push(
        new THREE.VectorKeyframeTrack(
          `${segment.uuid}.scale`,
          plan.times,
          scaleValues,
        ),
      )
    }
  }

  if (tracks.length === 0) {
    for (const segment of segments) {
      parent.remove(segment)
      segment.geometry.dispose()
    }

    parent.add(plan.exportMesh)
  } else {
    plan.exportMesh.geometry.dispose()
  }

  return tracks
}

function connectorSegmentSamplesHaveMotion(
  samples: readonly ConnectorSegmentTransform[][],
) {
  const firstSample = samples[0]

  if (!firstSample) {
    return false
  }

  for (const sample of samples.slice(1)) {
    for (let index = 0; index < firstSample.length; index += 1) {
      const firstTransform = firstSample[index]
      const sampleTransform = sample[index]

      if (
        !firstTransform ||
        !sampleTransform ||
        !vectorsAlmostEqual(sampleTransform.position, firstTransform.position) ||
        !vectorsAlmostEqual(sampleTransform.scale, firstTransform.scale) ||
        Math.abs(sampleTransform.quaternion.dot(firstTransform.quaternion)) <
          1 - 1e-6
      ) {
        return true
      }
    }
  }

  return false
}

function createConnectorExportSegments(plan: ConnectorSegmentTrackPlan) {
  const material = plan.exportMesh.material
  const firstSample = plan.samples[0] ?? []

  return firstSample.map((transform, index) => {
    const segment = new THREE.Mesh(
      new THREE.CylinderGeometry(
        plan.connector.geometry.radius,
        plan.connector.geometry.radius,
        1,
        plan.connector.geometry.radialSegments ?? 12,
        1,
        true,
      ),
      material,
    )

    segment.name = `${plan.exportMesh.name} segment ${index + 1}`
    segment.castShadow = plan.exportMesh.castShadow
    segment.receiveShadow = plan.exportMesh.receiveShadow
    segment.position.copy(transform.position)
    segment.quaternion.copy(transform.quaternion)
    segment.scale.copy(transform.scale)

    return segment
  })
}

function createConnectorSegmentQuaternionTrackValues(
  samples: readonly ConnectorSegmentTransform[][],
  segmentIndex: number,
) {
  let previousQuaternion: THREE.Quaternion | null = null
  const values: number[] = []

  for (const sample of samples) {
    const quaternion = sample[segmentIndex].quaternion.clone()

    if (previousQuaternion && previousQuaternion.dot(quaternion) < 0) {
      quaternion.set(
        -quaternion.x,
        -quaternion.y,
        -quaternion.z,
        -quaternion.w,
      )
    }

    values.push(...quaternion.toArray())
    previousQuaternion = quaternion
  }

  return values
}

function vectorsAlmostEqual(left: THREE.Vector3, right: THREE.Vector3) {
  return (
    Math.abs(left.x - right.x) <= 1e-6 &&
    Math.abs(left.y - right.y) <= 1e-6 &&
    Math.abs(left.z - right.z) <= 1e-6
  )
}

function createControlAnimationKeyframes(
  control: JointPreviewControl,
  duration: number,
  clipDuration: number,
): ControlAnimationKeyframe[] {
  const cycleKeyframes = createControlAnimationCycleKeyframes(control, duration)

  return repeatControlAnimationKeyframes(
    cycleKeyframes,
    duration,
    clipDuration,
  )
}

function createControlAnimationCycleKeyframes(
  control: JointPreviewControl,
  duration: number,
) {
  if (control.wrap) {
    const min = control.range.min
    const span = control.range.max - control.range.min
    const wrappedSpan = Number.isFinite(span) && span > 0 ? span : Math.PI * 2

    return subdivideControlAnimationWaypoints(control, [
      {
        controlValue: min,
        time: 0,
      },
      {
        controlValue: min + wrappedSpan,
        time: duration,
      },
    ])
  }

  const values = createNonWrappedControlAnimationValues(control)
  const segmentDistances = values
    .slice(1)
    .map((value, index) => Math.abs(value - values[index]))
  const totalDistance = segmentDistances.reduce(
    (total, distance) => total + distance,
    0,
  )

  if (values.length < 2 || totalDistance <= 1e-8) {
    return []
  }

  let elapsed = 0

  const waypoints = values.map((controlValue, index) => {
    if (index > 0) {
      elapsed += segmentDistances[index - 1] / totalDistance
    }

    return {
      controlValue,
      time: duration * elapsed,
    }
  })

  return subdivideControlAnimationWaypoints(control, waypoints)
}

function subdivideControlAnimationWaypoints(
  control: JointPreviewControl,
  waypoints: readonly ControlAnimationKeyframe[],
) {
  const keyframes: ControlAnimationKeyframe[] = []

  for (let index = 0; index < waypoints.length - 1; index += 1) {
    const start = waypoints[index]
    const end = waypoints[index + 1]
    const segmentCount = getControlAnimationSegmentCount(
      control,
      start.controlValue,
      end.controlValue,
    )

    if (index === 0) {
      keyframes.push(start)
    }

    for (let step = 1; step <= segmentCount; step += 1) {
      const phase = step / segmentCount

      keyframes.push({
        controlValue: lerp(start.controlValue, end.controlValue, phase),
        time: lerp(start.time, end.time, phase),
      })
    }
  }

  return keyframes
}

function repeatControlAnimationKeyframes(
  cycleKeyframes: readonly ControlAnimationKeyframe[],
  duration: number,
  clipDuration: number,
) {
  if (
    cycleKeyframes.length < 2 ||
    duration <= animationTimeEpsilon ||
    clipDuration <= animationTimeEpsilon
  ) {
    return []
  }

  const repeatedKeyframes: ControlAnimationKeyframe[] = []
  const cycleCount = Math.ceil(clipDuration / duration - animationTimeEpsilon)

  for (let cycleIndex = 0; cycleIndex < cycleCount; cycleIndex += 1) {
    const cycleStart = cycleIndex * duration

    for (const [keyframeIndex, keyframe] of cycleKeyframes.entries()) {
      if (cycleIndex > 0 && keyframeIndex === 0) {
        continue
      }

      const time = cycleStart + keyframe.time

      if (time > clipDuration + animationTimeEpsilon) {
        continue
      }

      pushControlAnimationKeyframe(repeatedKeyframes, {
        controlValue: keyframe.controlValue,
        time: Math.min(time, clipDuration),
      })
    }
  }

  const lastKeyframe = repeatedKeyframes.at(-1)

  if (!lastKeyframe || lastKeyframe.time < clipDuration - animationTimeEpsilon) {
    repeatedKeyframes.push({
      controlValue: resolveControlCycleValueAtTime(
        cycleKeyframes,
        positiveModulo(clipDuration, duration),
      ),
      time: clipDuration,
    })
  }

  return repeatedKeyframes
}

function pushControlAnimationKeyframe(
  keyframes: ControlAnimationKeyframe[],
  keyframe: ControlAnimationKeyframe,
) {
  const lastKeyframe = keyframes.at(-1)

  if (
    lastKeyframe &&
    Math.abs(lastKeyframe.time - keyframe.time) <= animationTimeEpsilon
  ) {
    lastKeyframe.controlValue = keyframe.controlValue
    lastKeyframe.time = keyframe.time
    return
  }

  keyframes.push(keyframe)
}

function resolveControlCycleValueAtTime(
  keyframes: readonly ControlAnimationKeyframe[],
  time: number,
) {
  if (time <= animationTimeEpsilon) {
    return keyframes[0]?.controlValue ?? 0
  }

  for (let index = 1; index < keyframes.length; index += 1) {
    const previous = keyframes[index - 1]
    const current = keyframes[index]

    if (time <= current.time + animationTimeEpsilon) {
      const span = current.time - previous.time
      const phase =
        span > animationTimeEpsilon ? (time - previous.time) / span : 1

      return lerp(previous.controlValue, current.controlValue, phase)
    }
  }

  return keyframes.at(-1)?.controlValue ?? 0
}

function getControlAnimationSegmentCount(
  control: JointPreviewControl,
  startValue: number,
  endValue: number,
) {
  const controlTravel = endValue - startValue
  const maxAngularTravel = Math.max(
    0,
    ...control.bindings
      .filter(
        (binding) =>
          binding.joint.type === 'revolute' ||
          binding.joint.type === 'continuous',
      )
      .map((binding) =>
        Number.isFinite(binding.scale)
          ? Math.abs(binding.scale * controlTravel)
          : 0,
      ),
  )

  return Math.max(
    1,
    Math.ceil(maxAngularTravel / maxJointAnimationAngularStep),
  )
}

function lerp(start: number, end: number, phase: number) {
  return start + (end - start) * phase
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor
}

function createNonWrappedControlAnimationValues(control: JointPreviewControl) {
  const defaultValue = getDefaultJointControlValue(control)
  const min = normalizeJointControlValue(control, control.range.min)
  const max = normalizeJointControlValue(control, control.range.max)
  const values = [defaultValue]

  pushControlAnimationValue(values, max)
  pushControlAnimationValue(values, min)
  pushControlAnimationValue(values, defaultValue)

  return values
}

function pushControlAnimationValue(values: number[], value: number) {
  const lastValue = values.at(-1)

  if (lastValue === undefined || Math.abs(lastValue - value) > 1e-8) {
    values.push(value)
  }
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
