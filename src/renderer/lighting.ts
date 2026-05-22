import * as THREE from 'three/webgpu'
import {
  getViewportWorldEnvironment,
  type ViewportWorldMode,
} from './viewportWorld'

export function addLighting(
  scene: THREE.Scene,
  mode: ViewportWorldMode = 'light',
) {
  const environment = getViewportWorldEnvironment(mode)
  const hemisphere = new THREE.HemisphereLight(
    environment.lights.hemisphere.skyColor,
    environment.lights.hemisphere.groundColor,
    environment.lights.hemisphere.intensity,
  )
  scene.add(hemisphere)

  const key = new THREE.DirectionalLight(
    environment.lights.key.color,
    environment.lights.key.intensity,
  )
  key.position.set(...environment.lights.key.position)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.near = 0.5
  key.shadow.camera.far = 18
  key.shadow.camera.left = -6
  key.shadow.camera.right = 6
  key.shadow.camera.top = 6
  key.shadow.camera.bottom = -6
  scene.add(key)

  const fill = new THREE.DirectionalLight(
    environment.lights.fill.color,
    environment.lights.fill.intensity,
  )
  fill.position.set(...environment.lights.fill.position)
  scene.add(fill)
}
