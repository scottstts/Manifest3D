import * as THREE from 'three/webgpu'
import type {
  ManifestAsset,
  ManifestJoint,
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
  return getMovableJoints(asset).flatMap((joint) => {
    const values = getGeneratedSampleValues(joint)

    return values.map((value) => ({
      id: `sample:${joint.id}:${formatPoseValue(value)}`,
      label: `${joint.name} ${formatPoseValue(value)}`,
      poses: {
        [joint.id]: value,
      },
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

function getGeneratedSampleValues(joint: ManifestJoint) {
  if (joint.type === 'continuous') {
    return [Math.PI / 2, Math.PI, Math.PI * 1.5]
  }

  if (joint.type === 'fixed') {
    return []
  }

  const range = getJointPreviewRange(joint)
  const defaultValue = getDefaultJointPoseValue(joint)
  const candidates = [range.min, range.max]

  if (range.min < 0 && range.max > 0) {
    candidates.push((range.min + range.max) / 2)
  }

  return uniqueFiniteValues(candidates)
    .map((value) => normalizeJointPoseValue(joint, value))
    .filter((value) => Math.abs(value - defaultValue) > 1e-8)
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
