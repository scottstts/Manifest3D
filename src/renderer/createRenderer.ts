import type { Renderer as FiberRenderer } from '@react-three/fiber'
import { WebGPURenderer } from 'three/webgpu'

const maxPixels = 4_000_000
const defaultCanvasWidth = 300
const defaultCanvasHeight = 150

type RendererViewportSize = {
  height: number
  width: number
}

export function computeRendererDpr(
  viewportWidth: number,
  viewportHeight: number,
  devicePixelRatio: number,
) {
  if (viewportWidth <= 0 || viewportHeight <= 0 || devicePixelRatio <= 0) {
    return 1
  }

  const dpr = Math.min(
    devicePixelRatio,
    1.75,
    Math.sqrt(maxPixels / (viewportWidth * viewportHeight)),
  )

  return Math.max(1, dpr)
}

export function resolveInitialCanvasViewportSize(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): RendererViewportSize {
  const canvasElementSize = readElementViewportSize(canvas)

  if (canvasElementSize) {
    return canvasElementSize
  }

  const parentElement = getParentElement(canvas)
  const parentElementSize = readElementViewportSize(parentElement)

  if (parentElementSize) {
    return parentElementSize
  }

  const windowSize = readWindowViewportSize()

  if (windowSize) {
    return windowSize
  }

  const canvasBufferSize = readCanvasBufferSize(canvas)

  if (canvasBufferSize) {
    return canvasBufferSize
  }

  return { height: 1, width: 1 }
}

export async function createRenderer(
  canvas: HTMLCanvasElement,
  viewportWidth: number,
  viewportHeight: number,
) {
  const renderer = new WebGPURenderer({
    canvas,
    alpha: true,
    antialias: true,
  })

  renderer.setPixelRatio(
    computeRendererDpr(viewportWidth, viewportHeight, window.devicePixelRatio),
  )
  renderer.setSize(viewportWidth, viewportHeight, false)
  renderer.setClearColor(0x000000, 0)
  renderer.autoClear = false
  await renderer.init()

  return renderer
}

export async function createFiberWebGPURenderer({
  alpha,
  antialias,
  canvas,
  powerPreference,
}: WebGPURendererFactoryProps): Promise<FiberRenderer> {
  const webgpuPowerPreference =
    powerPreference === 'default' ? undefined : powerPreference
  const renderer = new WebGPURenderer({
    alpha,
    antialias,
    canvas,
    powerPreference: webgpuPowerPreference,
  })

  const initialSize = resolveInitialCanvasViewportSize(canvas)

  renderer.setPixelRatio(
    computeRendererDpr(
      initialSize.width,
      initialSize.height,
      readDevicePixelRatio(),
    ),
  )
  renderer.setSize(initialSize.width, initialSize.height, false)
  renderer.setClearColor(0x000000, 0)
  renderer.autoClear = true
  ensureDreiCompatibility(renderer)
  await renderer.init()

  return renderer
}

type WebGPURendererFactoryProps = {
  alpha?: boolean
  antialias?: boolean
  canvas: HTMLCanvasElement | OffscreenCanvas
  powerPreference?: WebGLPowerPreference
}

function readDevicePixelRatio() {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio
}

function readWindowViewportSize() {
  if (typeof window === 'undefined') {
    return null
  }

  return createViewportSize(window.innerWidth, window.innerHeight)
}

function readElementViewportSize(
  element: HTMLCanvasElement | OffscreenCanvas | Element | null | undefined,
) {
  if (!element || !('getBoundingClientRect' in element)) {
    return null
  }

  const clientSize = createViewportSize(
    'clientWidth' in element ? element.clientWidth : 0,
    'clientHeight' in element ? element.clientHeight : 0,
  )

  if (clientSize) {
    return clientSize
  }

  const bounds = element.getBoundingClientRect()

  return createViewportSize(bounds.width, bounds.height)
}

function getParentElement(canvas: HTMLCanvasElement | OffscreenCanvas) {
  return 'parentElement' in canvas ? canvas.parentElement : null
}

function readCanvasBufferSize(canvas: HTMLCanvasElement | OffscreenCanvas) {
  const size = createViewportSize(canvas.width, canvas.height)

  if (!size) {
    return null
  }

  if (
    'getBoundingClientRect' in canvas &&
    canvas.width === defaultCanvasWidth &&
    canvas.height === defaultCanvasHeight
  ) {
    return null
  }

  return size
}

function createViewportSize(width: number, height: number) {
  const resolvedWidth = toPositiveInteger(width)
  const resolvedHeight = toPositiveInteger(height)

  if (!resolvedWidth || !resolvedHeight) {
    return null
  }

  return { height: resolvedHeight, width: resolvedWidth }
}

function toPositiveInteger(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }

  return Math.max(1, Math.floor(value))
}

function ensureDreiCompatibility(renderer: WebGPURenderer) {
  const compatibleRenderer = renderer as WebGPURenderer & {
    capabilities?: {
      getMaxAnisotropy?: () => number
    }
  }
  const capabilities = compatibleRenderer.capabilities ?? {}

  compatibleRenderer.capabilities = {
    ...capabilities,
    getMaxAnisotropy: capabilities.getMaxAnisotropy ?? (() => 1),
  }
}
