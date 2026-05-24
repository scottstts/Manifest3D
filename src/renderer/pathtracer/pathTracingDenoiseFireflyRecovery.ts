import * as THREE from 'three'
import { pathTracingViewportConfig } from './pathTracingConfig'

export type PathTracingDenoiseFireflyRecoveryConfig =
  typeof pathTracingViewportConfig.denoise.emissiveFireflyRecovery

export type PathTracingDenoiseFireflySceneMetrics = {
  compactEmitterRisk: number
  darkDiffuseReceiverArea: number
  emissiveArea: number
  maxEmissiveLuminance: number
  roughDiffuseReceiverArea: number
}

type MeshLike = THREE.Object3D & {
  geometry: THREE.BufferGeometry
  isMesh: true
  material: THREE.Material | THREE.Material[]
}

type MaterialWithFireflyRiskFields = THREE.Material & {
  color?: THREE.Color
  emissive?: THREE.Color
  emissiveIntensity?: number
  metalness?: number
  opacity?: number
  roughness?: number
  transparent?: boolean
}

type EmissiveSurface = {
  area: number
  luminance: number
}

const colorLuminanceWeights = new THREE.Vector3(0.2126, 0.7152, 0.0722)

export function getPathTracingDenoiseEmissiveFireflyRecoveryStrength(
  scene: THREE.Scene,
  config: PathTracingDenoiseFireflyRecoveryConfig = pathTracingViewportConfig
    .denoise.emissiveFireflyRecovery,
) {
  return getPathTracingDenoiseEmissiveFireflyRecoveryStrengthForMetrics(
    getPathTracingDenoiseEmissiveFireflySceneMetrics(scene, config),
    config,
  )
}

export function getPathTracingDenoiseEmissiveFireflyRecoveryStrengthForMetrics(
  metrics: PathTracingDenoiseFireflySceneMetrics,
  config: PathTracingDenoiseFireflyRecoveryConfig = pathTracingViewportConfig
    .denoise.emissiveFireflyRecovery,
) {
  if (
    !config.enabled ||
    metrics.maxEmissiveLuminance <= 0 ||
    metrics.roughDiffuseReceiverArea <= 0 ||
    metrics.compactEmitterRisk <= 0
  ) {
    return 0
  }

  const darkReceiverRatio =
    metrics.darkDiffuseReceiverArea / metrics.roughDiffuseReceiverArea
  const darkReceiverAreaRatio =
    metrics.darkDiffuseReceiverArea / Math.max(metrics.emissiveArea, 0.000001)
  const darkReceiverScore = Math.max(
    smoothstep(0.18, 0.72, darkReceiverRatio),
    smoothstep(1.5, 10, darkReceiverAreaRatio) * 0.8,
  )
  const fireflyRisk = metrics.compactEmitterRisk * darkReceiverScore

  return smoothstep(config.sceneRiskThreshold, 1, fireflyRisk)
}

export function getPathTracingDenoiseEmissiveFireflySceneMetrics(
  scene: THREE.Scene,
  config: PathTracingDenoiseFireflyRecoveryConfig = pathTracingViewportConfig
    .denoise.emissiveFireflyRecovery,
): PathTracingDenoiseFireflySceneMetrics {
  const emitters: EmissiveSurface[] = []
  let darkDiffuseReceiverArea = 0
  let emissiveArea = 0
  let maxEmissiveLuminance = 0
  let roughDiffuseReceiverArea = 0

  scene.updateMatrixWorld(true)
  scene.traverse((object) => {
    if (!isVisibleMeshLike(object)) {
      return
    }

    const meshArea = getMeshSurfaceArea(object)
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material]
    const materialArea = meshArea / Math.max(materials.length, 1)

    for (const material of materials) {
      const source = material as MaterialWithFireflyRiskFields
      const emissiveLuminance = getMaterialEmissiveLuminance(source)

      if (emissiveLuminance > 0) {
        const safeArea = Math.max(materialArea, 0.000001)

        emitters.push({
          area: safeArea,
          luminance: emissiveLuminance,
        })
        emissiveArea += safeArea
        maxEmissiveLuminance = Math.max(maxEmissiveLuminance, emissiveLuminance)
        continue
      }

      if (!isRoughDiffuseReceiver(source, config)) {
        continue
      }

      const receiverArea = Math.max(materialArea, 0)
      const receiverLuminance = getMaterialBaseLuminance(source)
      const darkReceiverWeight =
        1 -
        smoothstep(
          config.darkReceiverLowLuminance,
          config.darkReceiverHighLuminance,
          receiverLuminance,
        )

      roughDiffuseReceiverArea += receiverArea
      darkDiffuseReceiverArea += receiverArea * darkReceiverWeight
    }
  })

  const compactEmitterRisk = emitters.reduce((maxRisk, emitter) => {
    const areaRatio =
      emitter.area / Math.max(roughDiffuseReceiverArea + emitter.area, 0.000001)
    const smallEmitterScore =
      1 -
      smoothstep(
        config.smallEmitterAreaRatio,
        config.wideEmitterAreaRatio,
        areaRatio,
      )
    const strongEmissionScore = smoothstep(
      config.strongEmissionLuminance,
      config.extremeEmissionLuminance,
      emitter.luminance,
    )
    const extremeEmissionScore = smoothstep(
      config.extremeEmissionLuminance * 0.65,
      config.extremeEmissionLuminance,
      emitter.luminance,
    )
    const emitterRisk =
      strongEmissionScore *
      Math.max(smallEmitterScore, extremeEmissionScore * 0.75)

    return Math.max(maxRisk, emitterRisk)
  }, 0)

  return {
    compactEmitterRisk,
    darkDiffuseReceiverArea,
    emissiveArea,
    maxEmissiveLuminance,
    roughDiffuseReceiverArea,
  }
}

function isRoughDiffuseReceiver(
  material: MaterialWithFireflyRiskFields,
  config: PathTracingDenoiseFireflyRecoveryConfig,
) {
  return (
    !isTransparentMaterial(material) &&
    (material.roughness ?? 1) >= config.receiverRoughnessMin &&
    (material.metalness ?? 0) <= config.receiverMetalnessMax
  )
}

function isTransparentMaterial(material: MaterialWithFireflyRiskFields) {
  return Boolean(material.transparent) || (material.opacity ?? 1) < 0.999
}

function getMaterialBaseLuminance(material: MaterialWithFireflyRiskFields) {
  const color = material.color ?? new THREE.Color(1, 1, 1)

  return color.r * colorLuminanceWeights.x +
    color.g * colorLuminanceWeights.y +
    color.b * colorLuminanceWeights.z
}

function getMaterialEmissiveLuminance(material: MaterialWithFireflyRiskFields) {
  const emissive = material.emissive ?? new THREE.Color(0, 0, 0)
  const intensity = Math.max(material.emissiveIntensity ?? 0, 0)

  return (
    (emissive.r * colorLuminanceWeights.x +
      emissive.g * colorLuminanceWeights.y +
      emissive.b * colorLuminanceWeights.z) *
    intensity
  )
}

function getMeshSurfaceArea(mesh: MeshLike) {
  const position = mesh.geometry.attributes.position

  if (!position) {
    return getBoundingBoxSurfaceArea(mesh)
  }

  const index = mesh.geometry.index
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  let area = 0

  if (index) {
    for (let i = 0; i + 2 < index.count; i += 3) {
      a.fromBufferAttribute(position, index.getX(i)).applyMatrix4(mesh.matrixWorld)
      b.fromBufferAttribute(position, index.getX(i + 1)).applyMatrix4(
        mesh.matrixWorld,
      )
      c.fromBufferAttribute(position, index.getX(i + 2)).applyMatrix4(
        mesh.matrixWorld,
      )
      area += getTriangleArea(a, b, c)
    }
  } else {
    for (let i = 0; i + 2 < position.count; i += 3) {
      a.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
      b.fromBufferAttribute(position, i + 1).applyMatrix4(mesh.matrixWorld)
      c.fromBufferAttribute(position, i + 2).applyMatrix4(mesh.matrixWorld)
      area += getTriangleArea(a, b, c)
    }
  }

  return area > 0 ? area : getBoundingBoxSurfaceArea(mesh)
}

function getTriangleArea(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
  return b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5
}

function getBoundingBoxSurfaceArea(mesh: MeshLike) {
  const bounds = new THREE.Box3().setFromObject(mesh)

  if (bounds.isEmpty()) {
    return 0
  }

  const size = bounds.getSize(new THREE.Vector3())

  return Math.max(
    2 * (size.x * size.y + size.x * size.z + size.y * size.z),
    0,
  )
}

function isVisibleMeshLike(object: THREE.Object3D): object is MeshLike {
  return (object as MeshLike).isMesh === true && object.visible
}

function smoothstep(edge0: number, edge1: number, value: number) {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1
  }

  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)

  return t * t * (3 - 2 * t)
}
