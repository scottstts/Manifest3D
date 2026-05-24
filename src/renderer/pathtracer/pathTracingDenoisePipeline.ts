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

type MeshLike = THREE.Object3D & {
  isMesh: true
  material: THREE.Material | THREE.Material[]
}

type MaterialWithDenoiseGuideFields = THREE.Material & {
  alphaMap?: THREE.Texture | null
  alphaTest?: number
  emissive?: THREE.Color
  emissiveIntensity?: number
  map?: THREE.Texture | null
  opacity: number
  roughness?: number
  transparent: boolean
}

type GuideMaterialPair = {
  geometry: THREE.ShaderMaterial
  material: THREE.ShaderMaterial
}

type MaterialSnapshot = {
  material: THREE.Material | THREE.Material[]
  object: MeshLike
}

type GuideRenderMode = 'geometry' | 'material'

const maxDenoisePasses = 4
const denoiseObjectKeyModulo = 997

const fullScreenVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const guideVertexShader = /* glsl */ `
  uniform float uCameraFar;
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying float vLinearDepth;

  void main() {
    vUv = uv;
    vViewNormal = normalize(normalMatrix * normal);

    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vLinearDepth = clamp(-viewPosition.z / max(uCameraFar, 0.0001), 0.0, 1.0);
    gl_Position = projectionMatrix * viewPosition;
  }
`

const guidePreludeFragmentShader = /* glsl */ `
  uniform sampler2D tAlphaMap;
  uniform sampler2D tColorMap;
  uniform float uAlphaTest;
  uniform float uOpacity;
  uniform float uUsesAlphaMap;
  uniform float uUsesColorMap;
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying float vLinearDepth;

  float denoiseGuideAlpha() {
    float alpha = uOpacity;

    if (uUsesAlphaMap > 0.5) {
      alpha *= texture2D(tAlphaMap, vUv).g;
    }

    if (uUsesColorMap > 0.5) {
      alpha *= texture2D(tColorMap, vUv).a;
    }

    return alpha;
  }

  void denoiseDiscardTransparentCutout() {
    float alpha = denoiseGuideAlpha();

    if (alpha <= max(uAlphaTest, 0.001)) {
      discard;
    }
  }
`

const guideGeometryFragmentShader = /* glsl */ `
  ${guidePreludeFragmentShader}

  void main() {
    denoiseDiscardTransparentCutout();

    gl_FragColor = vec4(normalize(vViewNormal) * 0.5 + 0.5, vLinearDepth);
  }
`

const guideMaterialFragmentShader = /* glsl */ `
  ${guidePreludeFragmentShader}
  uniform float uEmissiveProtection;
  uniform float uObjectKey;
  uniform float uRoughness;
  uniform float uTransparent;

  void main() {
    denoiseDiscardTransparentCutout();

    float alpha = denoiseGuideAlpha();
    float transparencyProtection = max(uTransparent, 1.0 - clamp(alpha, 0.0, 1.0));

    gl_FragColor = vec4(
      clamp(transparencyProtection, 0.0, 1.0),
      clamp(uRoughness, 0.0, 1.0),
      clamp(uEmissiveProtection, 0.0, 1.0),
      uObjectKey
    );
  }
`

const denoiseSharedShaderFunctions = /* glsl */ `
  float denoiseLuminance(vec3 color) {
    return dot(max(color, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
  }

  float denoiseCompressedLuminance(vec3 color) {
    return log(1.0 + denoiseLuminance(color));
  }

  vec3 denoiseCompressedColor(vec3 color) {
    return log(vec3(1.0) + max(color, vec3(0.0)));
  }

  vec3 denoiseDecodeNormal(vec3 encodedNormal) {
    return normalize(encodedNormal * 2.0 - 1.0);
  }

  float denoiseObjectWeight(float centerKey, float sampleKey) {
    return abs(centerKey - sampleKey) > 0.0015 ? 0.0 : 1.0;
  }

  float denoiseMaterialWeight(vec4 centerMaterial, vec4 sampleMaterial, float materialPhi) {
    float materialDelta =
      abs(centerMaterial.r - sampleMaterial.r) * 2.0 +
      abs(centerMaterial.g - sampleMaterial.g) +
      abs(centerMaterial.b - sampleMaterial.b) * 1.5;

    return exp(-materialDelta / max(materialPhi, 0.0001));
  }

  float denoiseDepthWeight(float centerDepth, float sampleDepth, float depthPhi, float depthRelativePhi) {
    float depthTolerance = max(depthPhi + centerDepth * depthRelativePhi, 0.000001);

    return exp(-abs(sampleDepth - centerDepth) / depthTolerance);
  }

  float denoiseGeometryEdge(
    sampler2D geometryGuide,
    sampler2D materialGuide,
    vec2 uv,
    vec2 texelSize,
    float depthPhi,
    float depthRelativePhi
  ) {
    vec4 centerGeometry = texture2D(geometryGuide, uv);
    vec4 centerMaterial = texture2D(materialGuide, uv);
    vec3 centerNormal = denoiseDecodeNormal(centerGeometry.rgb);
    float centerDepth = centerGeometry.a;
    float edge = 0.0;

    for (int i = 0; i < 4; i++) {
      vec2 direction = vec2(0.0);

      if (i == 0) {
        direction = vec2(1.0, 0.0);
      } else if (i == 1) {
        direction = vec2(-1.0, 0.0);
      } else if (i == 2) {
        direction = vec2(0.0, 1.0);
      } else {
        direction = vec2(0.0, -1.0);
      }

      vec2 sampleUv = clamp(uv + direction * texelSize, vec2(0.0), vec2(1.0));
      vec4 sampleGeometry = texture2D(geometryGuide, sampleUv);
      vec4 sampleMaterial = texture2D(materialGuide, sampleUv);
      vec3 sampleNormal = denoiseDecodeNormal(sampleGeometry.rgb);
      float normalDelta = 1.0 - max(dot(centerNormal, sampleNormal), 0.0);
      float depthTolerance = max(depthPhi + centerDepth * depthRelativePhi, 0.000001);
      float depthDelta = abs(sampleGeometry.a - centerDepth) / depthTolerance;
      float objectDelta = 1.0 - denoiseObjectWeight(centerMaterial.a, sampleMaterial.a);
      float materialDelta = 1.0 - denoiseMaterialWeight(centerMaterial, sampleMaterial, 0.12);

      edge = max(edge, normalDelta * 5.0);
      edge = max(edge, depthDelta);
      edge = max(edge, objectDelta);
      edge = max(edge, materialDelta);
    }

    return clamp(edge, 0.0, 1.0);
  }

  float denoiseRawProtection(
    vec4 materialGuide,
    float guideEdge,
    float detailProtection,
    float transparencyProtection
  ) {
    float transparentProtection = materialGuide.r * transparencyProtection;
    float emissiveProtection = materialGuide.b * 0.85;
    float edgeProtection = guideEdge * detailProtection;

    return clamp(max(max(transparentProtection, emissiveProtection), edgeProtection), 0.0, 1.0);
  }
`

const fireflyClampFragmentShader = /* glsl */ `
  uniform sampler2D tGuideMaterial;
  uniform sampler2D tInput;
  uniform vec2 uTexelSize;
  uniform float uMinRatio;
  uniform float uThresholdSigma;
  varying vec2 vUv;

  ${denoiseSharedShaderFunctions}

  void main() {
    vec3 center = texture2D(tInput, vUv).rgb;
    vec4 centerMaterial = texture2D(tGuideMaterial, vUv);
    float centerLum = denoiseLuminance(center);
    float centerCompressedLum = denoiseCompressedLuminance(center);
    float sumLum = 0.0;
    float sumCompressedLum = 0.0;
    float sumCompressedLumSq = 0.0;

    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 sampleUv = clamp(vUv + vec2(float(x), float(y)) * uTexelSize, vec2(0.0), vec2(1.0));
        vec3 sampleColor = texture2D(tInput, sampleUv).rgb;
        float sampleLum = denoiseLuminance(sampleColor);
        float sampleCompressedLum = log(1.0 + sampleLum);

        sumLum += sampleLum;
        sumCompressedLum += sampleCompressedLum;
        sumCompressedLumSq += sampleCompressedLum * sampleCompressedLum;
      }
    }

    float meanLum = sumLum / 9.0;
    float meanCompressedLum = sumCompressedLum / 9.0;
    float varianceCompressedLum = max(
      (sumCompressedLumSq / 9.0) - (meanCompressedLum * meanCompressedLum),
      0.0
    );
    float limitCompressedLum =
      meanCompressedLum + sqrt(varianceCompressedLum) * uThresholdSigma;
    float limitLum = max(exp(limitCompressedLum) - 1.0, meanLum);
    bool isOutlier =
      centerCompressedLum > limitCompressedLum &&
      centerLum > max(meanLum * uMinRatio, 0.0001) &&
      centerMaterial.b < 0.5;

    if (isOutlier && centerLum > 0.0001) {
      center *= limitLum / centerLum;
    }

    gl_FragColor = vec4(center, 1.0);
  }
`

const atrousFragmentShader = /* glsl */ `
  uniform sampler2D tGuideGeometry;
  uniform sampler2D tGuideMaterial;
  uniform sampler2D tInput;
  uniform vec2 uTexelSize;
  uniform float uColorPhi;
  uniform float uDepthPhi;
  uniform float uDepthRelativePhi;
  uniform float uDetailProtection;
  uniform float uMaterialPhi;
  uniform float uNormalPhi;
  uniform float uStepWidth;
  uniform float uTransparencyProtection;
  varying vec2 vUv;

  ${denoiseSharedShaderFunctions}

  float denoiseKernelWeight(int offset) {
    int magnitude = abs(offset);

    if (magnitude == 0) {
      return 0.375;
    }

    if (magnitude == 1) {
      return 0.25;
    }

    return 0.0625;
  }

  void main() {
    vec3 centerColor = texture2D(tInput, vUv).rgb;
    vec4 centerGeometry = texture2D(tGuideGeometry, vUv);
    vec4 centerMaterial = texture2D(tGuideMaterial, vUv);
    vec3 centerNormal = denoiseDecodeNormal(centerGeometry.rgb);
    vec3 centerCompressedColor = denoiseCompressedColor(centerColor);
    float centerDepth = centerGeometry.a;
    float guideEdge = denoiseGeometryEdge(
      tGuideGeometry,
      tGuideMaterial,
      vUv,
      uTexelSize,
      uDepthPhi,
      uDepthRelativePhi
    );
    float rawProtection = denoiseRawProtection(
      centerMaterial,
      guideEdge,
      uDetailProtection,
      uTransparencyProtection
    );
    vec3 sumColor = vec3(0.0);
    float sumWeight = 0.0;

    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 offset = vec2(float(x), float(y)) * uTexelSize * uStepWidth;
        vec2 sampleUv = clamp(vUv + offset, vec2(0.0), vec2(1.0));
        vec3 sampleColor = texture2D(tInput, sampleUv).rgb;
        vec4 sampleGeometry = texture2D(tGuideGeometry, sampleUv);
        vec4 sampleMaterial = texture2D(tGuideMaterial, sampleUv);
        vec3 sampleNormal = denoiseDecodeNormal(sampleGeometry.rgb);
        vec3 sampleCompressedColor = denoiseCompressedColor(sampleColor);
        float spatialWeight = denoiseKernelWeight(x) * denoiseKernelWeight(y);
        float colorWeight = exp(
          -length(sampleCompressedColor - centerCompressedColor) / max(uColorPhi, 0.0001)
        );
        float normalWeight = exp(
          -(1.0 - max(dot(centerNormal, sampleNormal), 0.0)) / max(uNormalPhi, 0.0001)
        );
        float depthWeight = denoiseDepthWeight(
          centerDepth,
          sampleGeometry.a,
          uDepthPhi,
          uDepthRelativePhi
        );
        float objectWeight = denoiseObjectWeight(centerMaterial.a, sampleMaterial.a);
        float materialWeight = denoiseMaterialWeight(centerMaterial, sampleMaterial, uMaterialPhi);
        float transparencyStepAttenuation = mix(
          1.0,
          0.2,
          max(centerMaterial.r, sampleMaterial.r) * smoothstep(1.0, 4.0, uStepWidth)
        );
        float weight =
          spatialWeight *
          colorWeight *
          normalWeight *
          depthWeight *
          objectWeight *
          materialWeight *
          transparencyStepAttenuation;

        sumColor += sampleColor * weight;
        sumWeight += weight;
      }
    }

    vec3 filteredColor = sumColor / max(sumWeight, 0.0001);
    gl_FragColor = vec4(mix(filteredColor, centerColor, rawProtection), 1.0);
  }
`

const finalCompositeFragmentShader = /* glsl */ `
  uniform sampler2D tFiltered;
  uniform sampler2D tFirefly;
  uniform sampler2D tGuideGeometry;
  uniform sampler2D tGuideMaterial;
  uniform sampler2D tRaw;
  uniform vec2 uTexelSize;
  uniform float uDepthPhi;
  uniform float uDepthRelativePhi;
  uniform float uDetailProtection;
  uniform float uTransparencyProtection;
  varying vec2 vUv;

  ${denoiseSharedShaderFunctions}

  void main() {
    vec3 rawColor = texture2D(tRaw, vUv).rgb;
    vec3 fireflyColor = texture2D(tFirefly, vUv).rgb;
    vec3 filteredColor = texture2D(tFiltered, vUv).rgb;
    vec4 materialGuide = texture2D(tGuideMaterial, vUv);
    float guideEdge = denoiseGeometryEdge(
      tGuideGeometry,
      tGuideMaterial,
      vUv,
      uTexelSize,
      uDepthPhi,
      uDepthRelativePhi
    );
    float rawProtection = denoiseRawProtection(
      materialGuide,
      guideEdge,
      uDetailProtection,
      uTransparencyProtection
    );
    vec3 protectedColor = mix(fireflyColor, rawColor, materialGuide.b);

    gl_FragColor = vec4(mix(filteredColor, protectedColor, rawProtection), 1.0);
  }
`

export function createPathTracingDenoisePipeline(
  config: PathTracingDenoiseConfig = pathTracingViewportConfig.denoise,
): PathTracingDenoisePipeline {
  const quadScene = new THREE.Scene()
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
  const fireflyMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fragmentShader: fireflyClampFragmentShader,
    name: 'Manifest3D path tracing denoise firefly clamp material',
    uniforms: {
      tGuideMaterial: { value: null as THREE.Texture | null },
      tInput: { value: null as THREE.Texture | null },
      uMinRatio: { value: config.fireflyMinRatio },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
      uThresholdSigma: { value: config.fireflyClampSigma },
    },
    vertexShader: fullScreenVertexShader,
  })
  const atrousMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fragmentShader: atrousFragmentShader,
    name: 'Manifest3D path tracing denoise adaptive à-trous material',
    uniforms: {
      tGuideGeometry: { value: null as THREE.Texture | null },
      tGuideMaterial: { value: null as THREE.Texture | null },
      tInput: { value: null as THREE.Texture | null },
      uColorPhi: { value: config.colorPhi },
      uDepthPhi: { value: config.depthPhi },
      uDepthRelativePhi: { value: config.depthRelativePhi },
      uDetailProtection: { value: config.detailProtection },
      uMaterialPhi: { value: config.materialPhi },
      uNormalPhi: { value: config.normalPhi },
      uStepWidth: { value: 1 },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
      uTransparencyProtection: { value: config.transparencyProtection },
    },
    vertexShader: fullScreenVertexShader,
  })
  const finalCompositeMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fragmentShader: finalCompositeFragmentShader,
    name: 'Manifest3D path tracing denoise final detail composite material',
    uniforms: {
      tFiltered: { value: null as THREE.Texture | null },
      tFirefly: { value: null as THREE.Texture | null },
      tGuideGeometry: { value: null as THREE.Texture | null },
      tGuideMaterial: { value: null as THREE.Texture | null },
      tRaw: { value: null as THREE.Texture | null },
      uDepthPhi: { value: config.depthPhi },
      uDepthRelativePhi: { value: config.depthRelativePhi },
      uDetailProtection: { value: config.detailProtection },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
      uTransparencyProtection: { value: config.transparencyProtection },
    },
    vertexShader: fullScreenVertexShader,
  })

  quadScene.add(quad)

  let targetWidth = 1
  let targetHeight = 1
  let hasPipelineError = false
  const guideMaterials = new Map<THREE.Material, GuideMaterialPair>()
  const guideGeometryTarget = createGuideTarget(targetWidth, targetHeight, 'geometry')
  const guideMaterialTarget = createGuideTarget(targetWidth, targetHeight, 'material')
  const fireflyTarget = createColorTarget(targetWidth, targetHeight, 'firefly')
  const pingTargetA = createColorTarget(targetWidth, targetHeight, 'ping-a')
  const pingTargetB = createColorTarget(targetWidth, targetHeight, 'ping-b')
  const compositeTarget = createColorTarget(targetWidth, targetHeight, 'composite')

  function disposeTargets() {
    guideGeometryTarget.dispose()
    guideMaterialTarget.dispose()
    fireflyTarget.dispose()
    pingTargetA.dispose()
    pingTargetB.dispose()
    compositeTarget.dispose()
  }

  function disposeGuideMaterials() {
    for (const pair of guideMaterials.values()) {
      pair.geometry.dispose()
      pair.material.dispose()
    }

    guideMaterials.clear()
  }

  function setSize(width: number, height: number, pixelRatio: number) {
    const nextWidth = Math.max(1, Math.floor(width * pixelRatio))
    const nextHeight = Math.max(1, Math.floor(height * pixelRatio))

    if (targetWidth === nextWidth && targetHeight === nextHeight) {
      return
    }

    targetWidth = nextWidth
    targetHeight = nextHeight
    guideGeometryTarget.setSize(targetWidth, targetHeight)
    guideMaterialTarget.setSize(targetWidth, targetHeight)
    fireflyTarget.setSize(targetWidth, targetHeight)
    pingTargetA.setSize(targetWidth, targetHeight)
    pingTargetB.setSize(targetWidth, targetHeight)
    compositeTarget.setSize(targetWidth, targetHeight)
    fireflyMaterial.uniforms.uTexelSize.value.set(1 / targetWidth, 1 / targetHeight)
    atrousMaterial.uniforms.uTexelSize.value.set(1 / targetWidth, 1 / targetHeight)
    finalCompositeMaterial.uniforms.uTexelSize.value.set(
      1 / targetWidth,
      1 / targetHeight,
    )
  }

  function reset() {
    hasPipelineError = false
    disposeGuideMaterials()
  }

  function dispose() {
    disposeTargets()
    disposeGuideMaterials()
    fireflyMaterial.dispose()
    atrousMaterial.dispose()
    finalCompositeMaterial.dispose()
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
    const previousBackground = scene.background
    const previousAutoClear = renderer.autoClear
    const previousClearColor = new THREE.Color()
    const previousClearAlpha = renderer.getClearAlpha()
    renderer.getClearColor(previousClearColor)

    try {
      renderer.autoClear = true
      scene.overrideMaterial = null
      scene.background = null
      updateCameraUniforms(camera)

      renderGuidePass(renderer, scene, camera, guideGeometryTarget, 'geometry')

      if (didWebGlPassFail(renderer)) {
        hasPipelineError = true
        return createDenoiseErrorResult(inputTexture)
      }

      renderGuidePass(renderer, scene, camera, guideMaterialTarget, 'material')

      if (didWebGlPassFail(renderer)) {
        hasPipelineError = true
        return createDenoiseErrorResult(inputTexture)
      }

      fireflyMaterial.uniforms.tGuideMaterial.value = guideMaterialTarget.texture
      fireflyMaterial.uniforms.tInput.value = inputTexture
      renderFullscreenPass(renderer, fireflyMaterial, fireflyTarget)

      if (didWebGlPassFail(renderer)) {
        hasPipelineError = true
        return createDenoiseErrorResult(inputTexture)
      }

      atrousMaterial.uniforms.tGuideGeometry.value = guideGeometryTarget.texture
      atrousMaterial.uniforms.tGuideMaterial.value = guideMaterialTarget.texture

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

      finalCompositeMaterial.uniforms.tFiltered.value = readTexture
      finalCompositeMaterial.uniforms.tFirefly.value = fireflyTarget.texture
      finalCompositeMaterial.uniforms.tGuideGeometry.value =
        guideGeometryTarget.texture
      finalCompositeMaterial.uniforms.tGuideMaterial.value =
        guideMaterialTarget.texture
      finalCompositeMaterial.uniforms.tRaw.value = inputTexture
      renderFullscreenPass(renderer, finalCompositeMaterial, compositeTarget)

      if (didWebGlPassFail(renderer)) {
        hasPipelineError = true
        return createDenoiseErrorResult(inputTexture)
      }

      return {
        status: 'denoised',
        texture: compositeTarget.texture,
      }
    } finally {
      scene.overrideMaterial = previousOverrideMaterial
      scene.background = previousBackground
      renderer.setRenderTarget(previousRenderTarget)
      renderer.setClearColor(previousClearColor, previousClearAlpha)
      renderer.autoClear = previousAutoClear
    }
  }

  function updateCameraUniforms(camera: THREE.PerspectiveCamera) {
    const normalizedDepthPhi = getPathTracingDenoiseNormalizedDepthPhi(
      config.depthPhi,
      camera.far,
    )

    for (const pair of guideMaterials.values()) {
      pair.geometry.uniforms.uCameraFar.value = camera.far
      pair.material.uniforms.uCameraFar.value = camera.far
    }

    atrousMaterial.uniforms.uDepthPhi.value = normalizedDepthPhi
    finalCompositeMaterial.uniforms.uDepthPhi.value = normalizedDepthPhi
  }

  function renderGuidePass(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    target: THREE.WebGLRenderTarget,
    mode: GuideRenderMode,
  ) {
    const snapshots = replaceSceneMaterialsForGuidePass(scene, mode)

    try {
      if (mode === 'geometry') {
        renderer.setClearColor(0x8080ff, 1)
      } else {
        renderer.setClearColor(new THREE.Color(0, 1, 0), 0)
      }

      renderer.setRenderTarget(target)
      renderer.clear(true, true, true)
      renderer.render(scene, camera)
    } finally {
      restoreSceneMaterials(snapshots)
    }
  }

  function replaceSceneMaterialsForGuidePass(
    scene: THREE.Scene,
    mode: GuideRenderMode,
  ) {
    const snapshots: MaterialSnapshot[] = []

    scene.traverse((object) => {
      if (!isMeshLike(object)) {
        return
      }

      snapshots.push({
        material: object.material,
        object,
      })

      object.material = Array.isArray(object.material)
        ? object.material.map((material) => getGuideMaterial(material, mode))
        : getGuideMaterial(object.material, mode)
    })

    return snapshots
  }

  function getGuideMaterial(
    sourceMaterial: THREE.Material,
    mode: GuideRenderMode,
  ) {
    let pair = guideMaterials.get(sourceMaterial)

    if (!pair) {
      pair = createGuideMaterialPair(sourceMaterial)
      guideMaterials.set(sourceMaterial, pair)
    }

    return mode === 'geometry' ? pair.geometry : pair.material
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
  const normalizedPassCount = Math.max(
    0,
    Math.min(maxDenoisePasses, Math.floor(passCount)),
  )

  return Array.from({ length: normalizedPassCount }, (_, index) => 2 ** index)
}

export function getPathTracingDenoiseObjectKey(objectId: number) {
  const normalizedObjectId = Math.max(1, Math.floor(Math.abs(objectId)))
  const hashedKey = (normalizedObjectId * 16807) % (denoiseObjectKeyModulo - 1)

  return (hashedKey + 1) / denoiseObjectKeyModulo
}

export function getPathTracingDenoiseNormalizedDepthPhi(
  depthPhi: number,
  cameraFar: number,
) {
  if (!Number.isFinite(depthPhi) || !Number.isFinite(cameraFar) || cameraFar <= 0) {
    return 0.001
  }

  return Math.max(depthPhi / cameraFar, 0.000001)
}

function didWebGlPassFail(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext()

  return isRecoverablePathTracingDenoiseGlError(gl.getError())
}

function createGuideMaterialPair(
  sourceMaterial: THREE.Material,
): GuideMaterialPair {
  const source = sourceMaterial as MaterialWithDenoiseGuideFields
  const commonUniforms = createGuideUniforms(source)
  const geometryMaterial = new THREE.ShaderMaterial({
    depthTest: source.depthTest,
    depthWrite: true,
    fragmentShader: guideGeometryFragmentShader,
    name: 'Manifest3D path tracing denoise geometry guide material',
    side: source.side,
    transparent: false,
    uniforms: THREE.UniformsUtils.clone(commonUniforms),
    vertexShader: guideVertexShader,
    visible: source.visible,
  })
  const materialMaterial = new THREE.ShaderMaterial({
    depthTest: source.depthTest,
    depthWrite: true,
    fragmentShader: guideMaterialFragmentShader,
    name: 'Manifest3D path tracing denoise material guide material',
    side: source.side,
    transparent: false,
    uniforms: THREE.UniformsUtils.clone({
      ...commonUniforms,
      uEmissiveProtection: { value: getEmissiveProtection(source) },
      uObjectKey: { value: 0 },
      uRoughness: { value: source.roughness ?? 1 },
      uTransparent: {
        value: source.transparent || source.opacity < 0.999 ? 1 : 0,
      },
    }),
    vertexShader: guideVertexShader,
    visible: source.visible,
  })

  geometryMaterial.onBeforeRender = (_renderer, _scene, camera) => {
    geometryMaterial.uniforms.uCameraFar.value = getCameraFar(camera)
  }
  materialMaterial.onBeforeRender = (_renderer, _scene, camera, _geometry, object) => {
    materialMaterial.uniforms.uCameraFar.value = getCameraFar(camera)
    materialMaterial.uniforms.uObjectKey.value = getPathTracingDenoiseObjectKey(
      object.id,
    )
  }

  return {
    geometry: geometryMaterial,
    material: materialMaterial,
  }
}

function createGuideUniforms(source: MaterialWithDenoiseGuideFields) {
  return {
    tAlphaMap: { value: source.alphaMap ?? null },
    tColorMap: { value: source.map ?? null },
    uAlphaTest: { value: source.alphaTest ?? 0 },
    uCameraFar: { value: 80 },
    uOpacity: { value: source.opacity ?? 1 },
    uUsesAlphaMap: { value: source.alphaMap ? 1 : 0 },
    uUsesColorMap: { value: source.map ? 1 : 0 },
  }
}

function getEmissiveProtection(source: MaterialWithDenoiseGuideFields) {
  const emissive = source.emissive ?? new THREE.Color(0, 0, 0)
  const emissiveIntensity = source.emissiveIntensity ?? 0
  const emissiveLuminance =
    emissive.r * 0.2126 + emissive.g * 0.7152 + emissive.b * 0.0722

  return Math.min(1, emissiveLuminance * Math.max(emissiveIntensity, 0))
}

function getCameraFar(camera: THREE.Camera) {
  return camera instanceof THREE.PerspectiveCamera ? camera.far : 80
}

function restoreSceneMaterials(snapshots: readonly MaterialSnapshot[]) {
  for (const snapshot of snapshots) {
    snapshot.object.material = snapshot.material
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

  target.texture.name = `Manifest3D path tracing denoise ${label}`
  target.texture.colorSpace = THREE.NoColorSpace

  return target
}

function createGuideTarget(width: number, height: number, label: string) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    format: THREE.RGBAFormat,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    stencilBuffer: false,
    type: THREE.HalfFloatType,
  })

  target.texture.name = `Manifest3D path tracing denoise ${label} guide`
  target.texture.colorSpace = THREE.NoColorSpace

  return target
}

function isMeshLike(object: THREE.Object3D): object is MeshLike {
  return (object as MeshLike).isMesh === true
}
