import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { TexturePass } from 'three/examples/jsm/postprocessing/TexturePass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
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
import { rebuildPathTracingViewportScene } from './pathTracingScene'
import { resetRendererViewportToCanvasCssSize } from './pathTracingRendererViewport'

export type PathTracingCanvasProps = {
  assets: readonly SceneAssetInstance[]
  cameraSnapshot: ViewportCameraSnapshot | null
  jointPreviewPosesByInstance: Readonly<Record<string, JointPoseValues>>
  leftPanelOcclusionWidth: number
  materialAnimationValuesByInstance: Readonly<Record<string, MaterialAnimationValues>>
  rightPanelOcclusionWidth: number
  worldMode: ViewportWorldMode
}

type PathTracingRuntime = {
  bloomPass: UnrealBloomPass
  camera: THREE.PerspectiveCamera
  composer: EffectComposer
  pathTracer: WebGLPathTracer
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  texturePass: TexturePass
}

type ViewportSize = {
  height: number
  width: number
}

const fallbackCameraSnapshot = createDefaultPathTracingCameraSnapshot()

export function PathTracingCanvas({
  assets,
  cameraSnapshot,
  jointPreviewPosesByInstance,
  leftPanelOcclusionWidth,
  materialAnimationValuesByInstance,
  rightPanelOcclusionWidth,
  worldMode,
}: PathTracingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const runtimeRef = useRef<PathTracingRuntime | null>(null)
  const sceneCleanupRef = useRef<(() => void) | null>(null)
  const needsSceneUploadRef = useRef(false)
  const lastPublishedSampleCountRef = useRef(0)
  const [renderedSamples, setRenderedSamples] = useState(0)
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
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      pathTracingViewportConfig.bloom.strength,
      pathTracingViewportConfig.bloom.radius,
      pathTracingViewportConfig.bloom.threshold,
    )
    const outputPass = new OutputPass()
    const composer = new EffectComposer(renderer)

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
    composer.addPass(bloomPass)
    composer.addPass(outputPass)

    runtimeRef.current = {
      bloomPass,
      camera,
      composer,
      pathTracer,
      renderer,
      scene,
      texturePass,
    }
    needsSceneUploadRef.current = true

    return () => {
      sceneCleanupRef.current?.()
      sceneCleanupRef.current = null
      runtimeRef.current = null
      pathTracer.dispose()
      composer.dispose()
      texturePass.dispose()
      bloomPass.dispose()
      outputPass.dispose()
      renderer.dispose()
    }
  }, [])

  useEffect(() => {
    const runtime = runtimeRef.current

    if (!runtime) {
      return
    }

    const width = viewportSize.width
    const height = viewportSize.height

    runtime.renderer.setPixelRatio(rendererDpr)
    runtime.renderer.setSize(width, height, false)
    runtime.composer.setPixelRatio(rendererDpr)
    runtime.composer.setSize(width, height)
    runtime.bloomPass.setSize(width * rendererDpr, height * rendererDpr)
    applyCameraSnapshotToPathTracingCamera(
      runtime.camera,
      cameraSnapshot ?? fallbackCameraSnapshot,
      viewportSize,
      leftPanelOcclusionWidth,
      rightPanelOcclusionWidth,
    )
    runtime.pathTracer.updateCamera()
    runtime.pathTracer.reset()
    publishPathTracingSampleCount({
      lastPublishedSampleCountRef,
      sampleCount: 0,
      setRenderedSamples,
    })
  }, [
    cameraSnapshot,
    leftPanelOcclusionWidth,
    rendererDpr,
    rightPanelOcclusionWidth,
    viewportSize,
  ])

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
      lastPublishedSampleCountRef,
      sampleCount: 0,
      setRenderedSamples,
    })

    return undefined
  }, [
    assets,
    jointPreviewPosesByInstance,
    materialAnimationValuesByInstance,
    worldMode,
  ])

  useEffect(() => {
    let animationFrame = 0
    let isDisposed = false

    function render() {
      const runtime = runtimeRef.current

      if (!runtime || isDisposed) {
        return
      }

      if (needsSceneUploadRef.current) {
        applyCameraSnapshotToPathTracingCamera(
          runtime.camera,
          cameraSnapshot ?? fallbackCameraSnapshot,
          viewportSize,
          leftPanelOcclusionWidth,
          rightPanelOcclusionWidth,
        )
        uploadSceneToPathTracer(runtime)
        needsSceneUploadRef.current = false
      }

      if (runtime.pathTracer.samples < pathTracingViewportConfig.maxSamples) {
        runtime.pathTracer.renderSample()
      }

      resetRendererViewportToCanvasCssSize(runtime.renderer)
      runtime.texturePass.map = runtime.pathTracer.target.texture
      runtime.composer.render()
      publishPathTracingSampleCount({
        lastPublishedSampleCountRef,
        sampleCount: Math.min(
          pathTracingViewportConfig.maxSamples,
          Math.floor(runtime.pathTracer.samples),
        ),
        setRenderedSamples,
      })
      animationFrame = requestAnimationFrame(render)
    }

    animationFrame = requestAnimationFrame(render)

    return () => {
      isDisposed = true
      cancelAnimationFrame(animationFrame)
    }
  }, [
    cameraSnapshot,
    leftPanelOcclusionWidth,
    rightPanelOcclusionWidth,
    viewportSize,
  ])

  return (
    <div className="pathtracing-stage" ref={containerRef}>
      <canvas ref={canvasRef} />
      <div
        aria-live="polite"
        className="pathtracing-sample-counter"
        role="status"
      >
        {renderedSamples} / {pathTracingViewportConfig.maxSamples} samples
      </div>
    </div>
  )
}


type PublishSampleCountOptions = {
  lastPublishedSampleCountRef: MutableRefObject<number>
  sampleCount: number
  setRenderedSamples: Dispatch<SetStateAction<number>>
}

function publishPathTracingSampleCount({
  lastPublishedSampleCountRef,
  sampleCount,
  setRenderedSamples,
}: PublishSampleCountOptions) {
  if (lastPublishedSampleCountRef.current === sampleCount) {
    return
  }

  lastPublishedSampleCountRef.current = sampleCount
  setRenderedSamples(sampleCount)
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
  runtime.pathTracer.reset()
}


export default PathTracingCanvas
