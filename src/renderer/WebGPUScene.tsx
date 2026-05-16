import { OrbitControls } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useFrame, useThree } from '@react-three/fiber'
import type { ComponentRef, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three/webgpu'
import {
  buildManifestAsset,
  disposeManifestObject,
  findManifestObjectData,
} from '../engine/geometry/assetBuilder'
import type { ManifestAsset } from '../engine/schema/manifestTypes'
import { getProjectionViewOffset } from './effectiveViewport'
import { CameraQuaternionBridge } from './ViewportGizmo'

type WebGPUSceneProps = {
  assets: readonly ManifestAsset[]
  cameraQuaternionRef: RefObject<THREE.Quaternion>
  onCameraQuaternionChange: () => void
  rightPanelOcclusionWidth: number
  selectedAssetId: string | null
  selectionRevision: number
  onAssetSelected: (assetId: string, partId?: string | null) => void
  onSelectionCleared: () => void
}

type OrbitControlsHandle = ComponentRef<typeof OrbitControls>
type AssetGroupRegistry = RefObject<Map<string, THREE.Group>>

export function WebGPUScene({
  assets,
  cameraQuaternionRef,
  onCameraQuaternionChange,
  rightPanelOcclusionWidth,
  selectedAssetId,
  selectionRevision,
  onAssetSelected,
  onSelectionCleared,
}: WebGPUSceneProps) {
  const assetGroupsRef = useRef(new Map<string, THREE.Group>())
  const controlsRef = useRef<OrbitControlsHandle | null>(null)
  const invalidate = useThree((state) => state.invalidate)
  const registerAssetGroup = useCallback((assetId: string, group: THREE.Group) => {
    assetGroupsRef.current.set(assetId, group)

    return () => {
      if (assetGroupsRef.current.get(assetId) === group) {
        assetGroupsRef.current.delete(assetId)
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
        selectedAssetId={selectedAssetId}
        selectionRevision={selectionRevision}
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
          asset={asset}
          isSelected={asset.id === selectedAssetId}
          key={asset.id}
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
        maxDistance={9}
        maxPolarAngle={Math.PI * 0.49}
        minDistance={2.2}
        onChange={() => invalidate()}
        target={[0, 0, -0.2]}
      />
    </>
  )
}

type ManifestAssetObjectProps = {
  asset: ManifestAsset
  isSelected: boolean
  onAssetSelected: (assetId: string, partId?: string | null) => void
  onSelectionCleared: () => void
  registerAssetGroup: (
    assetId: string,
    group: THREE.Group,
  ) => () => void
}

function ManifestAssetObject({
  asset,
  isSelected,
  onAssetSelected,
  onSelectionCleared,
  registerAssetGroup,
}: ManifestAssetObjectProps) {
  const builtAsset = useMemo(() => buildManifestAsset(asset), [asset])
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    const unregister = registerAssetGroup(asset.id, builtAsset.group)

    return () => {
      unregister()
      disposeManifestObject(builtAsset.group)
    }
  }, [asset.id, builtAsset.group, registerAssetGroup])

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

    onAssetSelected(asset.id, manifestData?.partId ?? null)
  }

  return <primitive object={builtAsset.group} onClick={handleClick} />
}

type SelectionCameraTargetProps = {
  assetGroupsRef: AssetGroupRegistry
  controlsRef: RefObject<OrbitControlsHandle | null>
  selectedAssetId: string | null
  selectionRevision: number
}

function SelectionCameraTarget({
  assetGroupsRef,
  controlsRef,
  selectedAssetId,
  selectionRevision,
}: SelectionCameraTargetProps) {
  const invalidate = useThree((state) => state.invalidate)
  const isSnappingRef = useRef(false)
  const targetRef = useRef(new THREE.Vector3(0, 0, -0.2))

  useEffect(() => {
    if (!selectedAssetId) {
      isSnappingRef.current = false
      invalidate()
      return
    }

    const assetGroup = assetGroupsRef.current.get(selectedAssetId)

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
  }, [assetGroupsRef, invalidate, selectedAssetId, selectionRevision])

  useFrame(() => {
    const controls = controlsRef.current

    if (!selectedAssetId || !controls || !isSnappingRef.current) {
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
