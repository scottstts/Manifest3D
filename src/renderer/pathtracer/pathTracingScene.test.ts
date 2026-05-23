import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { ManifestAsset } from '../../engine/schema/manifestTypes'
import type { SceneAssetInstance } from '../../engine/scene/sceneStore'
import {
  createPathTracingStandardMaterial,
  rebuildPathTracingViewportScene,
} from './pathTracingScene'

describe('createPathTracingStandardMaterial', () => {
  it('creates a path-tracer-compatible standard material and preserves PBR fields', () => {
    const source = new THREE.MeshStandardMaterial({
      color: '#223344',
      emissive: '#ffcc66',
      emissiveIntensity: 2.5,
      metalness: 0.4,
      opacity: 0.5,
      roughness: 0.7,
      transparent: true,
    })
    source.name = 'warm-emitter'

    const converted = createPathTracingStandardMaterial(source, {
      emissionGain: 3,
    })

    expect(converted).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(converted).not.toBe(source)
    expect(converted.name).toBe('warm-emitter')
    expect(converted.color.getHexString()).toBe('223344')
    expect(converted.emissive.getHexString()).toBe('ffcc66')
    expect(converted.emissiveIntensity).toBeCloseTo(7.5)
    expect(converted.metalness).toBeCloseTo(0.4)
    expect(converted.roughness).toBeCloseTo(0.7)
    expect(converted.opacity).toBeCloseTo(0.5)
    expect(converted.transparent).toBe(true)
  })

  it('keeps non-emissive materials dark instead of inventing light', () => {
    const source = new THREE.MeshStandardMaterial({ color: '#ffffff' })
    const converted = createPathTracingStandardMaterial(source, {
      emissionGain: 10,
    })

    expect(converted.emissive.getHexString()).toBe('000000')
    expect(converted.emissiveIntensity).toBe(0)
  })
})


function createOffsetFixtureAsset(): ManifestAsset {
  return {
    allowances: [],
    checks: [],
    controls: [],
    id: 'offset-fixture',
    joints: [],
    materials: [
      {
        color: '#ffffff',
        id: 'mat-white',
        metalness: 0,
        name: 'White',
        roughness: 0.5,
      },
    ],
    metadata: {
      createdAt: '2026-05-23T00:00:00.000Z',
      generationStatus: 'ready',
      sourceImageIds: [],
      updatedAt: '2026-05-23T00:00:00.000Z',
    },
    name: 'Offset Fixture',
    parts: [
      {
        id: 'offset-part',
        name: 'Offset Part',
        visuals: [
          {
            geometry: {
              size: [2, 2, 2],
              type: 'box',
            },
            id: 'offset-box',
            materialId: 'mat-white',
            transform: {
              position: [4, 1, 0],
            },
          },
        ],
      },
    ],
    prompt: 'Create an intentionally offset box.',
    schemaVersion: 2,
    units: 'meters',
  }
}

function createSceneInstance(asset: ManifestAsset): SceneAssetInstance {
  return {
    asset,
    assetId: asset.id,
    instanceId: 'offset-instance',
    transform: {
      position: [10, 0, -2],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    versionId: 'offset-version',
  }
}

function findFirstMesh(scene: THREE.Scene): THREE.Mesh | null {
  for (const object of collectSceneObjects(scene)) {
    if (
      (object as THREE.Mesh).isMesh &&
      object.userData.manifest3d?.visualId === 'offset-box'
    ) {
      return object as THREE.Mesh
    }
  }

  return null
}

function collectSceneObjects(scene: THREE.Scene) {
  const objects: THREE.Object3D[] = []

  scene.traverse((object) => {
    objects.push(object)
  })

  return objects
}

describe('rebuildPathTracingViewportScene', () => {
  it('commits path-tracing asset placement matrices before the scene is uploaded', () => {
    const scene = new THREE.Scene()
    const asset = createOffsetFixtureAsset()

    rebuildPathTracingViewportScene({
      assets: [createSceneInstance(asset)],
      jointPreviewPosesByInstance: {},
      materialAnimationValuesByInstance: {},
      scene,
      worldMode: 'light',
    })

    const mesh = findFirstMesh(scene)

    if (!mesh) {
      throw new Error('Expected the rebuilt path-tracing scene to contain a mesh.')
    }

    expect(mesh.matrixWorld.elements[12]).toBeCloseTo(14, 6)
    expect(mesh.matrixWorld.elements[13]).toBeCloseTo(1, 6)
    expect(mesh.matrixWorld.elements[14]).toBeCloseTo(-2, 6)
  })

  it('uses only the key directional light as a path-traced shadow-casting directional source', () => {
    const scene = new THREE.Scene()

    rebuildPathTracingViewportScene({
      assets: [],
      jointPreviewPosesByInstance: {},
      materialAnimationValuesByInstance: {},
      scene,
      worldMode: 'light',
    })

    const directionalLights = collectSceneObjects(scene).filter(
      (object) => (object as THREE.DirectionalLight).isDirectionalLight,
    ) as THREE.DirectionalLight[]

    expect(directionalLights).toHaveLength(1)
    expect(directionalLights[0]?.name).toBe(
      'Manifest3D path tracing key directional light',
    )
    expect(directionalLights[0]?.castShadow).toBe(true)
    expect(scene.environment?.isTexture).toBe(true)
    expect(scene.environmentIntensity).toBeGreaterThan(0)
  })
})
