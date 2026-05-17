import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import { createValidValidationFixtureAsset } from '../examples/validationFixtures'
import {
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
  materials?: Array<{
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
