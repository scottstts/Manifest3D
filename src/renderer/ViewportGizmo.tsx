import { GizmoHelper, GizmoViewport } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { RefObject } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import { Quaternion } from 'three'
import { createFiberWebGPURenderer } from './createRenderer'

type CameraQuaternionRef = RefObject<Quaternion>

type CameraQuaternionBridgeProps = {
  cameraQuaternionRef: CameraQuaternionRef
  onCameraQuaternionChange?: () => void
}

type ViewportGizmoOverlayProps = {
  cameraQuaternionRef: CameraQuaternionRef
  cameraQuaternionRevision: number
  isSidePanelCollapsed: boolean
}

const gizmoRendererFactory = createFiberWebGPURenderer as Parameters<
  typeof Canvas
>[0]['gl']

export function CameraQuaternionBridge({
  cameraQuaternionRef,
  onCameraQuaternionChange,
}: CameraQuaternionBridgeProps) {
  const hasPreviousQuaternionRef = useRef(false)
  const previousQuaternionRef = useRef(new Quaternion())

  useFrame(({ camera }) => {
    cameraQuaternionRef.current.copy(camera.quaternion)

    if (
      !hasPreviousQuaternionRef.current ||
      previousQuaternionRef.current.angleTo(camera.quaternion) > 0.0001
    ) {
      hasPreviousQuaternionRef.current = true
      previousQuaternionRef.current.copy(camera.quaternion)
      onCameraQuaternionChange?.()
    }
  })

  return null
}

export function ViewportGizmoOverlay({
  cameraQuaternionRef,
  cameraQuaternionRevision,
  isSidePanelCollapsed,
}: ViewportGizmoOverlayProps) {
  const gizmoDpr = useMemo(() => Math.min(window.devicePixelRatio, 2), [])

  return (
    <div
      aria-hidden="true"
      className={`viewport-gizmo-overlay${
        isSidePanelCollapsed ? ' is-panel-collapsed' : ''
      }`}
    >
      <Canvas
        camera={{ position: [0, 0, 5] }}
        dpr={gizmoDpr}
        frameloop="demand"
        gl={gizmoRendererFactory}
      >
        <GizmoInvalidator revision={cameraQuaternionRevision} />
        <SyncedDreiGizmo cameraQuaternionRef={cameraQuaternionRef} />
      </Canvas>
    </div>
  )
}

type GizmoInvalidatorProps = {
  revision: number
}

function GizmoInvalidator({ revision }: GizmoInvalidatorProps) {
  const invalidate = useThree((state) => state.invalidate)

  useEffect(() => {
    invalidate()
  }, [invalidate, revision])

  return null
}

function SyncedDreiGizmo({
  cameraQuaternionRef,
}: Pick<CameraQuaternionBridgeProps, 'cameraQuaternionRef'>) {
  useFrame(({ camera }) => {
    camera.quaternion.copy(cameraQuaternionRef.current)
    camera.updateMatrixWorld()
  })

  return (
    <GizmoHelper alignment="center-center" margin={[0, 0]}>
      <GizmoViewport
        axisColors={['#ff405d', '#78bd16', '#3b91ef']}
        disabled
        labelColor="#ffffff"
      />
    </GizmoHelper>
  )
}
