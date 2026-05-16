import type { Renderer as FiberRenderer } from '@react-three/fiber'
import { WebGPURenderer } from 'three/webgpu'

const maxPixels = 1_650_000

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
    1.5,
    Math.sqrt(maxPixels / (viewportWidth * viewportHeight)),
  )

  return Math.max(1, dpr)
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
