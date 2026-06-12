import {
  type MutableRefObject,
  useCallback,
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
import {
  defaultViewportCameraConfig,
  type ViewportCameraSnapshot,
} from '../viewportCamera'
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
  shouldDeferPathTracingWork,
  shouldCompletePathTracingDefaultPreviewHandoff,
  shouldPausePathTracingForDefaultPreview,
  shouldRunPathTracingFinalPost,
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
import {
  createPathTracingBvhWorker,
} from './pathTracingBvhWorker'
import { rebuildPathTracingViewportScene } from './pathTracingScene'
import { resetRendererViewportToCanvasCssSize } from './pathTracingRendererViewport'

export type PathTracingCanvasProps = {
  assets: readonly SceneAssetInstance[]
  cameraSnapshot: ViewportCameraSnapshot | null
  denoiseEnabled: boolean
  inputPrioritySignalRef: MutableRefObject<number>
  isCameraInteractionActive: boolean
  isDefaultPreviewActive: boolean
  jointPreviewPosesByInstance: Readonly<Record<string, JointPoseValues>>
  leftPanelOcclusionWidth: number
  materialAnimationValuesByInstance: Readonly<Record<string, MaterialAnimationValues>>
  onDefaultPreviewFrameReady: () => void
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
  inputPrioritySignalRef,
  isCameraInteractionActive,
  isDefaultPreviewActive,
  jointPreviewPosesByInstance,
  leftPanelOcclusionWidth,
  materialAnimationValuesByInstance,
  onDefaultPreviewFrameReady,
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
  const deferredFrameTimeoutRef = useRef<number | null>(null)
  const finalPostDirtyRef = useRef(true)
  const requestFrameRef = useRef<(() => void) | null>(null)
  const sceneUploadPromiseRef = useRef<Promise<void> | null>(null)
  const needsFreshDefaultPreviewHandoffFrameRef = useRef(false)
  const currentDefaultPreviewActiveRef = useRef(isDefaultPreviewActive)
  const onDefaultPreviewFrameReadyRef = useRef(onDefaultPreviewFrameReady)
  const lastHandledInputPrioritySignalRef = useRef(0)
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
  const currentCameraInteractionActiveRef = useRef(isCameraInteractionActive)
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

  const completeDefaultPreviewHandoffIfReady = useCallback((
    didPresentPathTracingFrame: boolean,
  ) => {
    if (
      !shouldCompletePathTracingDefaultPreviewHandoff({
        didPresentPathTracingFrame,
        isCameraInteractionActive: currentCameraInteractionActiveRef.current,
        isDefaultPreviewActive: currentDefaultPreviewActiveRef.current,
        needsFreshFrameBeforeReveal:
          needsFreshDefaultPreviewHandoffFrameRef.current,
      })
    ) {
      return
    }

    needsFreshDefaultPreviewHandoffFrameRef.current = false
    onDefaultPreviewFrameReadyRef.current()
  }, [])

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
    const camera = new THREE.PerspectiveCamera(
      defaultViewportCameraConfig.fov,
      1,
      defaultViewportCameraConfig.near,
      defaultViewportCameraConfig.far,
    )
    const scene = new THREE.Scene()
    const pathTracer = new WebGLPathTracer(renderer)
    const bvhWorker = createPathTracingBvhWorker()
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
    pathTracer.renderToCanvas = true
    pathTracer.renderToCanvasCallback = (_target, rawRenderer, quad) => {
      const currentAutoClear = rawRenderer.autoClear

      resetRendererViewportToCanvasCssSize(rawRenderer)
      rawRenderer.autoClear = false
      quad.render(rawRenderer)
      rawRenderer.autoClear = currentAutoClear
    }
    pathTracer.setBVHWorker(bvhWorker)
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
      bvhWorker.dispose()
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
    finalPostDirtyRef.current = true
    if (currentDefaultPreviewActiveRef.current) {
      needsFreshDefaultPreviewHandoffFrameRef.current = true
    }
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

    finalPostDirtyRef.current = true
    if (currentDefaultPreviewActiveRef.current) {
      needsFreshDefaultPreviewHandoffFrameRef.current = true
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
    finalPostDirtyRef.current = true
    if (currentDefaultPreviewActiveRef.current) {
      needsFreshDefaultPreviewHandoffFrameRef.current = true
    }
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
    finalPostDirtyRef.current = true
    requestPathTracingFrame(requestFrameRef)
  }, [denoiseEnabled])

  useEffect(() => {
    currentCameraInteractionActiveRef.current = isCameraInteractionActive

    if (isCameraInteractionActive) {
      const runtime = runtimeRef.current

      needsFreshDefaultPreviewHandoffFrameRef.current = true

      if (runtime) {
        finalPostDirtyRef.current = true
        resetPathTracingCameraAndSamples({
          lastPublishedSampleCounterTextRef,
          leftPanelOcclusionWidth: currentLeftPanelOcclusionWidthRef.current,
          maxSamples: currentMaxSamplesRef.current,
          rightPanelOcclusionWidth: currentRightPanelOcclusionWidthRef.current,
          runtime,
          sampleCounterRef,
          snapshot: currentCameraSnapshotRef.current,
          viewportSize: currentViewportSizeRef.current,
        })
      }
    }

    completeDefaultPreviewHandoffIfReady(false)
    requestPathTracingFrame(requestFrameRef)
  }, [completeDefaultPreviewHandoffIfReady, isCameraInteractionActive])

  useEffect(() => {
    currentDefaultPreviewActiveRef.current = isDefaultPreviewActive

    if (!isDefaultPreviewActive) {
      needsFreshDefaultPreviewHandoffFrameRef.current = false
      return
    }

    completeDefaultPreviewHandoffIfReady(false)
    requestPathTracingFrame(requestFrameRef)
  }, [completeDefaultPreviewHandoffIfReady, isDefaultPreviewActive])

  useEffect(() => {
    onDefaultPreviewFrameReadyRef.current = onDefaultPreviewFrameReady
  }, [onDefaultPreviewFrameReady])

  useEffect(() => {
    currentMaxSamplesRef.current = selectedMaxSamples
    writePathTracingMaxSamplePreference(selectedMaxSamples)
    finalPostDirtyRef.current = true

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
      if (
        isDisposed ||
        animationFrameRef.current !== null ||
        deferredFrameTimeoutRef.current !== null
      ) {
        return
      }

      animationFrameRef.current = requestAnimationFrame(render)
    }

    function requestDeferredFrame() {
      if (
        isDisposed ||
        animationFrameRef.current !== null ||
        deferredFrameTimeoutRef.current !== null
      ) {
        return
      }

      deferredFrameTimeoutRef.current = window.setTimeout(() => {
        deferredFrameTimeoutRef.current = null
        requestFrame()
      }, pathTracingViewportConfig.scheduler.inputPendingDelayMs)
    }

    function startSceneUpload(runtime: PathTracingRuntime) {
      if (sceneUploadPromiseRef.current) {
        return
      }

      applyCameraSnapshotToPathTracingCamera(
        runtime.camera,
        currentCameraSnapshotRef.current,
        currentViewportSizeRef.current,
        currentLeftPanelOcclusionWidthRef.current,
        currentRightPanelOcclusionWidthRef.current,
      )
      needsSceneUploadRef.current = false
      finalPostDirtyRef.current = true
      publishPathTracingSampleCount({
        lastPublishedSampleCounterTextRef,
        maxSamples: currentMaxSamplesRef.current,
        sampleCount: 0,
        sampleCounterRef,
      })

      const uploadPromise = uploadSceneToPathTracer(runtime)

      sceneUploadPromiseRef.current = uploadPromise

      void uploadPromise
        .catch((error: unknown) => {
          if (!isDisposed) {
            console.error('Path tracing scene upload failed.', error)
          }
        })
        .finally(() => {
          if (sceneUploadPromiseRef.current === uploadPromise) {
            sceneUploadPromiseRef.current = null
          }

          if (!isDisposed) {
            requestFrame()
          }
        })
    }

    function render() {
      animationFrameRef.current = null

      const runtime = runtimeRef.current

      if (!runtime || isDisposed) {
        return
      }

      if (sceneUploadPromiseRef.current) {
        return
      }

      const maxSamples = currentMaxSamplesRef.current
      const hasPriorityInputSignal =
        inputPrioritySignalRef.current !==
        lastHandledInputPrioritySignalRef.current

      if (hasPriorityInputSignal) {
        lastHandledInputPrioritySignalRef.current =
          inputPrioritySignalRef.current
        needsFreshDefaultPreviewHandoffFrameRef.current = true
      }

      if (
        shouldPausePathTracingForDefaultPreview({
          hasPriorityInputSignal,
          isCameraInteractionActive: currentCameraInteractionActiveRef.current,
        })
      ) {
        publishPathTracingSampleCount({
          lastPublishedSampleCounterTextRef,
          maxSamples,
          sampleCount: Math.min(
            maxSamples,
            Math.floor(runtime.pathTracer.samples),
          ),
          sampleCounterRef,
        })
        return
      }

      if (
        shouldDeferPathTracingWork({
          hasPendingInput: hasPendingPathTracingInput(),
        })
      ) {
        requestDeferredFrame()
        return
      }

      if (needsSceneUploadRef.current) {
        startSceneUpload(runtime)
        return
      }

      let didRenderSample = false

      if (runtime.pathTracer.samples < maxSamples) {
        runtime.pathTracer.renderSample()
        finalPostDirtyRef.current = true
        didRenderSample = true
        completeDefaultPreviewHandoffIfReady(true)
      }

      const displayedSampleCount = Math.min(
        maxSamples,
        Math.floor(runtime.pathTracer.samples),
      )
      const shouldRunFinalPost = shouldRunPathTracingFinalPost({
        isCameraInteractionActive: currentCameraInteractionActiveRef.current,
        maxSamples,
        needsFinalPost: finalPostDirtyRef.current,
        sampleCount: runtime.pathTracer.samples,
      })

      publishPathTracingSampleCount({
        lastPublishedSampleCounterTextRef,
        maxSamples,
        sampleCount: displayedSampleCount,
        sampleCounterRef,
      })

      if (shouldRunFinalPost) {
        if (didRenderSample) {
          requestFrame()
          return
        }

        const finalPostWillUseDenoise = shouldUsePathTracingDenoise({
          enabled:
            pathTracingViewportConfig.denoise.enabled &&
            currentDenoiseEnabledRef.current,
          maxSamples,
          sampleCount: runtime.pathTracer.samples,
        })

        if (finalPostWillUseDenoise) {
          publishPathTracingSampleCount({
            denoiseStatus: 'denoising',
            lastPublishedSampleCounterTextRef,
            maxSamples,
            sampleCount: displayedSampleCount,
            sampleCounterRef,
          })
        }

        const denoiseStatus = renderFinalPathTracingPost(
          runtime,
          currentDenoiseEnabledRef.current,
          maxSamples,
        )

        finalPostDirtyRef.current = false
        completeDefaultPreviewHandoffIfReady(true)
        publishPathTracingSampleCount({
          denoiseStatus,
          lastPublishedSampleCounterTextRef,
          maxSamples,
          sampleCount: displayedSampleCount,
          sampleCounterRef,
        })
        return
      }

      if (
        shouldScheduleNextPathTracingFrame({
          maxSamples,
          needsFinalPost: shouldRunFinalPost,
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
      sceneUploadPromiseRef.current = null

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }

      if (deferredFrameTimeoutRef.current !== null) {
        window.clearTimeout(deferredFrameTimeoutRef.current)
        deferredFrameTimeoutRef.current = null
      }
    }
  }, [completeDefaultPreviewHandoffIfReady, inputPrioritySignalRef])

  return (
    <div className="pathtracing-stage" ref={containerRef}>
      <canvas
        ref={canvasRef}
        style={{ visibility: isDefaultPreviewActive ? 'hidden' : 'visible' }}
      />
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

async function uploadSceneToPathTracer(runtime: PathTracingRuntime) {
  runtime.scene.updateMatrixWorld(true)
  await runtime.pathTracer.setSceneAsync(runtime.scene, runtime.camera)
  runtime.emissiveMeshSampler.update(runtime.scene)
  runtime.pathTracer.reset()
  runtime.denoisePipeline.reset()
}

function renderFinalPathTracingPost(
  runtime: PathTracingRuntime,
  denoiseEnabled: boolean,
  maxSamples: number,
): PathTracingSampleCounterDenoiseStatus {
  const texturePassResult = getPathTracingTexturePassMap(
    runtime,
    denoiseEnabled,
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

  return texturePassResult.denoiseStatus ?? 'not-denoised'
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

type NavigatorWithScheduling = Navigator & {
  scheduling?: {
    isInputPending?: (options?: { includeContinuous?: boolean }) => boolean
  }
}

function hasPendingPathTracingInput() {
  if (typeof navigator === 'undefined') {
    return false
  }

  const scheduling = (navigator as NavigatorWithScheduling).scheduling
  const isInputPending = scheduling?.isInputPending

  return isInputPending
    ? isInputPending.call(scheduling, { includeContinuous: true })
    : false
}

export default PathTracingCanvas
