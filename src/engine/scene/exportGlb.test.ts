import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three/webgpu'
import type { ManifestAsset } from '../schema/manifestTypes'
import { createValidValidationFixtureAsset } from '../testing/validationFixtureAsset'
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

    expect(gltf.animations).toHaveLength(1)
    expect(animation?.name).toBe('Validation Crate Motion')
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

  it('combines independent joint controls into one symmetric asset animation clip', async () => {
    const result = await exportManifestAssetGlb(
      createIndependentFanAnimationFixtureAsset(),
      { mode: 'dynamic' },
    )
    const { binaryChunk, json: gltf } = readGlbJsonAndBinary(result.arrayBuffer)
    const animation = gltf.animations?.[0]

    if (!animation) {
      throw new Error('Expected one combined fan animation clip.')
    }

    const headChannel = findAnimationChannelByNodeName(
      gltf,
      animation,
      'Turnable head swivel',
    )
    const bladeChannel = findAnimationChannelByNodeName(
      gltf,
      animation,
      'Fan blade spin axis',
    )

    if (!headChannel || !bladeChannel) {
      throw new Error('Expected fan head and blade animation channels.')
    }

    const headSampler = animation.samplers[headChannel.sampler]
    const bladeSampler = animation.samplers[bladeChannel.sampler]

    if (!headSampler || !bladeSampler) {
      throw new Error('Expected fan animation samplers.')
    }

    const headTimes = readFloatAccessorValues(
      gltf,
      binaryChunk,
      headSampler.input,
    )
    const headAngles = readQuaternionAccessorValues(
      gltf,
      binaryChunk,
      headSampler.output,
    ).map(readSignedYAngle)
    const headSpeeds = getSegmentSpeeds(headTimes, headAngles)
    const bladeTimes = readFloatAccessorValues(
      gltf,
      binaryChunk,
      bladeSampler.input,
    )
    const repeatedHeadCycleIndex = headTimes.findIndex(
      (time) => Math.abs(time - 2) < 1e-5,
    )

    expect(gltf.animations).toHaveLength(1)
    expect(animation.name).toBe('Independent Fan Fixture Motion')
    expect(animation.channels).toHaveLength(2)
    expect(headSpeeds.length).toBeGreaterThan(3)
    expect(headTimes.at(-1)).toBeCloseTo(bladeTimes.at(-1) ?? -1, 5)
    expect(repeatedHeadCycleIndex).toBeGreaterThanOrEqual(0)
    expect(headAngles[repeatedHeadCycleIndex]).toBeCloseTo(0, 5)
    for (const speed of headSpeeds) {
      expect(speed).toBeCloseTo(headSpeeds[0], 5)
    }
    expect(
      hasVisibleQuaternionMotion(
        readFloatAccessorValues(gltf, binaryChunk, bladeSampler.output),
      ),
    ).toBe(true)
  })

  it('exports visible motion for fast linked joints in a wrapped control', async () => {
    const result = await exportManifestAssetGlb(
      createLinkedRotorAnimationFixtureAsset(),
      { mode: 'dynamic' },
    )
    const { binaryChunk, json: gltf } = readGlbJsonAndBinary(result.arrayBuffer)
    const animation = gltf.animations?.find(
      (candidate) => candidate.name === 'Linked Rotor Fixture Motion',
    )
    const tailChannel = animation?.channels.find((channel) => {
      const node = gltf.nodes?.[channel.target.node ?? -1]

      return node?.name === 'Tail rotor spin joint'
    })

    if (!animation || !tailChannel) {
      throw new Error('Expected linked tail rotor animation channel.')
    }

    const tailSampler = animation.samplers[tailChannel.sampler]

    if (!tailSampler) {
      throw new Error('Expected linked tail rotor animation sampler.')
    }

    expect(animation.channels).toHaveLength(2)
    expect(gltf.animations).toHaveLength(1)
    expect(gltf.accessors?.[tailSampler.input]?.count).toBeGreaterThan(5)
    expect(
      hasVisibleQuaternionMotion(
        readFloatAccessorValues(gltf, binaryChunk, tailSampler.output),
      ),
    ).toBe(true)
  })

  it('subdivides large revolute swing tracks to avoid quaternion interpolation stalls', async () => {
    const result = await exportManifestAssetGlb(
      createLargeRevoluteSwingFixtureAsset(),
      { mode: 'dynamic' },
    )
    const { binaryChunk, json: gltf } = readGlbJsonAndBinary(result.arrayBuffer)
    const animation = gltf.animations?.[0]

    if (!animation) {
      throw new Error('Expected large revolute swing animation.')
    }

    const swingChannel = findAnimationChannelByNodeName(
      gltf,
      animation,
      'Cab swing slew',
    )

    if (!swingChannel) {
      throw new Error('Expected cab swing channel.')
    }

    const swingSampler = animation.samplers[swingChannel.sampler]

    if (!swingSampler) {
      throw new Error('Expected cab swing sampler.')
    }

    const times = readFloatAccessorValues(gltf, binaryChunk, swingSampler.input)
    const quaternions = readQuaternionAccessorValues(
      gltf,
      binaryChunk,
      swingSampler.output,
    )
    const timeGaps = getSegmentGaps(times)
    const angularDistances = getQuaternionAngularDistances(quaternions)

    expect(times.length).toBeGreaterThan(4)
    expect(Math.max(...timeGaps)).toBeLessThanOrEqual(1.01)
    expect(Math.min(...angularDistances)).toBeGreaterThan(0.75)
  })

  it('exports connectorTube morph tracks when endpoint parts animate', async () => {
    const result = await exportManifestAssetGlb(
      createConnectorTubeAnimationFixtureAsset(),
      { mode: 'dynamic' },
    )
    const gltf = readGlbJson(result.arrayBuffer)
    const animation = gltf.animations?.find(
      (candidate) => candidate.name === 'Validation Crate Motion',
    )
    const weightChannel = animation?.channels.find(
      (channel) => channel.target.path === 'weights',
    )
    const connectorNode = gltf.nodes?.[weightChannel?.target.node ?? -1]
    const connectorMesh = gltf.meshes?.[connectorNode?.mesh ?? -1]

    expect(weightChannel).toBeDefined()
    expect(connectorNode?.name).toBe('Lid retainer cable')
    expect(connectorMesh?.primitives[0].targets?.length).toBeGreaterThan(0)
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

  it('exports double-sided manifest materials as glTF doubleSided materials', async () => {
    const asset = createValidValidationFixtureAsset()

    asset.materials[0] = {
      ...asset.materials[0],
      side: 'double',
    }

    const result = await exportManifestAssetGlb(asset)
    const gltf = readGlbJson(result.arrayBuffer)

    expect(
      gltf.materials?.find((material) => material.name === 'mat-violet'),
    ).toMatchObject({
      doubleSided: true,
    })
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
      (candidate) => candidate.name === 'Material Emission Crate Motion',
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
    expect(gltf.animations).toHaveLength(1)
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

  it('combines joint and material animation channels into one dynamic GLB clip', async () => {
    const result = await exportManifestAssetGlb(
      createJointAndMaterialAnimationFixtureAsset(),
      { mode: 'dynamic' },
    )
    const gltf = readGlbJson(result.arrayBuffer)
    const materialIndex =
      gltf.materials?.findIndex((material) => material.name === 'mat-violet') ??
      -1
    const animation = gltf.animations?.[0]
    const pointers = animation?.channels.map(
      (channel) => channel.target.extensions?.KHR_animation_pointer?.pointer,
    )

    expect(gltf.animations).toHaveLength(1)
    expect(animation?.name).toBe('Joint And Material Crate Motion')
    expect(
      animation?.channels.some((channel) => channel.target.path === 'rotation'),
    ).toBe(true)
    expect(pointers).toEqual(
      expect.arrayContaining([
        `/materials/${materialIndex}/emissiveFactor`,
        `/materials/${materialIndex}/extensions/KHR_materials_emissive_strength/emissiveStrength`,
      ]),
    )
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

function createJointAndMaterialAnimationFixtureAsset() {
  const asset = createValidValidationFixtureAsset()
  const materialAnimatedAsset = createMaterialEmissionAnimationFixtureAsset()

  return {
    ...asset,
    id: 'joint-and-material-crate',
    materials: materialAnimatedAsset.materials,
    name: 'Joint And Material Crate',
  }
}

function createConnectorTubeAnimationFixtureAsset() {
  const asset = createValidValidationFixtureAsset()

  asset.parts[0].visuals.push({
    geometry: {
      end: {
        partId: 'crate-lid',
        position: [0.45, 0.08, 0],
      },
      radius: 0.01,
      sag: 0.03,
      start: {
        partId: 'crate-base',
        position: [0.45, 0.42, 0],
      },
      tubularSegments: 16,
      radialSegments: 8,
      type: 'connectorTube',
    },
    id: 'lid-retainer-cable',
    materialId: 'mat-white',
    name: 'Lid retainer cable',
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  })

  return asset
}

function createIndependentFanAnimationFixtureAsset(): ManifestAsset {
  return {
    allowances: [],
    checks: [
      {
        partId: 'fan-base',
        type: 'part_exists',
      },
    ],
    controls: [
      {
        id: 'fan-head-turn',
        joints: [{ jointId: 'fan-head-swivel', offset: 0, scale: 1 }],
        limits: { lower: -0.8, upper: 0.8 },
        name: 'Turn Fan Head',
      },
      {
        id: 'fan-blade-spin',
        joints: [{ jointId: 'fan-blade-spin-axis', offset: 0, scale: 1 }],
        limits: { lower: 0, upper: Math.PI * 2 },
        name: 'Spin Fan Blades',
      },
    ],
    id: 'independent-fan-fixture',
    joints: [
      {
        axis: [0, 1, 0],
        childPartId: 'fan-head',
        id: 'fan-head-swivel',
        limits: {
          effort: 1,
          lower: -0.8,
          upper: 0.8,
          velocity: 1,
        },
        name: 'Turnable head swivel',
        origin: {
          position: [0, 0.5, 0],
        },
        parentPartId: 'fan-base',
        type: 'revolute',
      },
      {
        axis: [0, 0, 1],
        childPartId: 'fan-blades',
        id: 'fan-blade-spin-axis',
        limits: {
          effort: 1,
          velocity: 1,
        },
        name: 'Fan blade spin axis',
        origin: {
          position: [0, 0, 0.2],
        },
        parentPartId: 'fan-head',
        type: 'continuous',
      },
    ],
    materials: [
      {
        color: '#a0a6ad',
        id: 'mat-body',
        metalness: 0.2,
        name: 'Body',
        roughness: 0.5,
      },
    ],
    metadata: {
      createdAt: '2026-06-02T00:00:00.000Z',
      generationStatus: 'ready',
      sourceImageIds: [],
      updatedAt: '2026-06-02T00:00:00.000Z',
    },
    name: 'Independent Fan Fixture',
    parts: [
      {
        id: 'fan-base',
        name: 'Fan base',
        visuals: [
          {
            geometry: {
              size: [0.4, 0.2, 0.4],
              type: 'box',
            },
            id: 'fan-base-box',
            materialId: 'mat-body',
            transform: {
              position: [0, 0, 0],
            },
          },
        ],
      },
      {
        id: 'fan-head',
        name: 'Fan head',
        visuals: [
          {
            geometry: {
              size: [0.3, 0.3, 0.18],
              type: 'box',
            },
            id: 'fan-head-box',
            materialId: 'mat-body',
            transform: {
              position: [0, 0, 0],
            },
          },
        ],
      },
      {
        id: 'fan-blades',
        name: 'Fan blades',
        visuals: [
          {
            geometry: {
              size: [0.6, 0.04, 0.06],
              type: 'box',
            },
            id: 'fan-blade-bar',
            materialId: 'mat-body',
            transform: {
              position: [0, 0, 0],
            },
          },
        ],
      },
    ],
    prompt: 'Build a fan with independent head turn and blade spin controls.',
    schemaVersion: 2,
    units: 'meters',
  }
}

function createLinkedRotorAnimationFixtureAsset(): ManifestAsset {
  return {
    allowances: [],
    checks: [
      {
        partId: 'helicopter-body',
        type: 'part_exists',
      },
    ],
    controls: [
      {
        id: 'linked-rotor-spin',
        joints: [
          { jointId: 'main-rotor-spin', offset: 0, scale: 1 },
          { jointId: 'tail-rotor-spin', offset: 0, scale: 4 },
        ],
        limits: { lower: 0, upper: Math.PI * 2 },
        name: 'Linked rotor spin',
      },
    ],
    id: 'linked-rotor-fixture',
    joints: [
      {
        axis: [0, 1, 0],
        childPartId: 'main-rotor',
        id: 'main-rotor-spin',
        limits: {
          effort: 1,
          velocity: 1,
        },
        name: 'Main rotor spin joint',
        origin: {
          position: [0, 0.5, 0],
        },
        parentPartId: 'helicopter-body',
        type: 'continuous',
      },
      {
        axis: [0, 0, 1],
        childPartId: 'tail-rotor',
        id: 'tail-rotor-spin',
        limits: {
          effort: 1,
          velocity: 1,
        },
        name: 'Tail rotor spin joint',
        origin: {
          position: [1, 0.25, 0],
        },
        parentPartId: 'helicopter-body',
        type: 'continuous',
      },
    ],
    materials: [
      {
        color: '#a0a6ad',
        id: 'mat-body',
        metalness: 0.2,
        name: 'Body',
        roughness: 0.5,
      },
    ],
    metadata: {
      createdAt: '2026-06-02T00:00:00.000Z',
      generationStatus: 'ready',
      sourceImageIds: [],
      updatedAt: '2026-06-02T00:00:00.000Z',
    },
    name: 'Linked Rotor Fixture',
    parts: [
      {
        id: 'helicopter-body',
        name: 'Body',
        visuals: [
          {
            geometry: {
              size: [0.8, 0.2, 0.3],
              type: 'box',
            },
            id: 'body-box',
            materialId: 'mat-body',
            transform: {
              position: [0, 0, 0],
            },
          },
        ],
      },
      {
        id: 'main-rotor',
        name: 'Main rotor',
        visuals: [
          {
            geometry: {
              size: [0.8, 0.03, 0.06],
              type: 'box',
            },
            id: 'main-rotor-blade',
            materialId: 'mat-body',
            transform: {
              position: [0, 0, 0],
            },
          },
        ],
      },
      {
        id: 'tail-rotor',
        name: 'Tail rotor',
        visuals: [
          {
            geometry: {
              size: [0.3, 0.03, 0.05],
              type: 'box',
            },
            id: 'tail-rotor-blade',
            materialId: 'mat-body',
            transform: {
              position: [0, 0, 0],
            },
          },
        ],
      },
    ],
    prompt: 'Build a helicopter with linked main and tail rotor animation.',
    schemaVersion: 2,
    units: 'meters',
  }
}

function createLargeRevoluteSwingFixtureAsset(): ManifestAsset {
  return {
    allowances: [],
    checks: [
      {
        partId: 'crane-base',
        type: 'part_exists',
      },
    ],
    controls: [
      {
        id: 'cab-swing-control',
        joints: [{ jointId: 'cab-swing-slew', offset: 0, scale: 1 }],
        limits: { lower: -Math.PI, upper: Math.PI },
        name: 'Cab Swing',
      },
    ],
    id: 'large-revolute-swing-fixture',
    joints: [
      {
        axis: [0, 1, 0],
        childPartId: 'crane-cab',
        id: 'cab-swing-slew',
        limits: {
          effort: 1,
          lower: -Math.PI,
          upper: Math.PI,
          velocity: 1,
        },
        name: 'Cab swing slew',
        origin: {
          position: [0, 0.3, 0],
        },
        parentPartId: 'crane-base',
        type: 'revolute',
      },
    ],
    materials: [
      {
        color: '#8f949b',
        id: 'mat-steel',
        metalness: 0.2,
        name: 'Steel',
        roughness: 0.55,
      },
    ],
    metadata: {
      createdAt: '2026-06-02T00:00:00.000Z',
      generationStatus: 'ready',
      sourceImageIds: [],
      updatedAt: '2026-06-02T00:00:00.000Z',
    },
    name: 'Large Revolute Swing Fixture',
    parts: [
      {
        id: 'crane-base',
        name: 'Crane base',
        visuals: [
          {
            geometry: {
              size: [0.5, 0.3, 0.5],
              type: 'box',
            },
            id: 'crane-base-box',
            materialId: 'mat-steel',
            transform: {
              position: [0, 0, 0],
            },
          },
        ],
      },
      {
        id: 'crane-cab',
        name: 'Crane cab',
        visuals: [
          {
            geometry: {
              size: [0.3, 0.2, 0.2],
              type: 'box',
            },
            id: 'crane-cab-box',
            materialId: 'mat-steel',
            transform: {
              position: [0.3, 0, 0],
            },
          },
        ],
      },
    ],
    prompt: 'Build a crane cab with a large bounded slew swing.',
    schemaVersion: 2,
    units: 'meters',
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
    bufferView?: number
    byteOffset?: number
    componentType?: number
    count?: number
    type?: string
  }>
  animations?: Array<{
    channels: Array<{
      sampler: number
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
      output: number
    }>
  }>
  bufferViews?: Array<{
    byteLength?: number
    byteOffset?: number
    byteStride?: number
  }>
  extensionsRequired?: string[]
  extensionsUsed?: string[]
  materials?: Array<{
    doubleSided?: boolean
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
      targets?: Array<Record<string, number>>
    }>
  }>
  nodes?: Array<{
    mesh?: number
    name?: string
  }>
}

function readGlbJson(arrayBuffer: ArrayBuffer): GltfJson {
  return readGlbJsonAndBinary(arrayBuffer).json
}

function readGlbJsonAndBinary(arrayBuffer: ArrayBuffer) {
  const view = new DataView(arrayBuffer)
  const totalLength = view.getUint32(8, true)
  let offset = 12
  let json: GltfJson | null = null
  let binaryChunk = new Uint8Array()

  while (offset < totalLength) {
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    const chunkOffset = offset + 8

    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(
        new TextDecoder().decode(
          new Uint8Array(arrayBuffer, chunkOffset, chunkLength),
        ),
      ) as GltfJson
    } else if (chunkType === 0x004e4942) {
      binaryChunk = new Uint8Array(arrayBuffer, chunkOffset, chunkLength)
    }

    offset = chunkOffset + chunkLength
  }

  if (!json) {
    throw new Error('GLB does not contain a JSON chunk.')
  }

  return {
    binaryChunk,
    json,
  }
}

function readFloatAccessorValues(
  gltf: GltfJson,
  binaryChunk: Uint8Array,
  accessorIndex: number,
) {
  const accessor = gltf.accessors?.[accessorIndex]

  if (
    !accessor ||
    accessor.componentType !== 5126 ||
    typeof accessor.bufferView !== 'number' ||
    typeof accessor.count !== 'number' ||
    !accessor.type
  ) {
    throw new Error(`Accessor ${accessorIndex} is not a float accessor.`)
  }

  const bufferView = gltf.bufferViews?.[accessor.bufferView]
  const componentCount = getAccessorTypeComponentCount(accessor.type)

  if (!bufferView || componentCount === 0) {
    throw new Error(`Accessor ${accessorIndex} has no readable buffer view.`)
  }

  const itemByteSize = componentCount * Float32Array.BYTES_PER_ELEMENT
  const byteStride = bufferView.byteStride ?? itemByteSize
  const byteOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const values: number[] = []

  for (let itemIndex = 0; itemIndex < accessor.count; itemIndex += 1) {
    const itemOffset = byteOffset + itemIndex * byteStride

    for (
      let componentIndex = 0;
      componentIndex < componentCount;
      componentIndex += 1
    ) {
      values.push(
        new DataView(
          binaryChunk.buffer,
          binaryChunk.byteOffset + itemOffset + componentIndex * 4,
          4,
        ).getFloat32(0, true),
      )
    }
  }

  return values
}

function getAccessorTypeComponentCount(type: string) {
  switch (type) {
    case 'SCALAR':
      return 1
    case 'VEC2':
      return 2
    case 'VEC3':
      return 3
    case 'VEC4':
      return 4
    default:
      return 0
  }
}

function findAnimationChannelByNodeName(
  gltf: GltfJson,
  animation: NonNullable<GltfJson['animations']>[number],
  nodeName: string,
) {
  return animation.channels.find((channel) => {
    const node = gltf.nodes?.[channel.target.node ?? -1]

    return node?.name === nodeName
  })
}

function readQuaternionAccessorValues(
  gltf: GltfJson,
  binaryChunk: Uint8Array,
  accessorIndex: number,
) {
  const values = readFloatAccessorValues(gltf, binaryChunk, accessorIndex)
  const quaternions: Array<[number, number, number, number]> = []

  for (let index = 0; index + 3 < values.length; index += 4) {
    quaternions.push([
      values[index],
      values[index + 1],
      values[index + 2],
      values[index + 3],
    ])
  }

  return quaternions
}

function readSignedYAngle(quaternion: readonly [number, number, number, number]) {
  const [x, y, z, w] = quaternion
  const sinY = 2 * (w * y + z * x)
  const cosY = 1 - 2 * (y * y + x * x)

  return Math.atan2(sinY, cosY)
}

function getSegmentSpeeds(
  times: readonly number[],
  values: readonly number[],
) {
  const speeds: number[] = []

  for (let index = 1; index < times.length; index += 1) {
    const duration = times[index] - times[index - 1]

    if (duration <= 0) {
      continue
    }

    speeds.push(Math.abs(values[index] - values[index - 1]) / duration)
  }

  return speeds
}

function getSegmentGaps(times: readonly number[]) {
  const gaps: number[] = []

  for (let index = 1; index < times.length; index += 1) {
    gaps.push(times[index] - times[index - 1])
  }

  return gaps
}

function getQuaternionAngularDistances(
  quaternions: readonly (readonly [number, number, number, number])[],
) {
  const distances: number[] = []

  for (let index = 1; index < quaternions.length; index += 1) {
    const previous = quaternions[index - 1]
    const current = quaternions[index]
    const dot = Math.abs(
      previous[0] * current[0] +
        previous[1] * current[1] +
        previous[2] * current[2] +
        previous[3] * current[3],
    )

    distances.push(2 * Math.acos(Math.min(1, dot)))
  }

  return distances
}

function hasVisibleQuaternionMotion(values: readonly number[]) {
  for (let index = 0; index + 3 < values.length; index += 4) {
    const vectorMagnitude = Math.hypot(
      values[index],
      values[index + 1],
      values[index + 2],
    )
    const scalarDeviation = Math.abs(Math.abs(values[index + 3]) - 1)

    if (vectorMagnitude > 0.1 && scalarDeviation > 0.1) {
      return true
    }
  }

  return false
}
