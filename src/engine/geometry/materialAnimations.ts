import * as THREE from 'three/webgpu'
import type {
  ManifestAsset,
  ManifestMaterial,
  ManifestMaterialEmission,
  ManifestMaterialEmissionAnimation,
  ManifestMaterialEmissionKeyframe,
} from '../schema/manifestTypes'

export type MaterialAnimationValues = Readonly<Record<string, number>>

export type MaterialEmissionPreviewRange = {
  defaultValue: number
  max: number
  min: number
  step: number
  unit: 'seconds'
}

export type MaterialEmissionPreviewControl = {
  id: string
  material: ManifestMaterial
  materialId: string
  name: string
  range: MaterialEmissionPreviewRange
  wrap: boolean
}

export type ResolvedMaterialEmission = ManifestMaterialEmission

const defaultOffEmission: ResolvedMaterialEmission = {
  color: '#000000',
  hasEmission: false,
  intensity: 0,
}
const emissionEpsilon = 1e-6

export function getMaterialEmissionAnimationControls(
  asset: ManifestAsset,
): MaterialEmissionPreviewControl[] {
  return asset.materials
    .map((material) => {
      const animation = getMaterialEmissionAnimation(material)

      if (!animation) {
        return null
      }

      const duration = getMaterialEmissionAnimationDuration(animation)

      if (duration <= 0) {
        return null
      }

      return {
        id: animation.id,
        material,
        materialId: material.id,
        name: animation.name,
        range: {
          defaultValue: 0,
          max: duration,
          min: 0,
          step: Math.max(0.01, duration / 240),
          unit: 'seconds' as const,
        },
        wrap: animation.loop,
      }
    })
    .filter(
      (control): control is MaterialEmissionPreviewControl => control !== null,
    )
}

export function hasMaterialEmissionAnimation(asset: ManifestAsset) {
  return getMaterialEmissionAnimationControls(asset).length > 0
}

export function getDefaultMaterialEmissionControlValue(
  control: MaterialEmissionPreviewControl,
) {
  return control.range.defaultValue
}

export function getMaterialEmissionControlPreviewValue(
  control: MaterialEmissionPreviewControl,
  values: MaterialAnimationValues,
) {
  return normalizeMaterialEmissionControlValue(
    control,
    values[control.materialId],
  )
}

export function normalizeMaterialEmissionControlValue(
  control: MaterialEmissionPreviewControl,
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

export function resolveMaterialEmissionAtTime(
  material: ManifestMaterial,
  time: number | undefined,
): ResolvedMaterialEmission {
  const animation = getMaterialEmissionAnimation(material)

  if (!animation) {
    return resolveStaticMaterialEmission(material)
  }

  const keyframes = getSortedMaterialEmissionKeyframes(animation)

  if (keyframes.length === 0) {
    return resolveStaticMaterialEmission(material)
  }

  const duration = getMaterialEmissionAnimationDuration(animation)
  const finiteTime = Number.isFinite(time) ? (time as number) : 0
  const normalizedTime =
    animation.loop && duration > 0
      ? wrapToRange(finiteTime, 0, duration)
      : clamp(finiteTime, 0, duration)

  if (animation.interpolation === 'step') {
    return normalizeMaterialEmission(
      keyframes[getStepKeyframeIndex(keyframes, normalizedTime)],
    )
  }

  return interpolateMaterialEmission(keyframes, normalizedTime)
}

export function resolveStaticMaterialEmission(material: ManifestMaterial) {
  if (material.emission) {
    return normalizeMaterialEmission(material.emission)
  }

  const firstKeyframe = getMaterialEmissionAnimation(material)?.keyframes[0]

  return firstKeyframe
    ? normalizeMaterialEmission(firstKeyframe)
    : defaultOffEmission
}

export function applyMaterialEmissionToThreeMaterial(
  material: THREE.Material,
  emission: ResolvedMaterialEmission,
) {
  const emissiveMaterial = material as THREE.Material & {
    emissive?: THREE.Color
    emissiveIntensity?: number
  }
  const hasEmission = emission.hasEmission && emission.intensity > emissionEpsilon

  if (emissiveMaterial.emissive instanceof THREE.Color) {
    emissiveMaterial.emissive.set(hasEmission ? emission.color : '#000000')
  }

  emissiveMaterial.emissiveIntensity = hasEmission ? emission.intensity : 0
  material.needsUpdate = true
}

export function materialEmissionAnimationHasMotion(
  material: ManifestMaterial,
) {
  const animation = getMaterialEmissionAnimation(material)

  if (!animation) {
    return false
  }

  const [firstKeyframe, ...remainingKeyframes] =
    getSortedMaterialEmissionKeyframes(animation)

  if (!firstKeyframe) {
    return false
  }

  const firstEmission = normalizeMaterialEmission(firstKeyframe)

  return remainingKeyframes.some((keyframe) => {
    const emission = normalizeMaterialEmission(keyframe)

    return (
      emission.hasEmission !== firstEmission.hasEmission ||
      emission.color.toLowerCase() !== firstEmission.color.toLowerCase() ||
      Math.abs(emission.intensity - firstEmission.intensity) > emissionEpsilon
    )
  })
}

export function getMaterialEmissionAnimation(
  material: ManifestMaterial,
): ManifestMaterialEmissionAnimation | null {
  return material.emissionAnimation ?? null
}

export function getSortedMaterialEmissionKeyframes(
  animation: ManifestMaterialEmissionAnimation,
) {
  return [...animation.keyframes].sort((left, right) => left.time - right.time)
}

export function getMaterialEmissionAnimationDuration(
  animation: ManifestMaterialEmissionAnimation,
) {
  const lastKeyframe = getSortedMaterialEmissionKeyframes(animation).at(-1)

  return lastKeyframe ? lastKeyframe.time : 0
}

export function normalizeMaterialEmission(
  emission: ManifestMaterialEmission,
): ResolvedMaterialEmission {
  const hasEmission = emission.hasEmission && emission.intensity > emissionEpsilon

  return {
    color: emission.color,
    hasEmission,
    intensity: hasEmission ? emission.intensity : 0,
  }
}

function interpolateMaterialEmission(
  keyframes: readonly ManifestMaterialEmissionKeyframe[],
  time: number,
) {
  const lastIndex = keyframes.length - 1

  if (lastIndex <= 0 || time <= keyframes[0].time) {
    return normalizeMaterialEmission(keyframes[0])
  }

  if (time >= keyframes[lastIndex].time) {
    return normalizeMaterialEmission(keyframes[lastIndex])
  }

  for (let index = 0; index < lastIndex; index += 1) {
    const current = keyframes[index]
    const next = keyframes[index + 1]

    if (time < current.time || time > next.time) {
      continue
    }

    const span = next.time - current.time
    const amount = span > 0 ? (time - current.time) / span : 0
    const currentEmission = normalizeMaterialEmission(current)
    const nextEmission = normalizeMaterialEmission(next)
    const color = new THREE.Color(currentEmission.color).lerp(
      new THREE.Color(nextEmission.color),
      amount,
    )
    const intensity =
      currentEmission.intensity +
      (nextEmission.intensity - currentEmission.intensity) * amount

    return {
      color: `#${color.getHexString()}`,
      hasEmission: intensity > emissionEpsilon,
      intensity: Math.max(0, intensity),
    }
  }

  return normalizeMaterialEmission(keyframes[lastIndex])
}

function getStepKeyframeIndex(
  keyframes: readonly ManifestMaterialEmissionKeyframe[],
  time: number,
) {
  let keyframeIndex = 0

  for (let index = 1; index < keyframes.length; index += 1) {
    if (keyframes[index].time > time) {
      break
    }

    keyframeIndex = index
  }

  return keyframeIndex
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
