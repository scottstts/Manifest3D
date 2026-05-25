import * as THREE from 'three'
import type { WebGLPathTracer } from 'three-gpu-pathtracer'
import { pathTracingViewportConfig } from './pathTracingConfig'

export type PathTracingEmissiveMeshSamplingConfig =
  typeof pathTracingViewportConfig.emissiveMeshSampling

export type PathTracingEmissiveMeshSamplingController = {
  dispose: () => void
  update: (scene: THREE.Scene) => PathTracingEmissiveMeshSamplingUpdate
}

export type PathTracingEmissiveMeshSamplingUpdate = {
  emitterTriangleCount: number
  strength: number
}

export type PathTracingEmissiveMeshSamplingRiskMetrics = {
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

type MaterialWithEmissiveSamplingFields = THREE.Material & {
  alphaMap?: THREE.Texture | null
  alphaTest?: number
  color?: THREE.Color
  emissive?: THREE.Color
  emissiveIntensity?: number
  emissiveMap?: THREE.Texture | null
  metalness?: number
  opacity?: number
  roughness?: number
  side?: THREE.Side
  transparent?: boolean
}

type EmissiveTriangle = {
  area: number
  emission: THREE.Color
  luminance: number
  side: number
  v0: THREE.Vector3
  v1: THREE.Vector3
  v2: THREE.Vector3
  weight: number
}

type PathTracingMaterialWithShader = THREE.ShaderMaterial & {
  setDefine?: (name: string, value?: unknown) => boolean
}

type PathTracingLightsUniform = {
  count: number
  tex: THREE.DataTexture
}

type WebGLPathTracerWithInternals = WebGLPathTracer & {
  _pathTracer?: {
    material?: PathTracingMaterialWithShader
  }
}

const colorLuminanceWeights = new THREE.Vector3(0.2126, 0.7152, 0.0722)
const emissiveTriangleTexels = 4
const emissiveMeshShaderPatchKey = 'manifest3dEmissiveMeshSamplingPatch'
const lightTexelsPerLight = 6

export function createPathTracingEmissiveMeshSamplingController(
  pathTracer: WebGLPathTracer,
  config: PathTracingEmissiveMeshSamplingConfig = pathTracingViewportConfig
    .emissiveMeshSampling,
): PathTracingEmissiveMeshSamplingController {
  const material = getPathTracerMaterial(pathTracer)
  const maxTriangles = getClampedMaxEmissiveTriangles(config.maxTriangles)

  installEmissiveMeshSamplingShaderPatch(material, {
    maxTriangles,
  })

  material.uniforms.emissiveMeshTriangleCount.value = 0
  material.uniforms.emissiveMeshSamplingStrength.value = 0
  material.uniforms.emissiveMeshTotalPower.value = 0
  material.uniforms.emissiveMeshTriangleTexelOffset.value = 0

  return {
    dispose() {},
    update(scene) {
      const sampleSet = buildPathTracingEmissiveMeshSampleSet(scene, config)
      const selectedTriangles = sampleSet.triangles.slice(0, maxTriangles)

      const lights = getPathTracingLightsUniform(material)
      const lightTexelOffset = lights.count * lightTexelsPerLight
      const totalTexels =
        lightTexelOffset + selectedTriangles.length * emissiveTriangleTexels
      const lightTextureData = ensureLightsTextureCapacity(lights.tex, totalTexels)

      lightTextureData.fill(0, lightTexelOffset * 4)
      writeEmissiveTriangleTextureData(
        lightTextureData,
        selectedTriangles,
        lightTexelOffset,
      )
      lights.tex.needsUpdate = true

      const strength =
        selectedTriangles.length > 0 ? sampleSet.samplingStrength : 0
      const totalPower = selectedTriangles.reduce(
        (sum, triangle) => sum + triangle.weight,
        0,
      )

      material.uniforms.emissiveMeshTriangleCount.value = selectedTriangles.length
      material.uniforms.emissiveMeshSamplingStrength.value = strength
      material.uniforms.emissiveMeshTotalPower.value = totalPower
      material.uniforms.emissiveMeshTriangleTexelOffset.value = lightTexelOffset

      return {
        emitterTriangleCount: selectedTriangles.length,
        strength,
      }
    },
  }
}

export function buildPathTracingEmissiveMeshSampleSet(
  scene: THREE.Scene,
  config: PathTracingEmissiveMeshSamplingConfig = pathTracingViewportConfig
    .emissiveMeshSampling,
) {
  const triangles: EmissiveTriangle[] = []
  const metrics: PathTracingEmissiveMeshSamplingRiskMetrics = {
    compactEmitterRisk: 0,
    darkDiffuseReceiverArea: 0,
    emissiveArea: 0,
    maxEmissiveLuminance: 0,
    roughDiffuseReceiverArea: 0,
  }

  if (!config.enabled) {
    return {
      metrics,
      samplingStrength: 0,
      triangles,
    }
  }

  scene.updateMatrixWorld(true)
  scene.traverse((object) => {
    if (!isVisibleMeshLike(object)) {
      return
    }

    collectMeshSamplingData(object, config, metrics, triangles)
  })

  metrics.compactEmitterRisk = getCompactEmitterRisk(
    triangles,
    metrics.roughDiffuseReceiverArea,
    config,
  )

  const samplingStrength =
    getPathTracingEmissiveMeshSamplingStrengthForMetrics(metrics, config)

  if (samplingStrength <= 0) {
    return {
      metrics,
      samplingStrength: 0,
      triangles: [],
    }
  }

  triangles.sort((a, b) => b.weight - a.weight)

  return {
    metrics,
    samplingStrength,
    triangles,
  }
}

export function getPathTracingEmissiveMeshSamplingStrengthForMetrics(
  metrics: PathTracingEmissiveMeshSamplingRiskMetrics,
  config: PathTracingEmissiveMeshSamplingConfig = pathTracingViewportConfig
    .emissiveMeshSampling,
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

  return smoothstep(
    config.sceneRiskThreshold,
    1,
    metrics.compactEmitterRisk * darkReceiverScore,
  )
}

function collectMeshSamplingData(
  mesh: MeshLike,
  config: PathTracingEmissiveMeshSamplingConfig,
  metrics: PathTracingEmissiveMeshSamplingRiskMetrics,
  triangles: EmissiveTriangle[],
) {
  const geometry = mesh.geometry
  const position = geometry.attributes.position

  if (!position) {
    return
  }

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const groups = geometry.groups.length > 0
    ? geometry.groups
    : [
        {
          count: getGeometryIndexCount(geometry),
          materialIndex: 0,
          start: 0,
        },
      ]
  const index = geometry.index
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()

  for (const group of groups) {
    const material = materials[group.materialIndex ?? 0] ?? materials[0]

    if (!material) {
      continue
    }

    const source = material as MaterialWithEmissiveSamplingFields
    const emission = getMaterialEmission(source)
    const emissionLuminance = getColorLuminance(emission)
    const groupEnd = Math.min(group.start + group.count, getGeometryIndexCount(geometry))
    let groupArea = 0

    for (let i = group.start; i + 2 < groupEnd; i += 3) {
      readTriangleVertices(mesh, index, position, i, a, b, c)

      const area = getTriangleArea(a, b, c)

      if (area <= 0) {
        continue
      }

      groupArea += area

      if (emissionLuminance <= 0 || !isOpaqueSampleableEmitter(source)) {
        continue
      }

      const weight = emissionLuminance * area

      triangles.push({
        area,
        emission: emission.clone(),
        luminance: emissionLuminance,
        side: getPathTracingMaterialSide(source.side ?? THREE.FrontSide),
        v0: a.clone(),
        v1: b.clone(),
        v2: c.clone(),
        weight,
      })
    }

    if (emissionLuminance > 0 && isOpaqueSampleableEmitter(source)) {
      metrics.emissiveArea += groupArea
      metrics.maxEmissiveLuminance = Math.max(
        metrics.maxEmissiveLuminance,
        emissionLuminance,
      )
      continue
    }

    if (!isRoughDiffuseReceiver(source, config)) {
      continue
    }

    const receiverLuminance = getColorLuminance(
      source.color ?? new THREE.Color(1, 1, 1),
    )
    const darkReceiverWeight =
      1 -
      smoothstep(
        config.darkReceiverLowLuminance,
        config.darkReceiverHighLuminance,
        receiverLuminance,
      )

    metrics.roughDiffuseReceiverArea += groupArea
    metrics.darkDiffuseReceiverArea += groupArea * darkReceiverWeight
  }
}

function installEmissiveMeshSamplingShaderPatch(
  material: PathTracingMaterialWithShader,
  {
    maxTriangles,
  }: {
    maxTriangles: number
  },
) {
  if (material.userData[emissiveMeshShaderPatchKey]) {
    return
  }

  material.userData[emissiveMeshShaderPatchKey] = true
  material.defines = {
    ...material.defines,
    EMISSIVE_MESH_SAMPLE_MAX_TRIANGLES: maxTriangles,
  }
  material.uniforms = {
    ...material.uniforms,
    emissiveMeshSamplingStrength: { value: 0 },
    emissiveMeshTotalPower: { value: 0 },
    emissiveMeshTriangleCount: { value: 0 },
    emissiveMeshTriangleTexelOffset: { value: 0 },
  }
  material.fragmentShader = patchPathTracingEmissiveMeshSamplingShader(
    material.fragmentShader,
  )
  markMaterialForSynchronousShaderCompile(material)
}

function markMaterialForSynchronousShaderCompile(
  material: PathTracingMaterialWithShader,
) {
  // MaterialBase dispatches an async recompilation event whose Three.js readiness
  // polling can see an undefined currentProgram during this startup-time patch.
  const materialNeedsUpdate = Object.getOwnPropertyDescriptor(
    THREE.Material.prototype,
    'needsUpdate',
  )?.set

  if (materialNeedsUpdate) {
    materialNeedsUpdate.call(material, true)
    return
  }

  const mutableMaterial = material as unknown as { version: number }
  mutableMaterial.version += 1
}

export function patchPathTracingEmissiveMeshSamplingShader(
  fragmentShader: string,
) {
  const withUniforms = replaceRequiredShaderChunk(
    fragmentShader,
    'uniform LightsInfo lights;',
    `uniform LightsInfo lights;
				uniform int emissiveMeshTriangleCount;
				uniform float emissiveMeshSamplingStrength;
				uniform float emissiveMeshTotalPower;
				uniform int emissiveMeshTriangleTexelOffset;`,
    'lighting uniforms',
  )
  const withHelpers = replaceRequiredShaderChunk(
    withUniforms,
    '\n\t\t\t\tvoid main() {',
    `${emissiveMeshSamplingShaderFunctions}

				void main() {`,
    'main entry',
  )
  const withPreviousReceiver = replaceRequiredShaderChunk(
    withHelpers,
    '\t\t\t\t\tScatterRecord scatterRec;',
    `\t\t\t\t\tScatterRecord scatterRec;
					float emissiveMeshPreviousReceiverConfidence = 0.0;`,
    'scatter record',
  )
  const withDirectSampling = replaceRequiredShaderChunk(
    withPreviousReceiver,
    '\t\t\t\t\t\tgl_FragColor.rgb += directLightContribution( - ray.direction, surf, state, hitPoint );',
    `\t\t\t\t\t\tgl_FragColor.rgb += directLightContribution( - ray.direction, surf, state, hitPoint );
						gl_FragColor.rgb += emissiveMeshDirectContribution( - ray.direction, surf, state, hitPoint );`,
    'direct light contribution',
  )
  const withHitMis = replaceRequiredShaderChunk(
    withDirectSampling,
    '\t\t\t\t\t\tgl_FragColor.rgb += ( surf.emission * state.throughputColor );',
    '\t\t\t\t\t\tgl_FragColor.rgb += emissiveMeshHitContribution( surf.emission, ray.direction, surfaceHit, scatterRec, state, emissiveMeshPreviousReceiverConfidence );',
    'emissive hit contribution',
  )

  return replaceRequiredShaderChunk(
    withHitMis,
    '\t\t\t\t\t\tray.direction = scatterRec.direction;',
    `\t\t\t\t\t\temissiveMeshPreviousReceiverConfidence = emissiveMeshReceiverConfidence( surf );
						ray.direction = scatterRec.direction;`,
    'next ray direction',
  )
}

function replaceRequiredShaderChunk(
  source: string,
  search: string,
  replacement: string,
  label: string,
) {
  const result = source.replace(search, replacement)

  if (result === source) {
    throw new Error(
      `Unable to patch path tracer emissive mesh sampling shader at ${label}.`,
    )
  }

  return result
}

const emissiveMeshSamplingShaderFunctions = /* glsl */ `

				vec4 emissiveMeshReadTriangleTexel( int triangleIndex, int texelOffset ) {

					int texelIndex =
						emissiveMeshTriangleTexelOffset +
						triangleIndex * 4 +
						texelOffset;
					return texelFetch1D( lights.tex, uint( texelIndex ) );

				}

				int emissiveMeshSelectTriangle( float r ) {

					for ( int i = 0; i < EMISSIVE_MESH_SAMPLE_MAX_TRIANGLES; i ++ ) {

						if ( i >= emissiveMeshTriangleCount ) {

							break;

						}

						vec4 texel0 = emissiveMeshReadTriangleTexel( i, 0 );
						if ( r <= texel0.w ) {

							return i;

						}

					}

					return max( emissiveMeshTriangleCount - 1, 0 );

				}

				float emissiveMeshReceiverConfidence( SurfaceRecord surf ) {

					if (
						emissiveMeshSamplingStrength <= 0.0 ||
						surf.volumeParticle ||
						surf.transmission > 0.05 ||
						luminance( surf.emission ) > 0.0001
					) {

						return 0.0;

					}

					float rough = smoothstep( 0.2, 0.7, surf.roughness );
					float dielectric = 1.0 - smoothstep( 0.04, 0.36, surf.metalness );

					return clamp( rough * dielectric * emissiveMeshSamplingStrength, 0.0, 1.0 );

				}

				float emissiveMeshLightSideCos( float side, vec3 normal, vec3 directionToLight ) {

					float frontCos = dot( normal, - directionToLight );

					if ( abs( side ) < 0.5 ) {

						return abs( frontCos );

					}

					return side * frontCos;

				}

				vec3 emissiveMeshDirectContribution(
					vec3 worldWo,
					SurfaceRecord surf,
					RenderState state,
					vec3 rayOrigin
				) {

					float receiverConfidence = emissiveMeshReceiverConfidence( surf );
					if (
						receiverConfidence <= 0.0 ||
						emissiveMeshTriangleCount <= 0 ||
						emissiveMeshTotalPower <= 0.0
					) {

						return vec3( 0.0 );

					}

					vec3 r = rand3( 17 );
					int triangleIndex = emissiveMeshSelectTriangle( r.x );
					vec4 texel0 = emissiveMeshReadTriangleTexel( triangleIndex, 0 );
					vec4 texel1 = emissiveMeshReadTriangleTexel( triangleIndex, 1 );
					vec4 texel2 = emissiveMeshReadTriangleTexel( triangleIndex, 2 );
					vec4 texel3 = emissiveMeshReadTriangleTexel( triangleIndex, 3 );
					vec3 v0 = texel0.xyz;
					vec3 v1 = texel1.xyz;
					vec3 v2 = texel2.xyz;
					float area = texel1.w;
					float side = texel2.w;
					vec3 emission = texel3.rgb;
					float selectionPdf = texel3.w;
					float su = sqrt( clamp( r.y, 0.0, 1.0 ) );
					vec3 lightPosition =
						v0 * ( 1.0 - su ) +
						v1 * ( su * ( 1.0 - r.z ) ) +
						v2 * ( su * r.z );
					vec3 offsetToLight = lightPosition - rayOrigin;
					float distSq = dot( offsetToLight, offsetToLight );

					if ( distSq <= RAY_OFFSET || area <= 0.0 || selectionPdf <= 0.0 ) {

						return vec3( 0.0 );

					}

					float dist = sqrt( distSq );
					vec3 directionToLight = offsetToLight / dist;
					vec3 lightNormal = normalize( cross( v1 - v0, v2 - v0 ) );
					float surfaceCos = dot( surf.faceNormal, directionToLight );
					float lightCos = emissiveMeshLightSideCos( side, lightNormal, directionToLight );

					if (
						surfaceCos <= 0.0 ||
						lightCos <= 0.0001 ||
						! isDirectionValid( directionToLight, surf.normal, surf.faceNormal )
					) {

						return vec3( 0.0 );

					}

					float lightPdf = selectionPdf * distSq / max( area * lightCos, 0.0001 );
					vec3 sampleColor;
					float materialPdf = bsdfResult( worldWo, directionToLight, surf, sampleColor );
					bool isValidSampleColor = all( greaterThanEqual( sampleColor, vec3( 0.0 ) ) );
					if ( lightPdf <= 0.0 || materialPdf <= 0.0 || ! isValidSampleColor ) {

						return vec3( 0.0 );

					}

					Ray lightRay;
					lightRay.origin = rayOrigin;
					lightRay.direction = directionToLight;
					vec3 attenuatedColor;
					if ( attenuateHit( state, lightRay, max( dist - RAY_OFFSET * 2.0, 0.0 ), attenuatedColor ) ) {

						return vec3( 0.0 );

					}

					float misWeight = misHeuristic( lightPdf, materialPdf );
					return receiverConfidence *
						attenuatedColor *
						emission *
						state.throughputColor *
						sampleColor *
						misWeight /
						lightPdf;

				}

				vec3 emissiveMeshHitContribution(
					vec3 emission,
					vec3 rayDirection,
					SurfaceHit surfaceHit,
					ScatterRecord scatterRec,
					RenderState state,
					float previousReceiverConfidence
				) {

					float emissionLuminance = luminance( emission );
					if (
						emissiveMeshSamplingStrength <= 0.0 ||
						emissiveMeshTotalPower <= 0.0 ||
						emissionLuminance <= 0.0 ||
						state.firstRay ||
						state.transmissiveRay ||
						previousReceiverConfidence <= 0.0
					) {

						return emission * state.throughputColor;

					}

					float lightCos = abs( dot( surfaceHit.faceNormal, - rayDirection ) );
					float lightPdf =
						emissionLuminance *
						surfaceHit.dist *
						surfaceHit.dist /
						max( emissiveMeshTotalPower * lightCos, 0.0001 );
					float misWeight = misHeuristic( scatterRec.pdf, lightPdf );

					return emission *
						state.throughputColor *
						mix( 1.0, misWeight, clamp( previousReceiverConfidence, 0.0, 1.0 ) );

				}
`

function writeEmissiveTriangleTextureData(
  target: Float32Array,
  triangles: readonly EmissiveTriangle[],
  texelOffset: number,
) {
  const totalWeight = triangles.reduce((sum, triangle) => sum + triangle.weight, 0)
  let cdf = 0

  for (const [triangleIndex, triangle] of triangles.entries()) {
    const base = (texelOffset + triangleIndex * emissiveTriangleTexels) * 4
    const selectionProbability =
      totalWeight > 0 ? triangle.weight / totalWeight : 0

    cdf += selectionProbability
    writeVec3AndScalar(target, base, triangle.v0, cdf)
    writeVec3AndScalar(target, base + 4, triangle.v1, triangle.area)
    writeVec3AndScalar(target, base + 8, triangle.v2, triangle.side)
    target[base + 12] = triangle.emission.r
    target[base + 13] = triangle.emission.g
    target[base + 14] = triangle.emission.b
    target[base + 15] = selectionProbability
  }

  if (triangles.length > 0) {
    const lastBase = (triangles.length - 1) * emissiveTriangleTexels * 4

    target[lastBase + 3] = 1
  }
}

function writeVec3AndScalar(
  target: Float32Array,
  index: number,
  vector: THREE.Vector3,
  scalar: number,
) {
  target[index] = vector.x
  target[index + 1] = vector.y
  target[index + 2] = vector.z
  target[index + 3] = scalar
}

function ensureLightsTextureCapacity(texture: THREE.DataTexture, texelCount: number) {
  const requiredTexels = Math.max(1, texelCount)
  const nextDimension = Math.ceil(Math.sqrt(requiredTexels))

  if (
    texture.image.width < nextDimension ||
    texture.image.height < nextDimension
  ) {
    const previousData = texture.image.data as Float32Array
    const nextData = new Float32Array(nextDimension * nextDimension * 4)

    nextData.set(previousData.subarray(0, Math.min(previousData.length, nextData.length)))
    texture.dispose()
    texture.image.data = nextData
    texture.image.width = nextDimension
    texture.image.height = nextDimension
  }

  return texture.image.data as Float32Array
}

function getCompactEmitterRisk(
  triangles: readonly EmissiveTriangle[],
  roughDiffuseReceiverArea: number,
  config: PathTracingEmissiveMeshSamplingConfig,
) {
  return triangles.reduce((maxRisk, triangle) => {
    const areaRatio =
      triangle.area / Math.max(roughDiffuseReceiverArea + triangle.area, 0.000001)
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
      triangle.luminance,
    )
    const extremeEmissionScore = smoothstep(
      config.extremeEmissionLuminance * 0.65,
      config.extremeEmissionLuminance,
      triangle.luminance,
    )
    const triangleRisk =
      strongEmissionScore *
      Math.max(smallEmitterScore, extremeEmissionScore * 0.75)

    return Math.max(maxRisk, triangleRisk)
  }, 0)
}

function isRoughDiffuseReceiver(
  material: MaterialWithEmissiveSamplingFields,
  config: PathTracingEmissiveMeshSamplingConfig,
) {
  return (
    !isTransparentMaterial(material) &&
    (material.roughness ?? 1) >= config.receiverRoughnessMin &&
    (material.metalness ?? 0) <= config.receiverMetalnessMax
  )
}

function isOpaqueSampleableEmitter(material: MaterialWithEmissiveSamplingFields) {
  return (
    !isTransparentMaterial(material) &&
    !material.alphaMap &&
    (material.alphaTest ?? 0) <= 0 &&
    !material.emissiveMap
  )
}

function isTransparentMaterial(material: MaterialWithEmissiveSamplingFields) {
  return Boolean(material.transparent) || (material.opacity ?? 1) < 0.999
}

function getMaterialEmission(material: MaterialWithEmissiveSamplingFields) {
  const emissive = material.emissive ?? new THREE.Color(0, 0, 0)
  const emissiveIntensity = Math.max(material.emissiveIntensity ?? 0, 0)

  return emissive.clone().multiplyScalar(emissiveIntensity)
}

function getColorLuminance(color: THREE.Color) {
  return (
    color.r * colorLuminanceWeights.x +
    color.g * colorLuminanceWeights.y +
    color.b * colorLuminanceWeights.z
  )
}

function getGeometryIndexCount(geometry: THREE.BufferGeometry) {
  return geometry.index?.count ?? geometry.attributes.position?.count ?? 0
}

function readTriangleVertices(
  mesh: MeshLike,
  index: THREE.BufferAttribute | null,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  triangleStart: number,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
) {
  const aIndex = index ? index.getX(triangleStart) : triangleStart
  const bIndex = index ? index.getX(triangleStart + 1) : triangleStart + 1
  const cIndex = index ? index.getX(triangleStart + 2) : triangleStart + 2

  a.fromBufferAttribute(position, aIndex).applyMatrix4(mesh.matrixWorld)
  b.fromBufferAttribute(position, bIndex).applyMatrix4(mesh.matrixWorld)
  c.fromBufferAttribute(position, cIndex).applyMatrix4(mesh.matrixWorld)
}

function getTriangleArea(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
  return b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5
}

function getPathTracingMaterialSide(side: THREE.Side) {
  if (side === THREE.BackSide) {
    return -1
  }

  return side === THREE.DoubleSide ? 0 : 1
}

function getPathTracerMaterial(pathTracer: WebGLPathTracer) {
  const material = (pathTracer as WebGLPathTracerWithInternals)._pathTracer
    ?.material

  if (!material) {
    throw new Error('Path tracer material is unavailable for emissive sampling.')
  }

  return material
}

function getPathTracingLightsUniform(material: PathTracingMaterialWithShader) {
  const lights = material.uniforms.lights?.value as
    | PathTracingLightsUniform
    | undefined

  if (!lights?.tex) {
    throw new Error('Path tracer lights texture is unavailable for emissive sampling.')
  }

  return lights
}

function getClampedMaxEmissiveTriangles(maxTriangles: number) {
  if (!Number.isFinite(maxTriangles)) {
    return 512
  }

  return Math.max(1, Math.min(2048, Math.floor(maxTriangles)))
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
