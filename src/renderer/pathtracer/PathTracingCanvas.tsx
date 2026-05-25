import {
  type MutableRefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { TexturePass } from 'three/examples/jsm/postprocessing/TexturePass.js'
import { WebGLPathTracer } from 'three-gpu-pathtracer'
import type { JointPoseValues } from '../../engine/geometry/jointPoses'
import type { MaterialAnimationValues } from '../../engine/geometry/materialAnimations'
import type { SceneAssetInstance } from '../../engine/scene/sceneStore'
import { computeRendererDpr } from '../createRenderer'
import type { ViewportCameraSnapshot } from '../viewportCamera'
import type { ViewportWorldMode } from '../viewportWorld'
import {
  applyPathTracingCameraSnapshot,
  createDefaultPathTracingCameraSnapshot,
} from './pathTracingCamera'
import { pathTracingViewportConfig } from './pathTracingConfig'
import {
  createPathTracingAssetBloomPipeline,
  type PathTracingAssetBloomPipeline,
} from './pathTracingAssetBloomPipeline'
import {
  createPathTracingDenoisePipeline,
  shouldUsePathTracingDenoise,
  type PathTracingDenoisePipeline,
} from './pathTracingDenoisePipeline'
import {
  formatPathTracingSampleCounter,
  shouldScheduleNextPathTracingFrame,
  type PathTracingSampleCounterDenoiseStatus,
} from './pathTracingFrameScheduler'
import {
  createPathTracingEmissiveMeshSamplingController,
  type PathTracingEmissiveMeshSamplingController,
} from './pathTracingEmissiveMeshSampling'
import {
  getPathTracingMaxSampleOptions,
  readPathTracingMaxSamplePreference,
  writePathTracingMaxSamplePreference,
  type PathTracingMaxSampleCount,
} from './pathTracingSampleCountPreference'
import { rebuildPathTracingViewportScene } from './pathTracingScene'
import { resetRendererViewportToCanvasCssSize } from './pathTracingRendererViewport'

export type PathTracingCanvasProps = {
  assets: readonly SceneAssetInstance[]
  cameraSnapshot: ViewportCameraSnapshot | null
  denoiseEnabled: boolean
  jointPreviewPosesByInstance: Readonly<Record<string, JointPoseValues>>
  leftPanelOcclusionWidth: number
  materialAnimationValuesByInstance: Readonly<Record<string, MaterialAnimationValues>>
  rightPanelOcclusionWidth: number
  worldMode: ViewportWorldMode
}

type PathTracingRuntime = {
  assetBloomPipeline: PathTracingAssetBloomPipeline
  camera: THREE.PerspectiveCamera
  composer: EffectComposer
  denoisePipeline: PathTracingDenoisePipeline
  emissiveMeshSampler: PathTracingEmissiveMeshSamplingController
  pathTracer: WebGLPathTracer
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  texturePass: TexturePass
}

type ViewportSize = {
  height: number
  width: number
}


type SampleCounterHandle = {
  textContent: string | null
}

type PublishSampleCountOptions = {
  denoiseStatus?: PathTracingSampleCounterDenoiseStatus
  lastPublishedSampleCounterTextRef: MutableRefObject<string | null>
  maxSamples: number
  sampleCount: number
  sampleCounterRef: MutableRefObject<SampleCounterHandle | null>
}

type RequestFrameRef = MutableRefObject<(() => void) | null>

type PathTracingTexturePassResult = {
  denoiseStatus?: PathTracingSampleCounterDenoiseStatus
  texture: THREE.Texture
}

const fallbackCameraSnapshot = createDefaultPathTracingCameraSnapshot()

export function PathTracingCanvas({
  assets,
  cameraSnapshot,
  denoiseEnabled,
  jointPreviewPosesByInstance,
  leftPanelOcclusionWidth,
  materialAnimationValuesByInstance,
  rightPanelOcclusionWidth,
  worldMode,
}: PathTracingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sampleMenuRef = useRef<HTMLDetailsElement | null>(null)
  const sampleCounterRef = useRef<HTMLSpanElement | null>(null)
  const runtimeRef = useRef<PathTracingRuntime | null>(null)
  const sceneCleanupRef = useRef<(() => void) | null>(null)
  const needsSceneUploadRef = useRef(false)
  const lastPublishedSampleCounterTextRef = useRef<string | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const requestFrameRef = useRef<(() => void) | null>(null)
  const sampleOptions = useMemo(() => getPathTracingMaxSampleOptions(), [])
  const [selectedMaxSamples, setSelectedMaxSamples] =
    useState<PathTracingMaxSampleCount>(() =>
      readPathTracingMaxSamplePreference(),
    )
  const currentMaxSamplesRef = useRef<number>(selectedMaxSamples)
  const currentCameraSnapshotRef = useRef<ViewportCameraSnapshot>(
    cameraSnapshot ?? fallbackCameraSnapshot,
  )
  const currentLeftPanelOcclusionWidthRef = useRef(leftPanelOcclusionWidth)
  const currentRightPanelOcclusionWidthRef = useRef(rightPanelOcclusionWidth)
  const currentViewportSizeRef = useRef<ViewportSize>({
    height: 1,
    width: 1,
  })
  const currentDenoiseEnabledRef = useRef(denoiseEnabled)
  const [viewportSize, setViewportSize] = useState<ViewportSize>({
    height: 1,
    width: 1,
  })
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
    const canvas = canvasRef.current

    if (!canvas) {
      return undefined
    }

    const renderer = new THREE.WebGLRenderer({
      alpha: false,
      antialias: true,
      canvas,
      powerPreference: 'high-performance',
    })
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80)
    const scene = new THREE.Scene()
    const pathTracer = new WebGLPathTracer(renderer)
    const texturePass = new TexturePass()
    const outputPass = new OutputPass()
    const composer = new EffectComposer(renderer)
    const denoisePipeline = createPathTracingDenoisePipeline()
    const assetBloomPipeline = createPathTracingAssetBloomPipeline()
    const emissiveMeshSampler =
      createPathTracingEmissiveMeshSamplingController(pathTracer)

    renderer.autoClear = true
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = pathTracingViewportConfig.toneMappingExposure

    pathTracer.bounces = pathTracingViewportConfig.bounces
    pathTracer.filterGlossyFactor = pathTracingViewportConfig.filterGlossyFactor
    pathTracer.minSamples = pathTracingViewportConfig.minSamples
    pathTracer.renderDelay = pathTracingViewportConfig.renderDelayMs
    pathTracer.fadeDuration = 0
    pathTracer.dynamicLowRes = false
    pathTracer.lowResScale = 1
    pathTracer.renderScale = 1
    pathTracer.rasterizeScene = false
    pathTracer.renderToCanvas = false
    pathTracer.tiles.set(...pathTracingViewportConfig.tiles)
    pathTracer.textureSize.set(
      pathTracingViewportConfig.maxTextureSize,
      pathTracingViewportConfig.maxTextureSize,
    )

    composer.addPass(texturePass)
    composer.addPass(outputPass)

    runtimeRef.current = {
      assetBloomPipeline,
      camera,
      composer,
      denoisePipeline,
      emissiveMeshSampler,
      pathTracer,
      renderer,
      scene,
      texturePass,
    }
    needsSceneUploadRef.current = true
    requestPathTracingFrame(requestFrameRef)

    return () => {
      sceneCleanupRef.current?.()
      sceneCleanupRef.current = null
      runtimeRef.current = null
      emissiveMeshSampler.dispose()
      pathTracer.dispose()
      composer.dispose()
      denoisePipeline.dispose()
      assetBloomPipeline.dispose()
      texturePass.dispose()
      outputPass.dispose()
      renderer.dispose()
    }
  }, [])

  useEffect(() => {
    currentViewportSizeRef.current = viewportSize

    const runtime = runtimeRef.current

    if (!runtime) {
      return
    }

    syncPathTracingRendererSize(runtime, viewportSize, rendererDpr)
    resetPathTracingCameraAndSamples({
      lastPublishedSampleCounterTextRef,
      leftPanelOcclusionWidth: currentLeftPanelOcclusionWidthRef.current,
      maxSamples: currentMaxSamplesRef.current,
      rightPanelOcclusionWidth: currentRightPanelOcclusionWidthRef.current,
      runtime,
      sampleCounterRef,
      snapshot: currentCameraSnapshotRef.current,
      viewportSize,
    })
    requestPathTracingFrame(requestFrameRef)
  }, [rendererDpr, viewportSize])

  useEffect(() => {
    currentCameraSnapshotRef.current = cameraSnapshot ?? fallbackCameraSnapshot
    currentLeftPanelOcclusionWidthRef.current = leftPanelOcclusionWidth
    currentRightPanelOcclusionWidthRef.current = rightPanelOcclusionWidth

    const runtime = runtimeRef.current

    if (!runtime) {
      return
    }

    resetPathTracingCameraAndSamples({
      lastPublishedSampleCounterTextRef,
      leftPanelOcclusionWidth,
      maxSamples: currentMaxSamplesRef.current,
      rightPanelOcclusionWidth,
      runtime,
      sampleCounterRef,
      snapshot: currentCameraSnapshotRef.current,
      viewportSize: currentViewportSizeRef.current,
    })
    requestPathTracingFrame(requestFrameRef)
  }, [cameraSnapshot, leftPanelOcclusionWidth, rightPanelOcclusionWidth])

  useEffect(() => {
    const runtime = runtimeRef.current

    if (!runtime) {
      return undefined
    }

    sceneCleanupRef.current?.()
    sceneCleanupRef.current = rebuildPathTracingViewportScene({
      assets,
      jointPreviewPosesByInstance,
      materialAnimationValuesByInstance,
      scene: runtime.scene,
      worldMode,
    })
    needsSceneUploadRef.current = true
    publishPathTracingSampleCount({
      lastPublishedSampleCounterTextRef,
      maxSamples: currentMaxSamplesRef.current,
      sampleCount: 0,
      sampleCounterRef,
    })
    requestPathTracingFrame(requestFrameRef)

    return undefined
  }, [
    assets,
    jointPreviewPosesByInstance,
    materialAnimationValuesByInstance,
    worldMode,
  ])

  useEffect(() => {
    currentDenoiseEnabledRef.current = denoiseEnabled
    requestPathTracingFrame(requestFrameRef)
  }, [denoiseEnabled])

  useEffect(() => {
    currentMaxSamplesRef.current = selectedMaxSamples
    writePathTracingMaxSamplePreference(selectedMaxSamples)

    const runtime = runtimeRef.current

    publishPathTracingSampleCount({
      lastPublishedSampleCounterTextRef,
      maxSamples: selectedMaxSamples,
      sampleCount: runtime
        ? Math.min(selectedMaxSamples, Math.floor(runtime.pathTracer.samples))
        : 0,
      sampleCounterRef,
    })
    requestPathTracingFrame(requestFrameRef)
  }, [selectedMaxSamples])

  useEffect(() => {
    let isDisposed = false

    function requestFrame() {
      if (isDisposed || animationFrameRef.current !== null) {
        return
      }

      animationFrameRef.current = requestAnimationFrame(render)
    }

    function render() {
      animationFrameRef.current = null

      const runtime = runtimeRef.current

      if (!runtime || isDisposed) {
        return
      }

      if (needsSceneUploadRef.current) {
        applyCameraSnapshotToPathTracingCamera(
          runtime.camera,
          currentCameraSnapshotRef.current,
          currentViewportSizeRef.current,
          currentLeftPanelOcclusionWidthRef.current,
          currentRightPanelOcclusionWidthRef.current,
        )
        uploadSceneToPathTracer(runtime)
        needsSceneUploadRef.current = false
        publishPathTracingSampleCount({
          lastPublishedSampleCounterTextRef,
          maxSamples: currentMaxSamplesRef.current,
          sampleCount: 0,
          sampleCounterRef,
        })
      }

      const maxSamples = currentMaxSamplesRef.current

      if (runtime.pathTracer.samples < maxSamples) {
        runtime.pathTracer.renderSample()
      }

      const displayedSampleCount = Math.min(
        maxSamples,
        Math.floor(runtime.pathTracer.samples),
      )
      const finalSampleReached = runtime.pathTracer.samples >= maxSamples
      const willUseDenoise = shouldUsePathTracingDenoise({
        enabled:
          pathTracingViewportConfig.denoise.enabled &&
          currentDenoiseEnabledRef.current,
        maxSamples,
        sampleCount: runtime.pathTracer.samples,
      })

      if (willUseDenoise) {
        publishPathTracingSampleCount({
          denoiseStatus: 'denoising',
          lastPublishedSampleCounterTextRef,
          maxSamples,
          sampleCount: displayedSampleCount,
          sampleCounterRef,
        })
      }

      const texturePassResult = getPathTracingTexturePassMap(
        runtime,
        currentDenoiseEnabledRef.current,
        maxSamples,
      )

      resetRendererViewportToCanvasCssSize(runtime.renderer)
      runtime.texturePass.map = runtime.assetBloomPipeline.render({
        camera: runtime.camera,
        inputTexture: texturePassResult.texture,
        renderer: runtime.renderer,
        scene: runtime.scene,
      })
      runtime.composer.render()
      publishPathTracingSampleCount({
        denoiseStatus:
          texturePassResult.denoiseStatus ??
          (finalSampleReached ? 'not-denoised' : 'idle'),
        lastPublishedSampleCounterTextRef,
        maxSamples,
        sampleCount: displayedSampleCount,
        sampleCounterRef,
      })

      if (
        shouldScheduleNextPathTracingFrame({
          maxSamples,
          needsSceneUpload: needsSceneUploadRef.current,
          sampleCount: runtime.pathTracer.samples,
        })
      ) {
        requestFrame()
      }
    }

    requestFrameRef.current = requestFrame
    requestFrame()

    return () => {
      isDisposed = true
      requestFrameRef.current = null

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [])

  return (
    <div className="pathtracing-stage" ref={containerRef}>
      <canvas ref={canvasRef} />
      <details
        className="pathtracing-sample-counter"
        onBlur={(event) => {
          const nextTarget = event.relatedTarget

          if (
            !(nextTarget instanceof Node) ||
            !event.currentTarget.contains(nextTarget)
          ) {
            event.currentTarget.open = false
          }
        }}
        ref={sampleMenuRef}
      >
        <summary
          aria-haspopup="menu"
          className="pathtracing-sample-counter__button"
        >
          <span aria-live="polite" ref={sampleCounterRef} role="status">
            {formatPathTracingSampleCounter(0, selectedMaxSamples)}
          </span>
        </summary>
        <div className="pathtracing-sample-counter__menu" role="menu">
          {sampleOptions.map((option) => (
            <button
              aria-checked={option === selectedMaxSamples}
              className={
                option === selectedMaxSamples ? 'is-selected' : undefined
              }
              key={option}
              onClick={() => {
                setSelectedMaxSamples(option)

                if (sampleMenuRef.current) {
                  sampleMenuRef.current.open = false
                }
              }}
              role="menuitemradio"
              type="button"
            >
              {option} samples
            </button>
          ))}
        </div>
      </details>
    </div>
  )
}
function publishPathTracingSampleCount({
  denoiseStatus = 'idle',
  lastPublishedSampleCounterTextRef,
  maxSamples,
  sampleCount,
  sampleCounterRef,
}: PublishSampleCountOptions) {
  const textContent = formatPathTracingSampleCounter(
    sampleCount,
    maxSamples,
    denoiseStatus,
  )

  if (lastPublishedSampleCounterTextRef.current === textContent) {
    return
  }

  lastPublishedSampleCounterTextRef.current = textContent

  if (sampleCounterRef.current) {
    sampleCounterRef.current.textContent = textContent
  }
}

function requestPathTracingFrame(requestFrameRef: RequestFrameRef) {
  requestFrameRef.current?.()
}

function syncPathTracingRendererSize(
  runtime: PathTracingRuntime,
  viewportSize: ViewportSize,
  rendererDpr: number,
) {
  const width = viewportSize.width
  const height = viewportSize.height

  runtime.renderer.setPixelRatio(rendererDpr)
  runtime.renderer.setSize(width, height, false)
  runtime.composer.setPixelRatio(rendererDpr)
  runtime.composer.setSize(width, height)
  runtime.assetBloomPipeline.setSize(width, height, rendererDpr)
  runtime.denoisePipeline.setSize(width, height, rendererDpr)
}


function resetPathTracingCameraAndSamples({
  lastPublishedSampleCounterTextRef,
  leftPanelOcclusionWidth,
  maxSamples,
  rightPanelOcclusionWidth,
  runtime,
  sampleCounterRef,
  snapshot,
  viewportSize,
}: {
  lastPublishedSampleCounterTextRef: MutableRefObject<string | null>
  leftPanelOcclusionWidth: number
  maxSamples: number
  rightPanelOcclusionWidth: number
  runtime: PathTracingRuntime
  sampleCounterRef: MutableRefObject<SampleCounterHandle | null>
  snapshot: ViewportCameraSnapshot
  viewportSize: ViewportSize
}) {
  applyCameraSnapshotToPathTracingCamera(
    runtime.camera,
    snapshot,
    viewportSize,
    leftPanelOcclusionWidth,
    rightPanelOcclusionWidth,
  )
  runtime.pathTracer.updateCamera()
  runtime.pathTracer.reset()
  runtime.denoisePipeline.reset()
  publishPathTracingSampleCount({
    lastPublishedSampleCounterTextRef,
    maxSamples,
    sampleCount: 0,
    sampleCounterRef,
  })
}

function applyCameraSnapshotToPathTracingCamera(
  camera: THREE.PerspectiveCamera,
  snapshot: ViewportCameraSnapshot,
  viewportSize: ViewportSize,
  leftPanelOcclusionWidth: number,
  rightPanelOcclusionWidth: number,
) {
  applyPathTracingCameraSnapshot({
    camera,
    leftPanelOcclusionWidth,
    rightPanelOcclusionWidth,
    snapshot,
    viewportSize,
  })
}

function uploadSceneToPathTracer(runtime: PathTracingRuntime) {
  runtime.scene.updateMatrixWorld(true)
  runtime.pathTracer.setScene(runtime.scene, runtime.camera)
  runtime.emissiveMeshSampler.update(runtime.scene)
  runtime.pathTracer.reset()
  runtime.denoisePipeline.reset()
}

function getPathTracingTexturePassMap(
  runtime: PathTracingRuntime,
  denoiseEnabled: boolean,
  maxSamples: number,
): PathTracingTexturePassResult {
  if (
    !shouldUsePathTracingDenoise({
      enabled: pathTracingViewportConfig.denoise.enabled && denoiseEnabled,
      maxSamples,
      sampleCount: runtime.pathTracer.samples,
    })
  ) {
    return {
      texture: runtime.pathTracer.target.texture,
    }
  }

  const result = runtime.denoisePipeline.render({
    camera: runtime.camera,
    inputTexture: runtime.pathTracer.target.texture,
    renderer: runtime.renderer,
    scene: runtime.scene,
  })

  return {
    denoiseStatus:
      result.status === 'denoised' ? 'denoised' : 'not-denoised-error',
    texture: result.texture,
  }
}


export default PathTracingCanvas
