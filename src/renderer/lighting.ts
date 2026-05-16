import * as THREE from 'three/webgpu'

export function addLighting(scene: THREE.Scene) {
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xd9dbee, 1.35)
  scene.add(hemisphere)

  const key = new THREE.DirectionalLight(0xffffff, 1.9)
  key.position.set(-4.4, 6.5, 3.6)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.near = 0.5
  key.shadow.camera.far = 18
  key.shadow.camera.left = -6
  key.shadow.camera.right = 6
  key.shadow.camera.top = 6
  key.shadow.camera.bottom = -6
  scene.add(key)

  const fill = new THREE.DirectionalLight(0xcbd5ff, 0.62)
  fill.position.set(4.2, 3.2, -4.5)
  scene.add(fill)
}
