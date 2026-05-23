import * as THREE from 'three'

export type PathTracingViewportRenderer = {
  getSize: (target: THREE.Vector2) => THREE.Vector2
  setScissorTest: (enabled: boolean) => void
  setViewport: (x: number, y: number, width: number, height: number) => void
}

export function resetRendererViewportToCanvasCssSize(
  renderer: PathTracingViewportRenderer,
) {
  const canvasSize = renderer.getSize(new THREE.Vector2())

  renderer.setScissorTest(false)
  renderer.setViewport(0, 0, canvasSize.x, canvasSize.y)

  return canvasSize
}
