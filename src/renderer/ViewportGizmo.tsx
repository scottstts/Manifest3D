import { GizmoHelper, GizmoViewport } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import type { RefObject } from 'react'
import { useMemo } from 'react'
import { Quaternion } from 'three'
import { createFiberWebGPURenderer } from './createRenderer'

type CameraQuaternionRef = RefObject<Quaternion>

type CameraQuaternionBridgeProps = {
  cameraQuaternionRef: CameraQuaternionRef
}

type ViewportGizmoOverlayProps = {
  cameraQuaternionRef: CameraQuaternionRef
  isSidePanelCollapsed: boolean
}

const gizmoRendererFactory = createFiberWebGPURenderer as Parameters<
  typeof Canvas
>[0]['gl']

export function CameraQuaternionBridge({
  cameraQuaternionRef,
}: CameraQuaternionBridgeProps) {
  useFrame(({ camera }) => {
    cameraQuaternionRef.current.copy(camera.quaternion)
  })

  return null
}

export function ViewportGizmoOverlay({
  cameraQuaternionRef,
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
        gl={gizmoRendererFactory}
      >
        <SyncedDreiGizmo cameraQuaternionRef={cameraQuaternionRef} />
      </Canvas>
    </div>
  )
}

function SyncedDreiGizmo({
  cameraQuaternionRef,
}: CameraQuaternionBridgeProps) {
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
