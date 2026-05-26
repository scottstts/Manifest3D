import * as THREE from 'three/webgpu'
import {
  getViewportWorldEnvironment,
  type ViewportWorldMode,
} from './viewportWorld'
import { defaultViewportShadowConfig } from './viewportShadows'

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
  key.shadow.mapSize.set(
    defaultViewportShadowConfig.mapSize,
    defaultViewportShadowConfig.mapSize,
  )
  key.shadow.camera.near = defaultViewportShadowConfig.camera.near
  key.shadow.camera.far = defaultViewportShadowConfig.camera.far
  key.shadow.camera.left = defaultViewportShadowConfig.camera.left
  key.shadow.camera.right = defaultViewportShadowConfig.camera.right
  key.shadow.camera.top = defaultViewportShadowConfig.camera.top
  key.shadow.camera.bottom = defaultViewportShadowConfig.camera.bottom
  scene.add(key)

  const fill = new THREE.DirectionalLight(
    environment.lights.fill.color,
    environment.lights.fill.intensity,
  )
  fill.position.set(...environment.lights.fill.position)
  scene.add(fill)
}
