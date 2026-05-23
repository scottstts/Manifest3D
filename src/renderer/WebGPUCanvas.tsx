import { Canvas } from '@react-three/fiber'
import type { ComponentProps } from 'react'
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Quaternion } from 'three'
import type {
  SceneAssetInstance,
  SceneTransform,
} from '../engine/scene/sceneStore'
import type { JointPoseValues } from '../engine/geometry/jointPoses'
import type { MaterialAnimationValues } from '../engine/geometry/materialAnimations'
import { UnsupportedWebGPU } from '../ui/UnsupportedWebGPU'
import { computeRendererDpr, createFiberWebGPURenderer } from './createRenderer'
import { ViewportGizmoOverlay } from './ViewportGizmo'
import { WebGPUScene } from './WebGPUScene'
import {
  defaultViewportCameraConfig,
  type ViewportCameraSnapshot,
} from './viewportCamera'
import {
  getViewportNavigationBehavior,
  type ViewportRenderMode,
} from './viewportRenderMode'
import type { ViewportWorldMode } from './viewportWorld'

type CanvasStatus =
  | { type: 'checking' }
  | { type: 'initializing' }
  | { type: 'ready' }
  | { type: 'unsupported'; reason: string }
  | { type: 'error'; reason: string }

type WebGPUCanvasProps = {
  assets: readonly SceneAssetInstance[]
  activeTransformTool: TransformTool
  isSidePanelCollapsed: boolean
  jointPreviewPosesByInstance: Readonly<Record<string, JointPoseValues>>
  materialAnimationValuesByInstance: Readonly<Record<string, MaterialAnimationValues>>
  leftPanelOcclusionWidth: number
  renderMode: ViewportRenderMode
  rightPanelOcclusionWidth: number
  selectedTargetId: string | null
  selectionRevision: number
  worldMode: ViewportWorldMode
  onAssetSelected: (
    targetId: string,
    assetId?: string | null,
    partId?: string | null,
  ) => void
  onSelectionCleared: () => void
  onTransformChanged: (instanceId: string, transform: SceneTransform) => void
  onTransformEnded: () => void
  onTransformStarted: () => void
}

export type TransformTool = 'move' | 'rotate' | 'scale' | null

const webgpuRendererFactory =
  createFiberWebGPURenderer as unknown as NonNullable<
    ComponentProps<typeof Canvas>['gl']
  >

const PathTracingCanvas = lazy(() => import('./pathtracer/PathTracingCanvas'))

export function WebGPUCanvas({
  activeTransformTool,
  assets,
  isSidePanelCollapsed,
  jointPreviewPosesByInstance,
  materialAnimationValuesByInstance,
  leftPanelOcclusionWidth,
  renderMode,
  rightPanelOcclusionWidth,
  selectedTargetId,
  selectionRevision,
  worldMode,
  onAssetSelected,
  onSelectionCleared,
  onTransformChanged,
  onTransformEnded,
  onTransformStarted,
}: WebGPUCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cameraQuaternionRef = useRef(new Quaternion())
  const [status, setStatus] = useState<CanvasStatus>({ type: 'checking' })
  const [cameraQuaternionRevision, setCameraQuaternionRevision] = useState(0)
  const [cameraSnapshot, setCameraSnapshot] =
    useState<ViewportCameraSnapshot | null>(null)
  const [viewportSize, setViewportSize] = useState({ height: 1, width: 1 })

  const navigationBehavior = useMemo(
    () => getViewportNavigationBehavior(renderMode),
    [renderMode],
  )

  const rendererDpr = useMemo(
    () =>
      computeRendererDpr(
        viewportSize.width,
        viewportSize.height,
        window.devicePixelRatio,
      ),
    [viewportSize.height, viewportSize.width],
  )

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return undefined
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      const { height, width } = entry.contentRect

      setViewportSize({
        height: Math.max(1, Math.floor(height)),
        width: Math.max(1, Math.floor(width)),
      })
    })

    resizeObserver.observe(container)

    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const support = await getWebGPUSupport()

        if (cancelled) {
          return
        }

        if (!support.available) {
          setStatus({ type: 'unsupported', reason: support.reason })
          return
        }

        setStatus({ type: 'initializing' })
      } catch (error) {
        if (cancelled) {
          return
        }

        setStatus({
          type: 'error',
          reason:
            error instanceof Error
              ? error.message
              : 'The WebGPU renderer could not start.',
        })
      }
    }

    void init()

    return () => {
      cancelled = true
    }
  }, [])

  const shouldRenderCanvas =
    status.type === 'initializing' || status.type === 'ready'
  const handleCameraQuaternionChange = useCallback(() => {
    setCameraQuaternionRevision((revision) => revision + 1)
  }, [])

  const handleCameraSnapshotChange = useCallback(
    (snapshot: ViewportCameraSnapshot) => {
      setCameraSnapshot(snapshot)
    },
    [],
  )

  return (
    <div
      className={`webgpu-stage${renderMode === 'pathtracer' ? ' is-pathtracing' : ''}`}
      ref={containerRef}
    >
      {shouldRenderCanvas && (
        <Canvas
          aria-label="Manifest3D WebGPU viewport"
          camera={{
            far: defaultViewportCameraConfig.far,
            fov: defaultViewportCameraConfig.fov,
            near: defaultViewportCameraConfig.near,
            position: [...defaultViewportCameraConfig.position],
          }}
          className="webgpu-stage__canvas"
          dpr={rendererDpr}
          frameloop="demand"
          gl={webgpuRendererFactory}
          onCreated={() => setStatus({ type: 'ready' })}
          onPointerDown={(event) => {
            if (event.shiftKey && selectedTargetId) {
              onSelectionCleared()
            }
          }}
          onPointerMissed={onSelectionCleared}
          shadows
        >
          <WebGPUScene
            activeTransformTool={activeTransformTool}
            assets={assets}
            cameraQuaternionRef={cameraQuaternionRef}
            jointPreviewPosesByInstance={jointPreviewPosesByInstance}
            materialAnimationValuesByInstance={materialAnimationValuesByInstance}
            navigationBehavior={navigationBehavior}
            leftPanelOcclusionWidth={leftPanelOcclusionWidth}
            onCameraQuaternionChange={handleCameraQuaternionChange}
            onCameraSnapshotChange={handleCameraSnapshotChange}
            rightPanelOcclusionWidth={rightPanelOcclusionWidth}
            selectedTargetId={selectedTargetId}
            selectionRevision={selectionRevision}
            worldMode={worldMode}
            onAssetSelected={onAssetSelected}
            onSelectionCleared={onSelectionCleared}
            onTransformChanged={onTransformChanged}
            onTransformEnded={onTransformEnded}
            onTransformStarted={onTransformStarted}
          />
        </Canvas>
      )}
      {status.type === 'ready' && renderMode === 'pathtracer' && (
        <Suspense fallback={null}>
          <PathTracingCanvas
            assets={assets}
            cameraSnapshot={cameraSnapshot}
            jointPreviewPosesByInstance={jointPreviewPosesByInstance}
            leftPanelOcclusionWidth={leftPanelOcclusionWidth}
            materialAnimationValuesByInstance={materialAnimationValuesByInstance}
            rightPanelOcclusionWidth={rightPanelOcclusionWidth}
            worldMode={worldMode}
          />
        </Suspense>
      )}
      {status.type === 'ready' && (
        <ViewportGizmoOverlay
          cameraQuaternionRef={cameraQuaternionRef}
          cameraQuaternionRevision={cameraQuaternionRevision}
          isSidePanelCollapsed={isSidePanelCollapsed}
        />
      )}
      {status.type !== 'ready' && (
        <div className={`viewport-overlay viewport-overlay--${status.type}`}>
          {status.type === 'unsupported' || status.type === 'error' ? (
            <UnsupportedWebGPU reason={status.reason} />
          ) : (
            <div className="viewport-loader" role="status">
              <span aria-hidden="true" />
              <p>
                {status.type === 'checking'
                  ? 'Checking WebGPU availability'
                  : 'Initializing WebGPU scene'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

async function getWebGPUSupport() {
  if (!('gpu' in navigator) || !navigator.gpu) {
    return {
      available: false,
      reason: 'navigator.gpu is unavailable in this browser.',
    }
  }

  const adapter = await navigator.gpu.requestAdapter()

  if (!adapter) {
    return {
      available: false,
      reason: 'No compatible GPU adapter was returned by the browser.',
    }
  }

  return { available: true, reason: '' }
}
