import * as THREE from 'three'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { pathTracingViewportConfig } from './pathTracingConfig'
import { isPathTracingAssetBloomObject } from './pathTracingScene'

export type PathTracingAssetBloomPipeline = {
  dispose: () => void
  render: (options: PathTracingAssetBloomRenderOptions) => THREE.Texture
  setSize: (width: number, height: number, pixelRatio: number) => void
}

export type PathTracingAssetBloomRenderOptions = {
  camera: THREE.PerspectiveCamera
  inputTexture: THREE.Texture
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
}

type MeshLike = THREE.Object3D & {
  isMesh: true
  visible: boolean
}

type VisibilitySnapshot = {
  object: THREE.Object3D
  visible: boolean
}

const fullScreenVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const assetColorMaskFragmentShader = /* glsl */ `
  uniform sampler2D tInput;
  uniform sampler2D tMask;
  varying vec2 vUv;

  void main() {
    vec3 color = texture2D(tInput, vUv).rgb;
    float mask = step(0.5, texture2D(tMask, vUv).r);

    gl_FragColor = vec4(color * mask, 1.0);
  }
`

const combineBloomFragmentShader = /* glsl */ `
  uniform sampler2D tBase;
  uniform sampler2D tBloom;
  varying vec2 vUv;

  void main() {
    vec3 baseColor = texture2D(tBase, vUv).rgb;
    vec3 bloomColor = texture2D(tBloom, vUv).rgb;

    gl_FragColor = vec4(baseColor + bloomColor, 1.0);
  }
`

export function createPathTracingAssetBloomPipeline(): PathTracingAssetBloomPipeline {
  const quadScene = new THREE.Scene()
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
  const maskMaterial = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    side: THREE.DoubleSide,
  })
  const assetColorMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fragmentShader: assetColorMaskFragmentShader,
    name: 'Manifest3D path tracing asset bloom color mask material',
    uniforms: {
      tInput: { value: null as THREE.Texture | null },
      tMask: { value: null as THREE.Texture | null },
    },
    vertexShader: fullScreenVertexShader,
  })
  const combineMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fragmentShader: combineBloomFragmentShader,
    name: 'Manifest3D path tracing asset bloom composite material',
    uniforms: {
      tBase: { value: null as THREE.Texture | null },
      tBloom: { value: null as THREE.Texture | null },
    },
    vertexShader: fullScreenVertexShader,
  })
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(1, 1),
    pathTracingViewportConfig.bloom.strength,
    pathTracingViewportConfig.bloom.radius,
    pathTracingViewportConfig.bloom.threshold,
  )

  quadScene.add(quad)

  let targetWidth = 1
  let targetHeight = 1
  const maskTarget = createMaskTarget(targetWidth, targetHeight)
  const assetColorTarget = createColorTarget(targetWidth, targetHeight, 'asset-color')
  const combinedTarget = createColorTarget(targetWidth, targetHeight, 'combined')
  const bloomScratchTarget = createColorTarget(targetWidth, targetHeight, 'bloom-scratch')

  function setSize(width: number, height: number, pixelRatio: number) {
    const nextWidth = Math.max(1, Math.floor(width * pixelRatio))
    const nextHeight = Math.max(1, Math.floor(height * pixelRatio))

    if (targetWidth === nextWidth && targetHeight === nextHeight) {
      return
    }

    targetWidth = nextWidth
    targetHeight = nextHeight
    maskTarget.setSize(targetWidth, targetHeight)
    assetColorTarget.setSize(targetWidth, targetHeight)
    combinedTarget.setSize(targetWidth, targetHeight)
    bloomScratchTarget.setSize(targetWidth, targetHeight)
    bloomPass.setSize(targetWidth, targetHeight)
  }

  function dispose() {
    maskTarget.dispose()
    assetColorTarget.dispose()
    combinedTarget.dispose()
    bloomScratchTarget.dispose()
    maskMaterial.dispose()
    assetColorMaterial.dispose()
    combineMaterial.dispose()
    bloomPass.dispose()
    quad.geometry.dispose()
  }

  function render({
    camera,
    inputTexture,
    renderer,
    scene,
  }: PathTracingAssetBloomRenderOptions) {
    const previousRenderTarget = renderer.getRenderTarget()
    const previousOverrideMaterial = scene.overrideMaterial
    const previousAutoClear = renderer.autoClear
    const previousClearColor = new THREE.Color()
    const previousClearAlpha = renderer.getClearAlpha()

    renderer.getClearColor(previousClearColor)

    try {
      renderAssetMask(renderer, scene, camera, maskTarget, maskMaterial)

      assetColorMaterial.uniforms.tInput.value = inputTexture
      assetColorMaterial.uniforms.tMask.value = maskTarget.texture
      renderFullscreenPass(renderer, assetColorMaterial, assetColorTarget)

      bloomPass.renderToScreen = false
      bloomPass.render(renderer, bloomScratchTarget, assetColorTarget, 0, false)

      combineMaterial.uniforms.tBase.value = inputTexture
      combineMaterial.uniforms.tBloom.value =
        bloomPass.renderTargetsHorizontal[0].texture
      renderFullscreenPass(renderer, combineMaterial, combinedTarget)

      return combinedTarget.texture
    } finally {
      scene.overrideMaterial = previousOverrideMaterial
      renderer.setRenderTarget(previousRenderTarget)
      renderer.setClearColor(previousClearColor, previousClearAlpha)
      renderer.autoClear = previousAutoClear
    }
  }

  function renderFullscreenPass(
    renderer: THREE.WebGLRenderer,
    material: THREE.Material,
    target: THREE.WebGLRenderTarget,
  ) {
    quad.material = material
    renderer.setRenderTarget(target)
    renderer.clear(true, false, false)
    renderer.render(quadScene, quadCamera)
  }

  return {
    dispose,
    render,
    setSize,
  }
}

function renderAssetMask(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  target: THREE.WebGLRenderTarget,
  maskMaterial: THREE.Material,
) {
  const visibilitySnapshots = collectAssetMaskVisibilitySnapshots(scene)
  const previousBackground = scene.background
  const previousOverrideMaterial = scene.overrideMaterial

  scene.background = null
  scene.overrideMaterial = maskMaterial
  renderer.autoClear = true
  renderer.setClearColor(0x000000, 1)
  renderer.setRenderTarget(target)
  renderer.clear(true, true, true)
  renderer.render(scene, camera)
  scene.background = previousBackground
  scene.overrideMaterial = previousOverrideMaterial
  restoreVisibilitySnapshots(visibilitySnapshots)
}

function collectAssetMaskVisibilitySnapshots(scene: THREE.Scene) {
  const snapshots: VisibilitySnapshot[] = []

  scene.traverse((object) => {
    if (!isMeshLike(object)) {
      return
    }

    snapshots.push({
      object,
      visible: object.visible,
    })
    object.visible = object.visible && isPathTracingAssetBloomObject(object)
  })

  return snapshots
}

function restoreVisibilitySnapshots(snapshots: readonly VisibilitySnapshot[]) {
  for (const snapshot of snapshots) {
    snapshot.object.visible = snapshot.visible
  }
}

function createColorTarget(width: number, height: number, label: string) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false,
    format: THREE.RGBAFormat,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
    stencilBuffer: false,
    type: THREE.HalfFloatType,
  })

  target.texture.name = `Manifest3D path tracing asset bloom ${label}`
  target.texture.colorSpace = THREE.NoColorSpace

  return target
}

function createMaskTarget(width: number, height: number) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    format: THREE.RGBAFormat,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
  })

  target.texture.name = 'Manifest3D path tracing asset bloom mask'
  target.texture.colorSpace = THREE.NoColorSpace

  return target
}

function isMeshLike(object: THREE.Object3D): object is MeshLike {
  return (object as MeshLike).isMesh === true
}
