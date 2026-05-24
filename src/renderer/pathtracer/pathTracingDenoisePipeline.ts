import * as THREE from 'three'
import { pathTracingViewportConfig } from './pathTracingConfig'

export type PathTracingDenoiseConfig = typeof pathTracingViewportConfig.denoise

export type PathTracingDenoisePipeline = {
  dispose: () => void
  render: (options: PathTracingDenoiseRenderOptions) => PathTracingDenoiseResult
  reset: () => void
  setSize: (width: number, height: number, pixelRatio: number) => void
}

export type PathTracingDenoiseRenderOptions = {
  camera: THREE.PerspectiveCamera
  inputTexture: THREE.Texture
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
}

export type PathTracingDenoiseReadiness = {
  enabled: boolean
  maxSamples: number
  sampleCount: number
}

export type PathTracingDenoiseResult = {
  status: 'denoised' | 'error'
  texture: THREE.Texture
}

const fullScreenVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const normalVertexShader = /* glsl */ `
  varying vec3 vViewNormal;

  void main() {
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const normalFragmentShader = /* glsl */ `
  varying vec3 vViewNormal;

  void main() {
    gl_FragColor = vec4(normalize(vViewNormal) * 0.5 + 0.5, 1.0);
  }
`

const fireflyClampFragmentShader = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 uTexelSize;
  uniform float uThresholdSigma;
  varying vec2 vUv;

  float denoiseLuminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  void main() {
    vec3 center = texture2D(tInput, vUv).rgb;
    float centerLum = denoiseLuminance(center);
    float sumLum = 0.0;
    float sumLumSq = 0.0;

    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 uv = vUv + vec2(float(x), float(y)) * uTexelSize;
        float sampleLum = denoiseLuminance(texture2D(tInput, uv).rgb);
        sumLum += sampleLum;
        sumLumSq += sampleLum * sampleLum;
      }
    }

    float meanLum = sumLum / 9.0;
    float varianceLum = max((sumLumSq / 9.0) - (meanLum * meanLum), 0.0);
    float limitLum = meanLum + sqrt(varianceLum) * uThresholdSigma;

    if (centerLum > limitLum && centerLum > 0.0001) {
      center *= limitLum / centerLum;
    }

    gl_FragColor = vec4(center, 1.0);
  }
`

const atrousFragmentShader = /* glsl */ `
  uniform sampler2D tInput;
  uniform sampler2D tNormal;
  uniform sampler2D tDepth;
  uniform vec2 uTexelSize;
  uniform float uStepWidth;
  uniform float uColorPhi;
  uniform float uNormalPhi;
  uniform float uDepthPhi;
  varying vec2 vUv;

  float kernelWeight(int offset) {
    int magnitude = abs(offset);

    if (magnitude == 0) {
      return 0.375;
    }

    if (magnitude == 1) {
      return 0.25;
    }

    return 0.0625;
  }

  float denoiseLuminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  vec3 decodeNormal(vec3 encodedNormal) {
    return normalize(encodedNormal * 2.0 - 1.0);
  }

  void main() {
    vec3 centerColor = texture2D(tInput, vUv).rgb;
    vec3 centerNormal = decodeNormal(texture2D(tNormal, vUv).rgb);
    float centerDepth = texture2D(tDepth, vUv).r;
    float centerLum = denoiseLuminance(centerColor);
    vec3 sumColor = vec3(0.0);
    float sumWeight = 0.0;

    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 offset = vec2(float(x), float(y)) * uTexelSize * uStepWidth;
        vec2 sampleUv = clamp(vUv + offset, vec2(0.0), vec2(1.0));
        vec3 sampleColor = texture2D(tInput, sampleUv).rgb;
        vec3 sampleNormal = decodeNormal(texture2D(tNormal, sampleUv).rgb);
        float sampleDepth = texture2D(tDepth, sampleUv).r;
        float sampleLum = denoiseLuminance(sampleColor);
        float spatialWeight = kernelWeight(x) * kernelWeight(y);
        float colorWeight = exp(-abs(sampleLum - centerLum) / max(uColorPhi, 0.0001));
        float normalWeight = exp(-(1.0 - max(dot(centerNormal, sampleNormal), 0.0)) / max(uNormalPhi, 0.0001));
        float depthWeight = exp(-abs(sampleDepth - centerDepth) / max(uDepthPhi, 0.000001));
        float weight = spatialWeight * colorWeight * normalWeight * depthWeight;

        sumColor += sampleColor * weight;
        sumWeight += weight;
      }
    }

    gl_FragColor = vec4(sumColor / max(sumWeight, 0.0001), 1.0);
  }
`

export function createPathTracingDenoisePipeline(
  config: PathTracingDenoiseConfig = pathTracingViewportConfig.denoise,
): PathTracingDenoisePipeline {
  const quadScene = new THREE.Scene()
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
  const normalMaterial = new THREE.ShaderMaterial({
    depthTest: true,
    depthWrite: true,
    fragmentShader: normalFragmentShader,
    name: 'Manifest3D path tracing denoise normal material',
    vertexShader: normalVertexShader,
  })
  const fireflyMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fragmentShader: fireflyClampFragmentShader,
    name: 'Manifest3D path tracing denoise firefly clamp material',
    uniforms: {
      tInput: { value: null as THREE.Texture | null },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
      uThresholdSigma: { value: config.fireflyClampSigma },
    },
    vertexShader: fullScreenVertexShader,
  })
  const atrousMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fragmentShader: atrousFragmentShader,
    name: 'Manifest3D path tracing denoise à-trous material',
    uniforms: {
      tDepth: { value: null as THREE.Texture | null },
      tInput: { value: null as THREE.Texture | null },
      tNormal: { value: null as THREE.Texture | null },
      uColorPhi: { value: config.colorPhi },
      uDepthPhi: { value: config.depthPhi },
      uNormalPhi: { value: config.normalPhi },
      uStepWidth: { value: 1 },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: fullScreenVertexShader,
  })

  quadScene.add(quad)

  let targetWidth = 1
  let targetHeight = 1
  let hasPipelineError = false
  const normalDepthTarget = createNormalDepthTarget(targetWidth, targetHeight)
  const fireflyTarget = createColorTarget(targetWidth, targetHeight, 'firefly')
  const pingTargetA = createColorTarget(targetWidth, targetHeight, 'ping-a')
  const pingTargetB = createColorTarget(targetWidth, targetHeight, 'ping-b')

  function disposeTargets() {
    normalDepthTarget.dispose()
    normalDepthTarget.depthTexture?.dispose()
    fireflyTarget.dispose()
    pingTargetA.dispose()
    pingTargetB.dispose()
  }

  function setSize(width: number, height: number, pixelRatio: number) {
    const nextWidth = Math.max(1, Math.floor(width * pixelRatio))
    const nextHeight = Math.max(1, Math.floor(height * pixelRatio))

    if (targetWidth === nextWidth && targetHeight === nextHeight) {
      return
    }

    targetWidth = nextWidth
    targetHeight = nextHeight
    normalDepthTarget.setSize(targetWidth, targetHeight)
    normalDepthTarget.depthTexture?.dispose()
    normalDepthTarget.depthTexture = createDepthTexture(targetWidth, targetHeight)
    fireflyTarget.setSize(targetWidth, targetHeight)
    pingTargetA.setSize(targetWidth, targetHeight)
    pingTargetB.setSize(targetWidth, targetHeight)
    fireflyMaterial.uniforms.uTexelSize.value.set(1 / targetWidth, 1 / targetHeight)
    atrousMaterial.uniforms.uTexelSize.value.set(1 / targetWidth, 1 / targetHeight)
  }

  function reset() {
    hasPipelineError = false
  }

  function dispose() {
    disposeTargets()
    normalMaterial.dispose()
    fireflyMaterial.dispose()
    atrousMaterial.dispose()
    quad.geometry.dispose()
  }

  function render({
    camera,
    inputTexture,
    renderer,
    scene,
  }: PathTracingDenoiseRenderOptions): PathTracingDenoiseResult {
    if (hasPipelineError) {
      return createDenoiseErrorResult(inputTexture)
    }

    const previousRenderTarget = renderer.getRenderTarget()
    const previousOverrideMaterial = scene.overrideMaterial
    const previousAutoClear = renderer.autoClear
    const previousClearColor = new THREE.Color()
    const previousClearAlpha = renderer.getClearAlpha()
    renderer.getClearColor(previousClearColor)

    try {
      renderer.autoClear = true

      scene.overrideMaterial = normalMaterial
      renderer.setClearColor(0x8080ff, 1)
      renderer.setRenderTarget(normalDepthTarget)
      renderer.clear(true, true, true)
      renderer.render(scene, camera)
      scene.overrideMaterial = previousOverrideMaterial

      if (didWebGlPassFail(renderer)) {
        hasPipelineError = true
        return createDenoiseErrorResult(inputTexture)
      }

      fireflyMaterial.uniforms.tInput.value = inputTexture
      renderFullscreenPass(renderer, fireflyMaterial, fireflyTarget)

      if (didWebGlPassFail(renderer)) {
        hasPipelineError = true
        return createDenoiseErrorResult(inputTexture)
      }

      atrousMaterial.uniforms.tNormal.value = normalDepthTarget.texture
      atrousMaterial.uniforms.tDepth.value = normalDepthTarget.depthTexture

      let readTexture = fireflyTarget.texture
      let writeTarget = pingTargetA

      for (const stepWidth of getPathTracingDenoiseStepWidths(config.atrousPasses)) {
        atrousMaterial.uniforms.tInput.value = readTexture
        atrousMaterial.uniforms.uStepWidth.value = stepWidth
        renderFullscreenPass(renderer, atrousMaterial, writeTarget)

        if (didWebGlPassFail(renderer)) {
          hasPipelineError = true
          return createDenoiseErrorResult(inputTexture)
        }

        readTexture = writeTarget.texture
        writeTarget = writeTarget === pingTargetA ? pingTargetB : pingTargetA
      }

      return {
        status: 'denoised',
        texture: readTexture,
      }
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
    reset,
    setSize,
  }
}

function createDenoiseErrorResult(texture: THREE.Texture): PathTracingDenoiseResult {
  return {
    status: 'error',
    texture,
  }
}

export function shouldUsePathTracingDenoise({
  enabled,
  maxSamples,
  sampleCount,
}: PathTracingDenoiseReadiness) {
  return enabled && maxSamples > 0 && sampleCount >= maxSamples
}

export function isRecoverablePathTracingDenoiseGlError(errorCode: number) {
  return errorCode !== 0
}

export function getPathTracingDenoiseStepWidths(passCount: number) {
  const normalizedPassCount = Math.max(0, Math.min(4, Math.floor(passCount)))

  return Array.from({ length: normalizedPassCount }, (_, index) => 2 ** index)
}

function didWebGlPassFail(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext()

  return isRecoverablePathTracingDenoiseGlError(gl.getError())
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

  target.texture.name = `Manifest3D path tracing denoise ${label}`
  target.texture.colorSpace = THREE.NoColorSpace

  return target
}

function createNormalDepthTarget(width: number, height: number) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    format: THREE.RGBAFormat,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
  })

  target.texture.name = 'Manifest3D path tracing denoise normals'
  target.texture.colorSpace = THREE.NoColorSpace
  target.depthTexture = createDepthTexture(width, height)

  return target
}

function createDepthTexture(width: number, height: number) {
  const texture = new THREE.DepthTexture(width, height)

  texture.name = 'Manifest3D path tracing denoise depth'
  texture.format = THREE.DepthFormat
  texture.type = THREE.UnsignedIntType
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter

  return texture
}
