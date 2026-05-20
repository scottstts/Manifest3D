import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import { createValidValidationFixtureAsset } from '../examples/validationFixtures'
import {
  canExportManifestAssetAnimation,
  cloneExportableObject,
  countExportableMeshes,
  createGlbFileName,
  exportManifestAssetGlb,
} from './exportGlb'

describe('GLB export', () => {
  beforeAll(() => {
    vi.stubGlobal('FileReader', TestFileReader)
  })

  it('exports a Manifest3D asset as binary GLB', async () => {
    const result = await exportManifestAssetGlb(createValidValidationFixtureAsset())

    expect(result.fileName).toBe('validation-crate.glb')
    expect(result.blob.type).toBe('model/gltf-binary')
    expect(readGlbMagic(result.arrayBuffer)).toBe('glTF')
    const gltf = readGlbJson(result.arrayBuffer)

    expect(JSON.stringify(gltf)).not.toContain('manifest3d')
    expect(gltf.materials).toHaveLength(2)
    expect(gltf.materials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pbrMetallicRoughness: expect.objectContaining({
            baseColorFactor: [
              expect.closeTo(0.3915724777393922, 5),
              expect.closeTo(0.3515325994898463, 5),
              expect.closeTo(1, 5),
              1,
            ],
            metallicFactor: 0.05,
            roughnessFactor: 0.46,
          }),
        }),
        expect.objectContaining({
          pbrMetallicRoughness: expect.objectContaining({
            baseColorFactor: [
              expect.closeTo(0.9301108583738498, 5),
              expect.closeTo(0.9215818562755338, 5),
              expect.closeTo(1, 5),
              1,
            ],
            metallicFactor: 0,
            roughnessFactor: 0.38,
          }),
        }),
      ]),
    )
    expect(gltf.meshes?.every((mesh) => typeof mesh.primitives[0].material === 'number')).toBe(true)
  })

  it('includes joint animation clips when exporting a movable asset as dynamic GLB', async () => {
    const result = await exportManifestAssetGlb(createValidValidationFixtureAsset(), {
      mode: 'dynamic',
    })
    const gltf = readGlbJson(result.arrayBuffer)
    const animation = gltf.animations?.[0]
    const target = animation?.channels[0].target

    expect(animation?.name).toBe('Lid Motion')
    expect(animation?.channels).toEqual([
      expect.objectContaining({
        target: expect.objectContaining({
          path: 'rotation',
        }),
      }),
    ])
    expect(typeof target?.node).toBe('number')
    expect(gltf.nodes?.[target?.node ?? -1]?.name).toBe('Lid Hinge')
  })

  it('reuses one exported material slot for visuals sharing a manifest material', async () => {
    const asset = createValidValidationFixtureAsset()

    asset.parts[0].visuals.push({
      id: 'crate-base-side-rib',
      geometry: {
        size: [0.1, 0.08, 0.54],
        type: 'box',
      },
      materialId: 'mat-violet',
      name: 'Base side rib',
      transform: {
        position: [0.43, 0.24, 0],
      },
    })

    const result = await exportManifestAssetGlb(asset)
    const gltf = readGlbJson(result.arrayBuffer)

    expect(
      gltf.materials?.filter((material) => material.name === 'mat-violet'),
    ).toHaveLength(1)
  })

  it('exports material emission animation with KHR_animation_pointer in dynamic GLB', async () => {
    const result = await exportManifestAssetGlb(
      createMaterialEmissionAnimationFixtureAsset(),
      { mode: 'dynamic' },
    )
    const gltf = readGlbJson(result.arrayBuffer)
    const materialIndex =
      gltf.materials?.findIndex((material) => material.name === 'mat-violet') ??
      -1
    const animation = gltf.animations?.find(
      (candidate) => candidate.name === 'Beacon Emission',
    )
    const pointers = animation?.channels.map(
      (channel) => channel.target.extensions?.KHR_animation_pointer?.pointer,
    )

    expect(gltf.extensionsUsed).toEqual(
      expect.arrayContaining([
        'KHR_animation_pointer',
        'KHR_materials_emissive_strength',
      ]),
    )
    expect(gltf.extensionsRequired).toEqual(
      expect.arrayContaining([
        'KHR_animation_pointer',
        'KHR_materials_emissive_strength',
      ]),
    )
    expect(materialIndex).toBeGreaterThanOrEqual(0)
    expect(gltf.materials?.[materialIndex]).toMatchObject({
      emissiveFactor: [1, 0, 0],
      extensions: {
        KHR_materials_emissive_strength: {
          emissiveStrength: 4,
        },
      },
    })
    expect(animation?.samplers).toHaveLength(2)
    expect(animation?.samplers.every((sampler) => sampler.interpolation === 'STEP')).toBe(true)
    expect(pointers).toEqual([
      `/materials/${materialIndex}/emissiveFactor`,
      `/materials/${materialIndex}/extensions/KHR_materials_emissive_strength/emissiveStrength`,
    ])
    expect(animation?.channels.every((channel) => channel.target.node === undefined)).toBe(true)
    expect(gltf.accessors?.[animation?.samplers[0].input ?? -1]).toMatchObject({
      componentType: 5126,
      count: 4,
      type: 'SCALAR',
    })
  })

  it('omits material emission animation channels from static GLB export', async () => {
    const result = await exportManifestAssetGlb(
      createMaterialEmissionAnimationFixtureAsset(),
      { mode: 'static' },
    )
    const gltf = readGlbJson(result.arrayBuffer)

    expect(gltf.animations).toBeUndefined()
    expect(gltf.extensionsUsed ?? []).not.toContain('KHR_animation_pointer')
  })

  it('detects export animation capability from movable joints', () => {
    const movableAsset = createValidValidationFixtureAsset()
    const staticAsset = createValidValidationFixtureAsset()
    const materialAnimatedAsset = createMaterialEmissionAnimationFixtureAsset()

    staticAsset.joints = staticAsset.joints.map((joint) => ({
      ...joint,
      limits: undefined,
      type: 'fixed',
    }))
    staticAsset.controls = []

    expect(canExportManifestAssetAnimation(movableAsset)).toBe(true)
    expect(canExportManifestAssetAnimation(staticAsset)).toBe(false)
    expect(canExportManifestAssetAnimation(materialAnimatedAsset)).toBe(true)
  })

  it('strips helpers, non-exportable objects, and userData from cloned export objects', () => {
    const source = new THREE.Group()
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardNodeMaterial({
        color: '#cc2244',
        metalness: 0.4,
        roughness: 0.35,
      }),
    )
    const skippedMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial(),
    )

    source.name = 'Source Asset'
    source.userData.manifest3d = { assetId: 'source', kind: 'asset' }
    mesh.name = 'Exported Mesh'
    mesh.userData.manifest3d = {
      assetId: 'source',
      kind: 'visual',
      visualId: 'visual',
    }
    mesh.geometry.userData.manifest3dBounds = { min: [0, 0, 0] }
    mesh.material.userData.manifest3dMaterial = true
    skippedMesh.userData.exportable = false
    source.add(mesh)
    source.add(skippedMesh)
    source.add(new THREE.GridHelper(10, 10))
    source.add(new THREE.AxesHelper(1))
    source.add(new THREE.LineSegments(new THREE.BufferGeometry()))

    const cloned = cloneExportableObject(source)
    const exportedMeshes: THREE.Mesh[] = []

    cloned.traverse((object) => {
      expect(object.userData).toEqual({})

      if ((object as THREE.Mesh).isMesh === true) {
        exportedMeshes.push(object as THREE.Mesh)
      }
    })

    expect(countExportableMeshes(cloned)).toBe(1)
    expect(exportedMeshes[0].name).toBe('Exported Mesh')
    expect(exportedMeshes[0].geometry.userData).toEqual({})
    expect(Array.isArray(exportedMeshes[0].material)).toBe(false)
    expect((exportedMeshes[0].material as THREE.Material).userData).toEqual({})
    expect(
      (exportedMeshes[0].material as THREE.MeshStandardMaterial)
        .isMeshStandardMaterial,
    ).toBe(true)
  })

  it('uses stable filesystem-safe GLB names', () => {
    expect(
      createGlbFileName({
        id: 'asset-id',
        name: '  Brass / Hinged Crate! ',
      }),
    ).toBe('brass-hinged-crate.glb')
    expect(createGlbFileName({ id: 'asset-id', name: '---' })).toBe(
      'asset-id.glb',
    )
  })
})

function createMaterialEmissionAnimationFixtureAsset() {
  const asset = createValidValidationFixtureAsset()

  return {
    ...asset,
    id: 'material-emission-crate',
    name: 'Material Emission Crate',
    controls: [],
    joints: asset.joints.map((joint) => ({
      ...joint,
      axis: undefined,
      limits: undefined,
      type: 'fixed' as const,
    })),
    materials: asset.materials.map((material) =>
      material.id === 'mat-violet'
        ? {
            ...material,
            emission: {
              color: '#ff0000',
              hasEmission: true,
              intensity: 4,
            },
            emissionAnimation: {
              id: 'beacon-emission',
              interpolation: 'step' as const,
              keyframes: [
                {
                  color: '#ff0000',
                  hasEmission: true,
                  intensity: 4,
                  time: 0,
                },
                {
                  color: '#ff0000',
                  hasEmission: false,
                  intensity: 0,
                  time: 0.4,
                },
                {
                  color: '#0000ff',
                  hasEmission: true,
                  intensity: 4,
                  time: 0.8,
                },
                {
                  color: '#0000ff',
                  hasEmission: false,
                  intensity: 0,
                  time: 1.2,
                },
              ],
              loop: true,
              name: 'Beacon',
            },
          }
        : {
            ...material,
            emission: null,
            emissionAnimation: null,
          },
    ),
  }
}

class TestFileReader {
  onloadend: (() => void) | null = null
  result: ArrayBuffer | string | null = null

  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((arrayBuffer) => {
      this.result = arrayBuffer
      this.onloadend?.()
    })
  }

  readAsDataURL() {
    throw new Error('readAsDataURL is not needed for binary GLB export tests.')
  }
}

function readGlbMagic(arrayBuffer: ArrayBuffer) {
  return new TextDecoder().decode(new Uint8Array(arrayBuffer, 0, 4))
}

type GltfJson = {
  accessors?: Array<{
    componentType?: number
    count?: number
    type?: string
  }>
  animations?: Array<{
    channels: Array<{
      target: {
        extensions?: {
          KHR_animation_pointer?: {
            pointer?: string
          }
        }
        node?: number
        path?: string
      }
    }>
    name?: string
    samplers: Array<{
      input: number
      interpolation?: string
    }>
  }>
  extensionsRequired?: string[]
  extensionsUsed?: string[]
  materials?: Array<{
    emissiveFactor?: number[]
    extensions?: {
      KHR_materials_emissive_strength?: {
        emissiveStrength?: number
      }
    }
    name?: string
    pbrMetallicRoughness?: {
      baseColorFactor?: number[]
      metallicFactor?: number
      roughnessFactor?: number
    }
  }>
  meshes?: Array<{
    primitives: Array<{
      material?: number
    }>
  }>
  nodes?: Array<{
    name?: string
  }>
}

function readGlbJson(arrayBuffer: ArrayBuffer): GltfJson {
  const view = new DataView(arrayBuffer)
  const jsonChunkLength = view.getUint32(12, true)
  const jsonChunkType = view.getUint32(16, true)

  expect(jsonChunkType).toBe(0x4e4f534a)

  return JSON.parse(
    new TextDecoder().decode(new Uint8Array(arrayBuffer, 20, jsonChunkLength)),
  ) as GltfJson
}
