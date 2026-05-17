import { OrbitControls, TransformControls } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useFrame, useThree } from '@react-three/fiber'
import type { ComponentRef, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three/webgpu'
import {
  buildManifestAsset,
  disposeManifestObject,
  findManifestObjectData,
} from '../engine/geometry/assetBuilder'
import type {
  SceneAssetInstance,
  SceneTransform,
} from '../engine/scene/sceneStore'
import { getProjectionViewOffset } from './effectiveViewport'
import { CameraQuaternionBridge } from './ViewportGizmo'
import type { TransformTool } from './WebGPUCanvas'

type WebGPUSceneProps = {
  activeTransformTool: TransformTool
  assets: readonly SceneAssetInstance[]
  cameraQuaternionRef: RefObject<THREE.Quaternion>
  onCameraQuaternionChange: () => void
  rightPanelOcclusionWidth: number
  selectedTargetId: string | null
  selectionRevision: number
  onAssetSelected: (
    targetId: string,
    assetId?: string | null,
    partId?: string | null,
  ) => void
  onSelectionCleared: () => void
  onTransformChanged: (instanceId: string, transform: SceneTransform) => void
}

type OrbitControlsHandle = ComponentRef<typeof OrbitControls>
type AssetGroupHandle = {
  center: THREE.Vector3
  group: THREE.Group
}
type AssetGroupRegistry = RefObject<Map<string, AssetGroupHandle>>
type AssetLocalPlacement = {
  anchorOffset: THREE.Vector3
  center: THREE.Vector3
}
type OrbitDistanceLimits = {
  maxDistance: number
  minDistance: number
}

export function WebGPUScene({
  activeTransformTool,
  assets,
  cameraQuaternionRef,
  onCameraQuaternionChange,
  rightPanelOcclusionWidth,
  selectedTargetId,
  selectionRevision,
  onAssetSelected,
  onSelectionCleared,
  onTransformChanged,
}: WebGPUSceneProps) {
  const assetGroupsRef = useRef(new Map<string, AssetGroupHandle>())
  const controlsRef = useRef<OrbitControlsHandle | null>(null)
  const invalidate = useThree((state) => state.invalidate)
  const [assetGroupHandles, setAssetGroupHandles] = useState(
    new Map<string, AssetGroupHandle>(),
  )
  const selectedTransformHandle = selectedTargetId
    ? assetGroupHandles.get(selectedTargetId) ?? null
    : null
  const orbitDistanceLimits = computeOrbitDistanceLimits(
    assetGroupHandles,
    selectedTargetId,
  )
  const registerAssetGroup = useCallback((
    targetId: string,
    handle: AssetGroupHandle,
  ) => {
    assetGroupsRef.current.set(targetId, handle)
    setAssetGroupHandles(new Map(assetGroupsRef.current))

    return () => {
      if (assetGroupsRef.current.get(targetId) === handle) {
        assetGroupsRef.current.delete(targetId)
        setAssetGroupHandles(new Map(assetGroupsRef.current))
      }
    }
  }, [])

  return (
    <>
      <CameraQuaternionBridge
        cameraQuaternionRef={cameraQuaternionRef}
        onCameraQuaternionChange={onCameraQuaternionChange}
      />
      <EffectiveViewportProjection
        rightPanelOcclusionWidth={rightPanelOcclusionWidth}
      />
      <SelectionCameraTarget
        assetGroupsRef={assetGroupsRef}
        controlsRef={controlsRef}
        selectedTargetId={selectedTargetId}
        selectionRevision={selectionRevision}
      />
      <SelectedTransformControls
        activeTransformTool={activeTransformTool}
        center={selectedTransformHandle?.center ?? null}
        controlsRef={controlsRef}
        object={selectedTransformHandle?.group ?? null}
        selectedTargetId={selectedTargetId}
        onTransformChanged={onTransformChanged}
      />
      <fogExp2 attach="fog" args={['#efeff9', 0.018]} />

      <hemisphereLight args={['#ffffff', '#d9dbee', 1.35]} />
      <directionalLight
        castShadow
        intensity={1.9}
        position={[-4.4, 6.5, 3.6]}
        shadow-camera-bottom={-6}
        shadow-camera-far={18}
        shadow-camera-left={-6}
        shadow-camera-near={0.5}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-mapSize-height={2048}
        shadow-mapSize-width={2048}
      />
      <directionalLight color="#cbd5ff" intensity={0.62} position={[4.2, 3.2, -4.5]} />

      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[500, 500]} />
        <meshStandardMaterial color="#f4f3fb" metalness={0.05} roughness={0.36} />
      </mesh>

      {assets.map((asset) => (
        <ManifestAssetObject
          instance={asset}
          isSelected={asset.instanceId === selectedTargetId}
          key={`${asset.instanceId}:${asset.versionId ?? asset.asset.id}`}
          onAssetSelected={onAssetSelected}
          onSelectionCleared={onSelectionCleared}
          registerAssetGroup={registerAssetGroup}
        />
      ))}

      <OrbitControls
        ref={controlsRef}
        dampingFactor={0.06}
        enableDamping
        makeDefault
        maxDistance={orbitDistanceLimits.maxDistance}
        maxPolarAngle={Math.PI * 0.49}
        minDistance={orbitDistanceLimits.minDistance}
        onChange={() => invalidate()}
        target={[0, 0, -0.2]}
      />
    </>
  )
}

type ManifestAssetObjectProps = {
  instance: SceneAssetInstance
  isSelected: boolean
  onAssetSelected: (
    targetId: string,
    assetId?: string | null,
    partId?: string | null,
  ) => void
  onSelectionCleared: () => void
  registerAssetGroup: (
    assetId: string,
    handle: AssetGroupHandle,
  ) => () => void
}

function ManifestAssetObject({
  instance,
  isSelected,
  onAssetSelected,
  onSelectionCleared,
  registerAssetGroup,
}: ManifestAssetObjectProps) {
  const { asset } = instance
  const groupRef = useRef<THREE.Group | null>(null)
  const builtAsset = useMemo(() => buildManifestAsset(asset), [asset])
  const localPlacement = useMemo(
    () => computeLocalPlacement(builtAsset.group),
    [builtAsset.group],
  )
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    const group = groupRef.current

    if (!group) {
      return undefined
    }

    const unregister = registerAssetGroup(instance.instanceId, {
      center: localPlacement.anchorOffset,
      group,
    })

    return () => {
      unregister()
      disposeManifestObject(builtAsset.group)
    }
  }, [
    builtAsset.group,
    instance.instanceId,
    localPlacement.anchorOffset,
    registerAssetGroup,
  ])

  useEffect(() => {
    applySelectionEmphasis(builtAsset.group, isSelected)
    invalidate()
  }, [builtAsset.group, invalidate, isSelected])

  function handleClick(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation()

    if (event.shiftKey) {
      onSelectionCleared()
      return
    }

    const manifestData = findManifestObjectData(event.object)

    onAssetSelected(
      instance.instanceId,
      instance.assetId,
      manifestData?.partId ?? null,
    )
  }

  return (
    <group
      ref={groupRef}
      position={addVector3(
        instance.transform.position,
        localPlacement.anchorOffset,
      )}
      rotation={instance.transform.rotation}
      scale={instance.transform.scale}
      onClick={handleClick}
    >
      <group position={negateVector3(localPlacement.center)}>
        <primitive object={builtAsset.group} />
      </group>
    </group>
  )
}

type SelectionCameraTargetProps = {
  assetGroupsRef: AssetGroupRegistry
  controlsRef: RefObject<OrbitControlsHandle | null>
  selectedTargetId: string | null
  selectionRevision: number
}

function SelectionCameraTarget({
  assetGroupsRef,
  controlsRef,
  selectedTargetId,
  selectionRevision,
}: SelectionCameraTargetProps) {
  const invalidate = useThree((state) => state.invalidate)
  const isSnappingRef = useRef(false)
  const targetRef = useRef(new THREE.Vector3(0, 0, -0.2))

  useEffect(() => {
    if (!selectedTargetId) {
      isSnappingRef.current = false
      invalidate()
      return
    }

    const assetGroup = assetGroupsRef.current.get(selectedTargetId)?.group

    if (!assetGroup) {
      invalidate()
      return
    }

    assetGroup.updateWorldMatrix(true, true)

    const bounds = new THREE.Box3().setFromObject(assetGroup)

    if (!bounds.isEmpty()) {
      bounds.getCenter(targetRef.current)
      isSnappingRef.current = true
    }

    invalidate()
  }, [assetGroupsRef, invalidate, selectedTargetId, selectionRevision])

  useFrame(() => {
    const controls = controlsRef.current

    if (!selectedTargetId || !controls || !isSnappingRef.current) {
      return
    }

    if (controls.target.distanceToSquared(targetRef.current) < 0.000001) {
      isSnappingRef.current = false
      return
    }

    controls.target.lerp(targetRef.current, 0.12)
    controls.update()
    invalidate()
  })

  return null
}

type SelectedTransformControlsProps = {
  activeTransformTool: TransformTool
  center: THREE.Vector3 | null
  controlsRef: RefObject<OrbitControlsHandle | null>
  object: THREE.Object3D | null
  selectedTargetId: string | null
  onTransformChanged: (instanceId: string, transform: SceneTransform) => void
}

function SelectedTransformControls({
  activeTransformTool,
  center,
  controlsRef,
  object,
  selectedTargetId,
  onTransformChanged,
}: SelectedTransformControlsProps) {
  const invalidate = useThree((state) => state.invalidate)

  if (!activeTransformTool || !object || !selectedTargetId) {
    return null
  }

  return (
    <TransformControls
      mode={toTransformControlsMode(activeTransformTool)}
      object={object}
      onChange={() => invalidate()}
      onMouseDown={() => {
        if (controlsRef.current) {
          controlsRef.current.enabled = false
        }
      }}
      onMouseUp={() => {
        if (controlsRef.current) {
          controlsRef.current.enabled = true
        }

        onTransformChanged(
          selectedTargetId,
          readObjectTransform(object, center),
        )
      }}
      onObjectChange={() => {
        onTransformChanged(
          selectedTargetId,
          readObjectTransform(object, center),
        )
        invalidate()
      }}
    />
  )
}

function toTransformControlsMode(tool: Exclude<TransformTool, null>) {
  switch (tool) {
    case 'move':
      return 'translate'
    case 'rotate':
      return 'rotate'
    case 'scale':
      return 'scale'
    default:
      return assertNever(tool)
  }
}

function readObjectTransform(
  object: THREE.Object3D,
  center: THREE.Vector3 | null,
): SceneTransform {
  return {
    position: [
      object.position.x - (center?.x ?? 0),
      object.position.y - (center?.y ?? 0),
      object.position.z - (center?.z ?? 0),
    ],
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
    scale: [object.scale.x, object.scale.y, object.scale.z],
  }
}

function computeLocalPlacement(object: THREE.Object3D): AssetLocalPlacement {
  object.updateWorldMatrix(true, true)

  const bounds = new THREE.Box3().setFromObject(object)

  if (bounds.isEmpty()) {
    const center = new THREE.Vector3()

    return {
      anchorOffset: center.clone(),
      center,
    }
  }

  const center = bounds.getCenter(new THREE.Vector3())
  const anchorOffset = center.clone()

  anchorOffset.y -= bounds.min.y

  return {
    anchorOffset,
    center,
  }
}

function addVector3(
  left: readonly [number, number, number],
  right: THREE.Vector3,
): [number, number, number] {
  return [left[0] + right.x, left[1] + right.y, left[2] + right.z]
}

function negateVector3(vector: THREE.Vector3): [number, number, number] {
  return [-vector.x, -vector.y, -vector.z]
}

function computeOrbitDistanceLimits(
  assetGroupHandles: Map<string, AssetGroupHandle>,
  selectedTargetId: string | null,
): OrbitDistanceLimits {
  const selectedGroup = selectedTargetId
    ? assetGroupHandles.get(selectedTargetId)?.group
    : null
  const groups = selectedGroup
    ? [selectedGroup]
    : [...assetGroupHandles.values()].map((handle) => handle.group)

  if (groups.length === 0) {
    return {
      maxDistance: 24,
      minDistance: 0.18,
    }
  }

  const bounds = new THREE.Box3()

  for (const group of groups) {
    group.updateWorldMatrix(true, true)
    bounds.union(new THREE.Box3().setFromObject(group))
  }

  if (bounds.isEmpty()) {
    return {
      maxDistance: 24,
      minDistance: 0.18,
    }
  }

  const radius = Math.max(
    bounds.getBoundingSphere(new THREE.Sphere()).radius,
    0.05,
  )

  return {
    maxDistance: clamp(radius * 16, 8, 80),
    minDistance: clamp(radius + 0.12, 0.16, 12),
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

type EffectiveViewportProjectionProps = {
  rightPanelOcclusionWidth: number
}

function EffectiveViewportProjection({
  rightPanelOcclusionWidth,
}: EffectiveViewportProjectionProps) {
  const { camera, invalidate, size } = useThree()

  useEffect(() => {
    if (!isPerspectiveCamera(camera)) {
      return undefined
    }

    const viewOffset = getProjectionViewOffset(
      size.width,
      size.height,
      rightPanelOcclusionWidth,
    )

    if (viewOffset) {
      camera.setViewOffset(
        viewOffset.fullWidth,
        viewOffset.fullHeight,
        viewOffset.offsetX,
        viewOffset.offsetY,
        viewOffset.width,
        viewOffset.height,
      )
    } else {
      camera.clearViewOffset()
    }

    camera.updateProjectionMatrix()
    invalidate()

    return () => {
      camera.clearViewOffset()
      camera.updateProjectionMatrix()
      invalidate()
    }
  }, [camera, invalidate, rightPanelOcclusionWidth, size.height, size.width])

  return null
}

function applySelectionEmphasis(group: THREE.Group, isSelected: boolean) {
  group.traverse((object) => {
    if (!isMesh(object)) {
      return
    }

    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material]

    for (const material of materials) {
      if (!isStandardNodeMaterial(material)) {
        continue
      }

      material.emissive.set(isSelected ? '#7c5cff' : '#000000')
      material.emissiveIntensity = isSelected ? 0.14 : 0
      material.needsUpdate = true
    }
  })
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true
}

function isPerspectiveCamera(
  camera: THREE.Camera,
): camera is THREE.PerspectiveCamera {
  return (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true
}

function isStandardNodeMaterial(
  material: THREE.Material,
): material is THREE.MeshStandardNodeMaterial {
  return (
    (material as THREE.MeshStandardNodeMaterial).isMeshStandardNodeMaterial ===
    true
  )
}

function assertNever(value: never): never {
  throw new Error(`Unsupported transform tool: ${value}`)
}
