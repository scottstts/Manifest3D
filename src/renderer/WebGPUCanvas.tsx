import { Canvas } from '@react-three/fiber'
import type { ComponentProps } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Quaternion } from 'three'
import { UnsupportedWebGPU } from '../ui/UnsupportedWebGPU'
import { computeRendererDpr, createFiberWebGPURenderer } from './createRenderer'
import { ViewportGizmoOverlay } from './ViewportGizmo'
import { WebGPUScene } from './WebGPUScene'

type CanvasStatus =
  | { type: 'checking' }
  | { type: 'initializing' }
  | { type: 'ready' }
  | { type: 'unsupported'; reason: string }
  | { type: 'error'; reason: string }

type WebGPUCanvasProps = {
  isSidePanelCollapsed: boolean
}

const webgpuRendererFactory =
  createFiberWebGPURenderer as unknown as NonNullable<
    ComponentProps<typeof Canvas>['gl']
  >

export function WebGPUCanvas({ isSidePanelCollapsed }: WebGPUCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cameraQuaternionRef = useRef(new Quaternion())
  const [status, setStatus] = useState<CanvasStatus>({ type: 'checking' })
  const [viewportSize, setViewportSize] = useState({ height: 1, width: 1 })

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

  return (
    <div className="webgpu-stage" ref={containerRef}>
      {shouldRenderCanvas && (
        <Canvas
          aria-label="Manifest3D WebGPU viewport"
          camera={{
            far: 80,
            fov: 38,
            near: 0.1,
            position: [3.65, 2.5, 4.45],
          }}
          className="webgpu-stage__canvas"
          dpr={rendererDpr}
          gl={webgpuRendererFactory}
          onCreated={() => setStatus({ type: 'ready' })}
          shadows
        >
          <WebGPUScene cameraQuaternionRef={cameraQuaternionRef} />
        </Canvas>
      )}
      {status.type === 'ready' && (
        <ViewportGizmoOverlay
          cameraQuaternionRef={cameraQuaternionRef}
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
