import * as THREE from 'three/webgpu'
import type {
  ManifestAsset,
  ManifestJoint,
  ManifestJointControl,
  ManifestJointControlBinding,
  ManifestJointType,
  ManifestPoseSpec,
  ManifestTransform,
} from '../schema/manifestTypes'

export type JointPoseValues = Readonly<Record<string, number>>

export type JointPreviewRange = {
  defaultValue: number
  max: number
  min: number
  step: number
  unit: 'meters' | 'radians'
}

export type JointPoseSample = {
  id: string
  label: string
  poses: JointPoseValues
  source: 'authored_check' | 'generated'
}

export type JointPreviewControlBinding = ManifestJointControlBinding & {
  joint: ManifestJoint
}

export type JointPreviewControl = {
  bindings: JointPreviewControlBinding[]
  id: string
  name: string
  range: JointPreviewRange
  wrap: boolean
}

const twoPi = Math.PI * 2
const defaultRevoluteRange = {
  lower: -Math.PI / 2,
  upper: Math.PI / 2,
}
const defaultPrismaticRange = {
  lower: -0.25,
  upper: 0.25,
}

export function getMovableJoints(asset: ManifestAsset) {
  return asset.joints.filter(isMovableJoint)
}

export function isMovableJoint(joint: ManifestJoint) {
  return joint.type !== 'fixed'
}

export function getJointPreviewRange(joint: ManifestJoint): JointPreviewRange {
  switch (joint.type) {
    case 'fixed':
      return {
        defaultValue: 0,
        max: 0,
        min: 0,
        step: 1,
        unit: 'radians',
      }
    case 'revolute':
      return {
        defaultValue: getDefaultJointPoseValue(joint),
        max: joint.limits?.upper ?? defaultRevoluteRange.upper,
        min: joint.limits?.lower ?? defaultRevoluteRange.lower,
        step: 0.01,
        unit: 'radians',
      }
    case 'prismatic':
      return {
        defaultValue: getDefaultJointPoseValue(joint),
        max: joint.limits?.upper ?? defaultPrismaticRange.upper,
        min: joint.limits?.lower ?? defaultPrismaticRange.lower,
        step: 0.005,
        unit: 'meters',
      }
    case 'continuous':
      return {
        defaultValue: 0,
        max: twoPi,
        min: 0,
        step: 0.01,
        unit: 'radians',
      }
    default:
      return assertNever(joint.type)
  }
}

export function getDefaultJointPoseValue(joint: ManifestJoint) {
  if (joint.type === 'fixed' || joint.type === 'continuous') {
    return 0
  }

  const lower = joint.limits?.lower ?? getFallbackLimit(joint.type, 'lower')
  const upper = joint.limits?.upper ?? getFallbackLimit(joint.type, 'upper')

  return clamp(0, lower, upper)
}

export function normalizeJointPoseValue(
  joint: ManifestJoint,
  value: number | undefined,
) {
  const range = getJointPreviewRange(joint)
  const finiteValue = Number.isFinite(value)
    ? (value as number)
    : range.defaultValue

  if (joint.type === 'continuous') {
    return wrapToRange(finiteValue, range.min, range.max)
  }

  return clamp(finiteValue, range.min, range.max)
}

export function getJointPreviewControls(asset: ManifestAsset): JointPreviewControl[] {
  const movableJoints = getMovableJoints(asset)
  const movableJointsById = new Map(movableJoints.map((joint) => [joint.id, joint]))
  const usedJointIds = new Set<string>()
  const configuredControls = (asset.controls ?? [])
    .map((control) => resolveJointPreviewControl(control, movableJointsById))
    .filter((control): control is JointPreviewControl => control !== null)

  for (const control of configuredControls) {
    for (const binding of control.bindings) {
      usedJointIds.add(binding.joint.id)
    }
  }

  return [
    ...configuredControls,
    ...movableJoints
      .filter((joint) => !usedJointIds.has(joint.id))
      .map(createJointFallbackControl),
  ]
}

export function normalizeJointControlValue(
  control: JointPreviewControl,
  value: number | undefined,
) {
  const finiteValue = Number.isFinite(value)
    ? (value as number)
    : control.range.defaultValue

  if (control.wrap) {
    return wrapToRange(finiteValue, control.range.min, control.range.max)
  }

  return clamp(finiteValue, control.range.min, control.range.max)
}

export function getDefaultJointControlValue(control: JointPreviewControl) {
  return control.range.defaultValue
}

export function getJointAnimationSpeed(
  unit: JointPreviewRange['unit'],
  rangeSpan: number,
) {
  if (unit === 'meters') {
    return Math.max(0.08, Math.abs(rangeSpan) / 2)
  }

  return Math.PI / 2
}

export function getJointControlPreviewValue(
  control: JointPreviewControl,
  jointPoses: JointPoseValues,
) {
  const primaryBinding = control.bindings[0]

  if (!primaryBinding) {
    return control.range.defaultValue
  }

  const jointValue = normalizeJointPoseValue(
    primaryBinding.joint,
    jointPoses[primaryBinding.joint.id],
  )

  if (Math.abs(primaryBinding.scale) <= 1e-8) {
    return control.range.defaultValue
  }

  return normalizeJointControlValue(
    control,
    (jointValue - primaryBinding.offset) / primaryBinding.scale,
  )
}

export function resolveJointControlPoseValues(
  control: JointPreviewControl,
  value: number,
) {
  const normalizedValue = normalizeJointControlValue(control, value)
  const poseValues: Record<string, number> = {}

  for (const binding of control.bindings) {
    poseValues[binding.joint.id] = normalizeJointPoseValue(
      binding.joint,
      binding.offset + binding.scale * normalizedValue,
    )
  }

  return poseValues
}

export function applyManifestTransform(
  object: THREE.Object3D,
  transform: ManifestTransform,
) {
  object.position.fromArray(transform.position ?? [0, 0, 0])
  object.rotation.set(...(transform.rotation ?? [0, 0, 0]))
  object.scale.fromArray(transform.scale ?? [1, 1, 1])
}

export function applyJointTransform(
  object: THREE.Object3D,
  joint: ManifestJoint,
  poseValue?: number,
) {
  applyManifestTransform(object, joint.origin)

  if (joint.type === 'fixed') {
    return
  }

  const axis = getNormalizedJointAxis(joint)

  if (!axis) {
    return
  }

  const value = normalizeJointPoseValue(joint, poseValue)

  if (joint.type === 'prismatic') {
    object.translateOnAxis(axis, value)
    return
  }

  object.rotateOnAxis(axis, value)
}

export function applyJointPosesToBuiltGroups(
  asset: ManifestAsset,
  jointGroups: ReadonlyMap<string, THREE.Object3D>,
  jointPoses: JointPoseValues,
) {
  for (const joint of asset.joints) {
    const jointGroup = jointGroups.get(joint.id)

    if (!jointGroup) {
      continue
    }

    applyJointTransform(jointGroup, joint, jointPoses[joint.id])
  }
}

export function resolvePoseSpecValues(
  asset: ManifestAsset,
  pose: ManifestPoseSpec,
) {
  const poseValues: Record<string, number> = {}
  const errors: string[] = []
  const jointsById = new Map(asset.joints.map((joint) => [joint.id, joint]))

  for (const jointPose of pose.joints) {
    const joint = jointsById.get(jointPose.jointId)

    if (!joint) {
      errors.push(`Pose references missing joint "${jointPose.jointId}".`)
      continue
    }

    if (!isMovableJoint(joint)) {
      errors.push(`Pose references fixed joint "${joint.id}".`)
      continue
    }

    poseValues[joint.id] = normalizeJointPoseValue(joint, jointPose.value)
  }

  return {
    errors,
    poseValues,
  }
}

export function createGeneratedJointPoseSamples(
  asset: ManifestAsset,
): JointPoseSample[] {
  return getJointPreviewControls(asset).flatMap((control) => {
    const values = getGeneratedControlSampleValues(control)

    return values.map((value) => ({
      id: `sample:${control.id}:${formatPoseValue(value)}`,
      label: `${control.name} ${formatPoseValue(value)}`,
      poses: resolveJointControlPoseValues(control, value),
      source: 'generated' as const,
    }))
  })
}

export function getNormalizedJointAxis(joint: ManifestJoint) {
  if (!joint.axis) {
    return null
  }

  const axis = new THREE.Vector3().fromArray(joint.axis)

  if (!Number.isFinite(axis.lengthSq()) || axis.lengthSq() <= 0) {
    return null
  }

  return axis.normalize()
}

function getGeneratedControlSampleValues(control: JointPreviewControl) {
  if (control.wrap) {
    const min = control.range.min
    const span = control.range.max - control.range.min
    const wrappedSpan = Number.isFinite(span) && span > 0 ? span : twoPi

    return [0.25, 0.5, 0.75].map((phase) =>
      normalizeJointControlValue(control, min + wrappedSpan * phase),
    )
  }

  const defaultValue = getDefaultJointControlValue(control)
  const candidates = control.bindings.length > 1
    ? getLinkedControlSampleValues(control)
    : [control.range.min, control.range.max]

  if (control.range.min < 0 && control.range.max > 0) {
    candidates.push((control.range.min + control.range.max) / 2)
  }

  return uniqueFiniteValues(candidates)
    .map((value) => normalizeJointControlValue(control, value))
    .filter((value) => Math.abs(value - defaultValue) > 1e-8)
}

function getLinkedControlSampleValues(control: JointPreviewControl) {
  const min = control.range.min
  const max = control.range.max
  const span = max - min

  if (!Number.isFinite(span) || span <= 0) {
    return [min, max]
  }

  return [0, 0.25, 0.5, 0.75, 1].map((phase) => min + span * phase)
}

function resolveJointPreviewControl(
  control: ManifestJointControl,
  movableJointsById: ReadonlyMap<string, ManifestJoint>,
): JointPreviewControl | null {
  const bindings = control.joints
    .map((binding) => {
      const joint = movableJointsById.get(binding.jointId)

      return joint
        ? {
            ...binding,
            joint,
          }
        : null
    })
    .filter((binding): binding is JointPreviewControlBinding => binding !== null)

  if (bindings.length === 0) {
    return null
  }

  const fallbackRange = deriveJointControlRange(bindings)
  const range = {
    ...fallbackRange,
    max: control.limits.upper,
    min: control.limits.lower,
  }

  return {
    bindings,
    id: control.id,
    name: control.name,
    range: {
      ...range,
      defaultValue: clamp(0, range.min, range.max),
    },
    wrap: bindings.every((binding) => binding.joint.type === 'continuous'),
  }
}

function createJointFallbackControl(joint: ManifestJoint): JointPreviewControl {
  const range = getJointPreviewRange(joint)

  return {
    bindings: [
      {
        joint,
        jointId: joint.id,
        offset: 0,
        scale: 1,
      },
    ],
    id: joint.id,
    name: joint.name,
    range,
    wrap: joint.type === 'continuous',
  }
}

function deriveJointControlRange(
  bindings: readonly JointPreviewControlBinding[],
): JointPreviewRange {
  const primaryRange = getJointPreviewRange(bindings[0].joint)
  let min = Number.NEGATIVE_INFINITY
  let max = Number.POSITIVE_INFINITY

  for (const binding of bindings) {
    const jointRange = getJointPreviewRange(binding.joint)

    if (Math.abs(binding.scale) <= 1e-8) {
      continue
    }

    const lower = (jointRange.min - binding.offset) / binding.scale
    const upper = (jointRange.max - binding.offset) / binding.scale
    min = Math.max(min, Math.min(lower, upper))
    max = Math.min(max, Math.max(lower, upper))
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    min = primaryRange.min
    max = primaryRange.max
  }

  return {
    defaultValue: clamp(0, min, max),
    max,
    min,
    step: primaryRange.step,
    unit: primaryRange.unit,
  }
}

function uniqueFiniteValues(values: readonly number[]) {
  const rounded = new Set<string>()
  const uniqueValues: number[] = []

  for (const value of values) {
    if (!Number.isFinite(value)) {
      continue
    }

    const key = value.toFixed(6)

    if (rounded.has(key)) {
      continue
    }

    rounded.add(key)
    uniqueValues.push(value)
  }

  return uniqueValues
}

function getFallbackLimit(
  jointType: ManifestJointType,
  limit: 'lower' | 'upper',
) {
  if (jointType === 'prismatic') {
    return defaultPrismaticRange[limit]
  }

  return defaultRevoluteRange[limit]
}

function wrapToRange(value: number, min: number, max: number) {
  const span = max - min

  if (span <= 0) {
    return min
  }

  return ((((value - min) % span) + span) % span) + min
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatPoseValue(value: number) {
  return value.toFixed(4).replace(/\.?0+$/, '')
}

function assertNever(value: never): never {
  throw new Error(`Unsupported joint type: ${JSON.stringify(value)}`)
}
