import * as THREE from 'three/webgpu'
import {
  getSortedMaterialEmissionKeyframes,
  type ResolvedMaterialEmission,
} from '../geometry/materialAnimations'
import type {
  ManifestAsset,
  ManifestMaterial,
  ManifestMaterialEmissionAnimation,
  ManifestMaterialEmissionInterpolation,
} from '../schema/manifestTypes'

type GltfJson = {
  accessors?: GltfAccessor[]
  animations?: GltfAnimation[]
  buffers?: Array<{ byteLength: number }>
  bufferViews?: GltfBufferView[]
  extensionsRequired?: string[]
  extensionsUsed?: string[]
  materials?: GltfMaterial[]
}

type GltfAccessor = {
  bufferView: number
  componentType: number
  count: number
  max?: number[]
  min?: number[]
  type: 'SCALAR' | 'VEC3'
}

type GltfAnimation = {
  channels: GltfAnimationChannel[]
  name?: string
  samplers: GltfAnimationSampler[]
}

type GltfAnimationChannel = {
  sampler: number
  target: {
    extensions: {
      KHR_animation_pointer: {
        pointer: string
      }
    }
  }
}

type GltfAnimationSampler = {
  input: number
  interpolation: 'LINEAR' | 'STEP'
  output: number
}

type GltfBufferView = {
  buffer: number
  byteLength: number
  byteOffset?: number
}

type GltfMaterial = {
  emissiveFactor?: number[]
  extensions?: {
    KHR_materials_emissive_strength?: {
      emissiveStrength: number
    }
    [extensionName: string]: unknown
  }
  name?: string
}

type ParsedGlb = {
  binaryChunk: Uint8Array
  json: GltfJson
}

type FloatAccessorResult = {
  accessorIndex: number
  bytes: Uint8Array
}

const glbHeaderBytes = 12
const glbChunkPrefixBytes = 8
const glbMagic = 0x46546c67
const glbVersion = 2
const glbChunkTypeJson = 0x4e4f534a
const glbChunkTypeBin = 0x004e4942
const webglFloat = 0x1406

export function appendMaterialEmissionAnimationsToGlb(
  arrayBuffer: ArrayBuffer,
  asset: ManifestAsset,
) {
  const parsedGlb = parseGlb(arrayBuffer)
  const json = parsedGlb.json
  const materialAnimations = asset.materials
    .map((material) => ({
      animation: material.emissionAnimation ?? null,
      material,
    }))
    .filter(
      (entry): entry is {
        animation: ManifestMaterialEmissionAnimation
        material: ManifestMaterial
      } => entry.animation !== null,
    )

  if (materialAnimations.length === 0) {
    return arrayBuffer
  }

  const baseBinaryLength =
    json.buffers?.[0]?.byteLength ?? parsedGlb.binaryChunk.byteLength
  const baseBinary = parsedGlb.binaryChunk.slice(0, baseBinaryLength)
  const appendedChunks: Uint8Array[] = []

  json.accessors ??= []
  json.animations ??= []
  json.bufferViews ??= []
  json.buffers ??= [{ byteLength: baseBinary.byteLength }]
  json.materials ??= []
  const buffers = json.buffers
  const materials = json.materials
  addExtensionDeclaration(json, 'KHR_animation_pointer', true)
  addExtensionDeclaration(json, 'KHR_materials_emissive_strength', true)

  for (const { animation, material } of materialAnimations) {
    const materialIndex = findGltfMaterialIndex(json, material.id)

    if (materialIndex < 0) {
      throw new Error(
        `Dynamic GLB export could not find material "${material.id}" in exported glTF.`,
      )
    }

    const keyframes = getSortedMaterialEmissionKeyframes(animation)

    if (keyframes.length < 2) {
      continue
    }

    const firstEmission = resolveExportKeyframeEmission(keyframes[0])
    const times = keyframes.map((keyframe) => keyframe.time)
    const colors = keyframes.flatMap((keyframe) =>
      colorToLinearFactor(keyframe.color),
    )
    const strengths = keyframes.map((keyframe) =>
      resolveExportKeyframeEmission(keyframe).intensity,
    )
    const timeAccessor = appendFloatAccessor(json, appendedChunks, {
      baseBinaryLength,
      itemSize: 1,
      values: times,
    })
    const colorAccessor = appendFloatAccessor(json, appendedChunks, {
      baseBinaryLength,
      itemSize: 3,
      values: colors,
    })
    const strengthAccessor = appendFloatAccessor(json, appendedChunks, {
      baseBinaryLength,
      itemSize: 1,
      values: strengths,
    })

    writeMaterialEmissionBase(materials[materialIndex], firstEmission)
    json.animations.push(
      createMaterialEmissionAnimation(
        animation,
        materialIndex,
        timeAccessor.accessorIndex,
        colorAccessor.accessorIndex,
        strengthAccessor.accessorIndex,
      ),
    )
  }

  const binaryChunk = concatUint8Arrays([baseBinary, ...appendedChunks])

  buffers[0].byteLength = binaryChunk.byteLength

  return packGlb(json, binaryChunk)
}

function createMaterialEmissionAnimation(
  animation: ManifestMaterialEmissionAnimation,
  materialIndex: number,
  timeAccessorIndex: number,
  colorAccessorIndex: number,
  strengthAccessorIndex: number,
): GltfAnimation {
  const interpolation = gltfInterpolation(animation.interpolation)

  return {
    channels: [
      {
        sampler: 0,
        target: {
          extensions: {
            KHR_animation_pointer: {
              pointer: `/materials/${materialIndex}/emissiveFactor`,
            },
          },
        },
      },
      {
        sampler: 1,
        target: {
          extensions: {
            KHR_animation_pointer: {
              pointer:
                `/materials/${materialIndex}` +
                '/extensions/KHR_materials_emissive_strength/emissiveStrength',
            },
          },
        },
      },
    ],
    name: `${animation.name} Emission`,
    samplers: [
      {
        input: timeAccessorIndex,
        interpolation,
        output: colorAccessorIndex,
      },
      {
        input: timeAccessorIndex,
        interpolation,
        output: strengthAccessorIndex,
      },
    ],
  }
}

function appendFloatAccessor(
  json: GltfJson,
  appendedChunks: Uint8Array[],
  options: {
    baseBinaryLength: number
    itemSize: 1 | 3
    values: readonly number[]
  },
): FloatAccessorResult {
  const accessors = json.accessors ??= []
  const bufferViews = json.bufferViews ??= []
  const bytes = floatsToBytes(options.values)
  const byteOffset =
    options.baseBinaryLength +
    appendedChunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const bufferViewIndex = bufferViews.push({
    buffer: 0,
    byteLength: bytes.byteLength,
    byteOffset,
  }) - 1
  const accessorIndex = accessors.push({
    bufferView: bufferViewIndex,
    componentType: webglFloat,
    count: options.values.length / options.itemSize,
    ...getAccessorMinMax(options.values, options.itemSize),
    type: options.itemSize === 1 ? 'SCALAR' : 'VEC3',
  }) - 1

  appendedChunks.push(bytes)

  return {
    accessorIndex,
    bytes,
  }
}

function writeMaterialEmissionBase(
  material: GltfMaterial,
  emission: ResolvedMaterialEmission,
) {
  material.emissiveFactor = colorToLinearFactor(emission.color)
  material.extensions ??= {}
  material.extensions.KHR_materials_emissive_strength = {
    emissiveStrength: emission.intensity,
  }
}

function resolveExportKeyframeEmission(
  keyframe: ManifestMaterialEmissionAnimation['keyframes'][number],
): ResolvedMaterialEmission {
  return {
    color: keyframe.color,
    hasEmission: keyframe.hasEmission && keyframe.intensity > 0,
    intensity: keyframe.hasEmission ? keyframe.intensity : 0,
  }
}

function findGltfMaterialIndex(json: GltfJson, materialId: string) {
  return json.materials?.findIndex((material) => material.name === materialId) ?? -1
}

function addExtensionDeclaration(
  json: GltfJson,
  extensionName: string,
  required: boolean,
) {
  json.extensionsUsed = addUnique(json.extensionsUsed, extensionName)

  if (required) {
    json.extensionsRequired = addUnique(json.extensionsRequired, extensionName)
  }
}

function addUnique(values: string[] | undefined, value: string) {
  return values?.includes(value) ? values : [...(values ?? []), value]
}

function gltfInterpolation(
  interpolation: ManifestMaterialEmissionInterpolation,
): 'LINEAR' | 'STEP' {
  return interpolation === 'step' ? 'STEP' : 'LINEAR'
}

function colorToLinearFactor(color: string) {
  return new THREE.Color(color).toArray()
}

function floatsToBytes(values: readonly number[]) {
  const arrayBuffer = new ArrayBuffer(values.length * 4)
  const view = new DataView(arrayBuffer)

  values.forEach((value, index) => {
    view.setFloat32(index * 4, value, true)
  })

  return new Uint8Array(arrayBuffer)
}

function getAccessorMinMax(values: readonly number[], itemSize: 1 | 3) {
  const min = new Array(itemSize).fill(Number.POSITIVE_INFINITY)
  const max = new Array(itemSize).fill(Number.NEGATIVE_INFINITY)

  for (let index = 0; index < values.length; index += itemSize) {
    for (let component = 0; component < itemSize; component += 1) {
      const value = values[index + component]

      min[component] = Math.min(min[component], value)
      max[component] = Math.max(max[component], value)
    }
  }

  return {
    max,
    min,
  }
}

function parseGlb(arrayBuffer: ArrayBuffer): ParsedGlb {
  const view = new DataView(arrayBuffer)

  if (view.getUint32(0, true) !== glbMagic) {
    throw new Error('Material animation export expected a binary GLB input.')
  }

  if (view.getUint32(4, true) !== glbVersion) {
    throw new Error('Material animation export only supports GLB version 2.')
  }

  const jsonChunkLength = view.getUint32(glbHeaderBytes, true)
  const jsonChunkType = view.getUint32(glbHeaderBytes + 4, true)

  if (jsonChunkType !== glbChunkTypeJson) {
    throw new Error('Material animation export could not find the GLB JSON chunk.')
  }

  const jsonStart = glbHeaderBytes + glbChunkPrefixBytes
  const json = JSON.parse(
    new TextDecoder().decode(
      new Uint8Array(arrayBuffer, jsonStart, jsonChunkLength),
    ),
  ) as GltfJson
  const binaryChunkPrefixStart = jsonStart + jsonChunkLength

  if (binaryChunkPrefixStart >= arrayBuffer.byteLength) {
    return {
      binaryChunk: new Uint8Array(),
      json,
    }
  }

  const binaryChunkLength = view.getUint32(binaryChunkPrefixStart, true)
  const binaryChunkType = view.getUint32(binaryChunkPrefixStart + 4, true)

  if (binaryChunkType !== glbChunkTypeBin) {
    throw new Error('Material animation export could not find the GLB BIN chunk.')
  }

  return {
    binaryChunk: new Uint8Array(
      arrayBuffer,
      binaryChunkPrefixStart + glbChunkPrefixBytes,
      binaryChunkLength,
    ),
    json,
  }
}

function packGlb(json: GltfJson, binaryChunk: Uint8Array) {
  const jsonChunk = padBytes(
    new TextEncoder().encode(JSON.stringify(json)),
    0x20,
  )
  const paddedBinaryChunk = padBytes(binaryChunk, 0)
  const totalByteLength =
    glbHeaderBytes +
    glbChunkPrefixBytes +
    jsonChunk.byteLength +
    glbChunkPrefixBytes +
    paddedBinaryChunk.byteLength
  const arrayBuffer = new ArrayBuffer(totalByteLength)
  const view = new DataView(arrayBuffer)
  const bytes = new Uint8Array(arrayBuffer)
  let offset = 0

  view.setUint32(offset, glbMagic, true)
  view.setUint32(offset + 4, glbVersion, true)
  view.setUint32(offset + 8, totalByteLength, true)
  offset += glbHeaderBytes
  view.setUint32(offset, jsonChunk.byteLength, true)
  view.setUint32(offset + 4, glbChunkTypeJson, true)
  offset += glbChunkPrefixBytes
  bytes.set(jsonChunk, offset)
  offset += jsonChunk.byteLength
  view.setUint32(offset, paddedBinaryChunk.byteLength, true)
  view.setUint32(offset + 4, glbChunkTypeBin, true)
  offset += glbChunkPrefixBytes
  bytes.set(paddedBinaryChunk, offset)

  return arrayBuffer
}

function padBytes(bytes: Uint8Array, paddingByte: number) {
  const paddedLength = alignTo4(bytes.byteLength)
  const padded = new Uint8Array(paddedLength)

  padded.set(bytes)

  if (paddingByte !== 0) {
    padded.fill(paddingByte, bytes.byteLength)
  }

  return padded
}

function concatUint8Arrays(chunks: readonly Uint8Array[]) {
  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const result = new Uint8Array(byteLength)
  let offset = 0

  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }

  return result
}

function alignTo4(byteLength: number) {
  return Math.ceil(byteLength / 4) * 4
}
