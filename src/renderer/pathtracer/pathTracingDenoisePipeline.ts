import * as THREE from 'three'
import { pathTracingViewportConfig } from './pathTracingConfig'
import { getPathTracingDenoiseEmissiveFireflyRecoveryStrength } from './pathTracingDenoiseFireflyRecovery'

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
  color?: THREE.Color
  emissive?: THREE.Color
  emissiveIntensity?: number
  map?: THREE.Texture | null
  metalness?: number
  metalnessMap?: THREE.Texture | null
  opacity: number
  roughness?: number
  transparent: boolean
}

type GuideMaterialPair = {
  albedo: THREE.ShaderMaterial
  geometry: THREE.ShaderMaterial
  material: THREE.ShaderMaterial
}

type MaterialSnapshot = {
  material: THREE.Material | THREE.Material[]
  object: MeshLike
}

type GuideRenderMode = 'albedo' | 'geometry' | 'material'

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

const guideAlbedoFragmentShader = /* glsl */ `
  ${guidePreludeFragmentShader}
  uniform sampler2D tMetalnessMap;
  uniform float uMetalness;
  uniform float uUsesMetalnessMap;
  uniform vec3 uBaseColor;

  void main() {
    denoiseDiscardTransparentCutout();

    vec3 albedo = uBaseColor;
    float metalness = uMetalness;

    if (uUsesColorMap > 0.5) {
      albedo *= texture2D(tColorMap, vUv).rgb;
    }

    if (uUsesMetalnessMap > 0.5) {
      metalness *= texture2D(tMetalnessMap, vUv).b;
    }

    gl_FragColor = vec4(max(albedo, vec3(0.0)), clamp(metalness, 0.0, 1.0));
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

  float denoiseAlbedoWeight(vec4 centerAlbedo, vec4 sampleAlbedo) {
    float albedoDelta =
      length(centerAlbedo.rgb - sampleAlbedo.rgb) +
      abs(centerAlbedo.a - sampleAlbedo.a) * 1.4;

    return exp(-albedoDelta / 0.28);
  }

  float denoiseDiffuseConfidence(vec4 materialGuide, vec4 albedoGuide, float guideEdge) {
    float opaque = 1.0 - materialGuide.r;
    float rough = smoothstep(0.45, 0.92, materialGuide.g);
    float dielectric = 1.0 - smoothstep(0.04, 0.36, albedoGuide.a);
    float nonEmissive = 1.0 - materialGuide.b;
    float broadSurface = 1.0 - guideEdge;

    return clamp(opaque * rough * dielectric * nonEmissive * broadSurface, 0.0, 1.0);
  }

  float denoiseTransparentInteriorConfidence(vec4 materialGuide, float guideEdge) {
    return clamp(materialGuide.r * (1.0 - guideEdge) * (1.0 - materialGuide.b), 0.0, 1.0);
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
    float transparencyInteriorProtection,
    float transparencyProtection
  ) {
    float transparentEdge = smoothstep(0.12, 0.85, guideEdge);
    float transparentProtection = materialGuide.r * mix(
      transparencyInteriorProtection,
      transparencyProtection,
      transparentEdge
    );
    float emissiveProtection = materialGuide.b * 0.85;
    float edgeProtection = guideEdge * detailProtection;

    return clamp(max(max(transparentProtection, emissiveProtection), edgeProtection), 0.0, 1.0);
  }
`

const fireflyConfidenceFragmentShader = /* glsl */ `
  uniform sampler2D tGuideAlbedo;
  uniform sampler2D tGuideGeometry;
  uniform sampler2D tGuideMaterial;
  uniform sampler2D tInput;
  uniform vec2 uTexelSize;
  uniform float uDarkReceiverHighLuminance;
  uniform float uDarkReceiverLowLuminance;
  uniform float uDepthPhi;
  uniform float uDepthRelativePhi;
  uniform float uLocalDensityMin;
  uniform float uLocalMinLuminance;
  uniform float uLocalMinRatio;
  uniform float uLocalSigma;
  uniform float uMaterialPhi;
  uniform float uNormalPhi;
  uniform float uRecoveryStrength;
  varying vec2 vUv;

  ${denoiseSharedShaderFunctions}

  float denoiseFireflyConfidenceKernelWeight(int x, int y) {
    vec2 offset = vec2(float(x), float(y));

    return exp(-dot(offset, offset) / 5.0);
  }

  float denoiseFireflyConfidenceSurfaceWeight(
    vec4 centerAlbedo,
    vec4 centerGeometry,
    vec4 centerMaterial,
    vec3 centerNormal,
    float centerDepth,
    vec4 sampleAlbedo,
    vec4 sampleGeometry,
    vec4 sampleMaterial
  ) {
    vec3 sampleNormal = denoiseDecodeNormal(sampleGeometry.rgb);
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
    float albedoWeight = denoiseAlbedoWeight(centerAlbedo, sampleAlbedo);
    float sampleDiffuseSurface =
      (1.0 - sampleMaterial.r) *
      smoothstep(0.45, 0.92, sampleMaterial.g) *
      (1.0 - smoothstep(0.04, 0.36, sampleAlbedo.a)) *
      (1.0 - sampleMaterial.b);

    return normalWeight *
      depthWeight *
      objectWeight *
      materialWeight *
      albedoWeight *
      sampleDiffuseSurface;
  }

  void main() {
    if (uRecoveryStrength <= 0.0001) {
      gl_FragColor = vec4(0.0);
      return;
    }

    vec3 centerColor = texture2D(tInput, vUv).rgb;
    vec4 centerAlbedo = texture2D(tGuideAlbedo, vUv);
    vec4 centerGeometry = texture2D(tGuideGeometry, vUv);
    vec4 centerMaterial = texture2D(tGuideMaterial, vUv);
    vec3 centerNormal = denoiseDecodeNormal(centerGeometry.rgb);
    float centerDepth = centerGeometry.a;
    float guideEdge = denoiseGeometryEdge(
      tGuideGeometry,
      tGuideMaterial,
      vUv,
      uTexelSize,
      uDepthPhi,
      uDepthRelativePhi
    );
    float darkReceiver = 1.0 - smoothstep(
      uDarkReceiverLowLuminance,
      uDarkReceiverHighLuminance,
      denoiseLuminance(centerAlbedo.rgb)
    );
    float surfaceConfidence =
      denoiseDiffuseConfidence(centerMaterial, centerAlbedo, guideEdge) *
      darkReceiver *
      uRecoveryStrength;

    if (surfaceConfidence <= 0.0001) {
      gl_FragColor = vec4(0.0);
      return;
    }

    float centerLum = denoiseLuminance(centerColor);
    float centerCompressedLum = denoiseCompressedLuminance(centerColor);
    float sumWeight = 0.0;
    float sumLum = 0.0;
    float sumCompressedLum = 0.0;
    float sumCompressedLumSq = 0.0;

    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        if (x == 0 && y == 0) {
          continue;
        }

        vec2 sampleUv = clamp(vUv + vec2(float(x), float(y)) * uTexelSize, vec2(0.0), vec2(1.0));
        vec3 sampleColor = texture2D(tInput, sampleUv).rgb;
        vec4 sampleAlbedo = texture2D(tGuideAlbedo, sampleUv);
        vec4 sampleGeometry = texture2D(tGuideGeometry, sampleUv);
        vec4 sampleMaterial = texture2D(tGuideMaterial, sampleUv);
        float surfaceWeight = denoiseFireflyConfidenceSurfaceWeight(
          centerAlbedo,
          centerGeometry,
          centerMaterial,
          centerNormal,
          centerDepth,
          sampleAlbedo,
          sampleGeometry,
          sampleMaterial
        );
        float weight = denoiseFireflyConfidenceKernelWeight(x, y) * surfaceWeight;
        float sampleLum = denoiseLuminance(sampleColor);
        float sampleCompressedLum = log(1.0 + sampleLum);

        sumWeight += weight;
        sumLum += sampleLum * weight;
        sumCompressedLum += sampleCompressedLum * weight;
        sumCompressedLumSq += sampleCompressedLum * sampleCompressedLum * weight;
      }
    }

    float safeWeight = max(sumWeight, 0.0001);
    float meanLum = sumLum / safeWeight;
    float meanCompressedLum = sumCompressedLum / safeWeight;
    float varianceCompressedLum = max(
      (sumCompressedLumSq / safeWeight) - (meanCompressedLum * meanCompressedLum),
      0.0
    );
    float sigmaCompressedLum = sqrt(varianceCompressedLum);
    float limitCompressedLum =
      meanCompressedLum + sigmaCompressedLum * uLocalSigma;
    float directSigmaConfidence = smoothstep(
      0.0,
      1.0,
      (centerCompressedLum - limitCompressedLum) /
        max(sigmaCompressedLum * 0.75, 0.08)
    );
    float directRatioConfidence = smoothstep(
      uLocalMinRatio,
      uLocalMinRatio * 1.6,
      centerLum / max(meanLum, 0.0001)
    );
    float directFloorConfidence = smoothstep(
      uLocalMinLuminance,
      uLocalMinLuminance * 3.0,
      centerLum
    );
    float directConfidence =
      surfaceConfidence *
      directSigmaConfidence *
      directRatioConfidence *
      directFloorConfidence;
    float brightNeighborWeight = 0.0;

    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 sampleUv = clamp(vUv + vec2(float(x), float(y)) * uTexelSize, vec2(0.0), vec2(1.0));
        vec3 sampleColor = texture2D(tInput, sampleUv).rgb;
        vec4 sampleAlbedo = texture2D(tGuideAlbedo, sampleUv);
        vec4 sampleGeometry = texture2D(tGuideGeometry, sampleUv);
        vec4 sampleMaterial = texture2D(tGuideMaterial, sampleUv);
        float surfaceWeight = denoiseFireflyConfidenceSurfaceWeight(
          centerAlbedo,
          centerGeometry,
          centerMaterial,
          centerNormal,
          centerDepth,
          sampleAlbedo,
          sampleGeometry,
          sampleMaterial
        );
        float weight = denoiseFireflyConfidenceKernelWeight(x, y) * surfaceWeight;
        float sampleLum = denoiseLuminance(sampleColor);
        float sampleCompressedLum = log(1.0 + sampleLum);
        float brightConfidence =
          smoothstep(
            limitCompressedLum,
            limitCompressedLum + max(sigmaCompressedLum, 0.08),
            sampleCompressedLum
          ) *
          smoothstep(
            uLocalMinRatio,
            uLocalMinRatio * 1.35,
            sampleLum / max(meanLum, 0.0001)
          ) *
          smoothstep(
            uLocalMinLuminance,
            uLocalMinLuminance * 2.5,
            sampleLum
          );

        brightNeighborWeight += weight * brightConfidence;
      }
    }

    float localBrightDensity = brightNeighborWeight / safeWeight;
    float densityConfidence = smoothstep(
      uLocalDensityMin,
      uLocalDensityMin * 2.5,
      localBrightDensity
    ) * surfaceConfidence;
    float repairConfidence = max(directConfidence, densityConfidence * 0.65);

    gl_FragColor = vec4(
      clamp(directConfidence, 0.0, 1.0),
      clamp(surfaceConfidence, 0.0, 1.0),
      clamp(densityConfidence, 0.0, 1.0),
      clamp(repairConfidence, 0.0, 1.0)
    );
  }
`

const fireflyClampFragmentShader = /* glsl */ `
  uniform sampler2D tFireflyConfidence;
  uniform sampler2D tGuideMaterial;
  uniform sampler2D tInput;
  uniform vec2 uTexelSize;
  uniform float uRecoveryClampBlend;
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
    float recoveryConfidence = texture2D(tFireflyConfidence, vUv).r;
    float clampBlend = max(
      isOutlier ? 1.0 : 0.0,
      recoveryConfidence * uRecoveryClampBlend
    );

    if (clampBlend > 0.0001 && centerLum > 0.0001) {
      center = mix(center, center * (limitLum / centerLum), clamp(clampBlend, 0.0, 1.0));
    }

    gl_FragColor = vec4(center, 1.0);
  }
`

const atrousFragmentShader = /* glsl */ `
  uniform sampler2D tFireflyConfidence;
  uniform sampler2D tGuideAlbedo;
  uniform sampler2D tGuideGeometry;
  uniform sampler2D tGuideMaterial;
  uniform sampler2D tInput;
  uniform vec2 uTexelSize;
  uniform float uColorPhi;
  uniform float uDepthPhi;
  uniform float uDepthRelativePhi;
  uniform float uDetailProtection;
  uniform float uFireflyNeighborReject;
  uniform float uMaterialPhi;
  uniform float uNormalPhi;
  uniform float uStepWidth;
  uniform float uTransparencyInteriorProtection;
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
    vec4 centerAlbedo = texture2D(tGuideAlbedo, vUv);
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
      uTransparencyInteriorProtection,
      uTransparencyProtection
    );
    vec3 sumColor = vec3(0.0);
    float sumWeight = 0.0;

    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 offset = vec2(float(x), float(y)) * uTexelSize * uStepWidth;
        vec2 sampleUv = clamp(vUv + offset, vec2(0.0), vec2(1.0));
        vec3 sampleColor = texture2D(tInput, sampleUv).rgb;
        vec4 sampleFireflyConfidence = texture2D(tFireflyConfidence, sampleUv);
        vec4 sampleAlbedo = texture2D(tGuideAlbedo, sampleUv);
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
        float albedoWeight = denoiseAlbedoWeight(centerAlbedo, sampleAlbedo);
        float transparencyStepAttenuation = mix(
          1.0,
          0.34,
          max(centerMaterial.r, sampleMaterial.r) * smoothstep(1.0, 4.0, uStepWidth)
        );
        float fireflyVoteConfidence = max(
          sampleFireflyConfidence.r,
          sampleFireflyConfidence.a * 0.55
        );
        float fireflyVoteWeight = mix(
          1.0,
          max(1.0 - uFireflyNeighborReject, 0.02),
          clamp(fireflyVoteConfidence, 0.0, 1.0)
        );
        float weight =
          spatialWeight *
          colorWeight *
          normalWeight *
          depthWeight *
          objectWeight *
          materialWeight *
          albedoWeight *
          transparencyStepAttenuation *
          fireflyVoteWeight;

        sumColor += sampleColor * weight;
        sumWeight += weight;
      }
    }

    vec3 filteredColor = sumColor / max(sumWeight, 0.0001);
    gl_FragColor = vec4(mix(filteredColor, centerColor, rawProtection), 1.0);
  }
`

const diffuseIlluminationFragmentShader = /* glsl */ `
  uniform sampler2D tFireflyConfidence;
  uniform sampler2D tGuideAlbedo;
  uniform sampler2D tGuideGeometry;
  uniform sampler2D tGuideMaterial;
  uniform sampler2D tInput;
  uniform vec2 uTexelSize;
  uniform float uAlbedoFloor;
  uniform float uDepthPhi;
  uniform float uDepthRelativePhi;
  uniform float uDiffuseBlend;
  uniform float uDiffuseIlluminationPhi;
  uniform float uFireflyDiffuseBlendBoost;
  uniform float uFireflyNeighborReject;
  uniform float uMaterialPhi;
  uniform float uNormalPhi;
  uniform float uStepWidth;
  varying vec2 vUv;

  ${denoiseSharedShaderFunctions}

  float denoiseDiffuseKernelWeight(int offset) {
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
    vec4 centerAlbedoGuide = texture2D(tGuideAlbedo, vUv);
    vec4 centerGeometry = texture2D(tGuideGeometry, vUv);
    vec4 centerMaterial = texture2D(tGuideMaterial, vUv);
    vec3 centerAlbedo = max(centerAlbedoGuide.rgb, vec3(uAlbedoFloor));
    vec3 centerNormal = denoiseDecodeNormal(centerGeometry.rgb);
    vec3 centerIllumination = centerColor / centerAlbedo;
    vec3 centerCompressedIllumination = denoiseCompressedColor(centerIllumination);
    float centerDepth = centerGeometry.a;
    float guideEdge = denoiseGeometryEdge(
      tGuideGeometry,
      tGuideMaterial,
      vUv,
      uTexelSize,
      uDepthPhi,
      uDepthRelativePhi
    );
    float diffuseConfidence = denoiseDiffuseConfidence(
      centerMaterial,
      centerAlbedoGuide,
      guideEdge
    );
    float recoveryRepairConfidence = texture2D(tFireflyConfidence, vUv).a;
    vec3 sumIllumination = vec3(0.0);
    float sumWeight = 0.0;

    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 offset = vec2(float(x), float(y)) * uTexelSize * uStepWidth;
        vec2 sampleUv = clamp(vUv + offset, vec2(0.0), vec2(1.0));
        vec3 sampleColor = texture2D(tInput, sampleUv).rgb;
        vec4 sampleFireflyConfidence = texture2D(tFireflyConfidence, sampleUv);
        vec4 sampleAlbedoGuide = texture2D(tGuideAlbedo, sampleUv);
        vec4 sampleGeometry = texture2D(tGuideGeometry, sampleUv);
        vec4 sampleMaterial = texture2D(tGuideMaterial, sampleUv);
        vec3 sampleAlbedo = max(sampleAlbedoGuide.rgb, vec3(uAlbedoFloor));
        vec3 sampleNormal = denoiseDecodeNormal(sampleGeometry.rgb);
        vec3 sampleIllumination = sampleColor / sampleAlbedo;
        vec3 sampleCompressedIllumination = denoiseCompressedColor(sampleIllumination);
        float spatialWeight = denoiseDiffuseKernelWeight(x) * denoiseDiffuseKernelWeight(y);
        float illuminationWeight = exp(
          -length(sampleCompressedIllumination - centerCompressedIllumination) /
          max(uDiffuseIlluminationPhi, 0.0001)
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
        float albedoWeight = denoiseAlbedoWeight(centerAlbedoGuide, sampleAlbedoGuide);
        float sampleDiffuseSurface =
          (1.0 - sampleMaterial.r) *
          smoothstep(0.45, 0.92, sampleMaterial.g) *
          (1.0 - smoothstep(0.04, 0.36, sampleAlbedoGuide.a)) *
          (1.0 - sampleMaterial.b);
        float fireflyVoteConfidence = max(
          sampleFireflyConfidence.r,
          sampleFireflyConfidence.a * 0.55
        );
        float fireflyVoteWeight = mix(
          1.0,
          max(1.0 - uFireflyNeighborReject, 0.02),
          clamp(fireflyVoteConfidence, 0.0, 1.0)
        );
        float weight =
          spatialWeight *
          illuminationWeight *
          normalWeight *
          depthWeight *
          objectWeight *
          materialWeight *
          albedoWeight *
          sampleDiffuseSurface *
          fireflyVoteWeight;

        sumIllumination += sampleIllumination * weight;
        sumWeight += weight;
      }
    }

    vec3 filteredIllumination = sumIllumination / max(sumWeight, 0.0001);
    vec3 diffuseColor = filteredIllumination * centerAlbedo;
    float blendAmount = diffuseConfidence *
      min(1.0, uDiffuseBlend + recoveryRepairConfidence * uFireflyDiffuseBlendBoost);

    gl_FragColor = vec4(mix(centerColor, diffuseColor, blendAmount), 1.0);
  }
`

const finalCompositeFragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tFireflyConfidence;
  uniform sampler2D tFiltered;
  uniform sampler2D tFirefly;
  uniform sampler2D tGuideAlbedo;
  uniform sampler2D tGuideGeometry;
  uniform sampler2D tGuideMaterial;
  uniform sampler2D tRaw;
  uniform vec2 uTexelSize;
  uniform float uDepthPhi;
  uniform float uDepthRelativePhi;
  uniform float uDetailProtection;
  uniform float uFireflyCompositeBoost;
  uniform float uFireflyRawProtectionReduction;
  uniform float uResidualBlend;
  uniform float uTransparencyInteriorProtection;
  uniform float uTransparencyProtection;
  varying vec2 vUv;

  ${denoiseSharedShaderFunctions}

  void main() {
    vec3 rawColor = texture2D(tRaw, vUv).rgb;
    vec3 fireflyColor = texture2D(tFirefly, vUv).rgb;
    vec4 fireflyConfidence = texture2D(tFireflyConfidence, vUv);
    vec3 filteredColor = texture2D(tFiltered, vUv).rgb;
    vec3 diffuseColor = texture2D(tDiffuse, vUv).rgb;
    vec4 albedoGuide = texture2D(tGuideAlbedo, vUv);
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
      uTransparencyInteriorProtection,
      uTransparencyProtection
    );
    float diffuseConfidence = denoiseDiffuseConfidence(materialGuide, albedoGuide, guideEdge);
    float recoveryRepairConfidence = fireflyConfidence.a;
    rawProtection *= 1.0 - recoveryRepairConfidence * uFireflyRawProtectionReduction;
    float residual = length(denoiseCompressedColor(fireflyColor) - denoiseCompressedColor(filteredColor));
    float residualConfidence = max(
      smoothstep(0.025, 0.22, residual),
      recoveryRepairConfidence
    );
    float diffuseBlend = diffuseConfidence *
      (0.35 + residualConfidence * 0.65) *
      min(1.0, uResidualBlend + recoveryRepairConfidence * uFireflyCompositeBoost);
    vec3 denoisedColor = mix(filteredColor, diffuseColor, diffuseBlend);
    vec3 protectedColor = mix(fireflyColor, rawColor, materialGuide.b);

    gl_FragColor = vec4(mix(denoisedColor, protectedColor, rawProtection), 1.0);
  }
`

export function createPathTracingDenoisePipeline(
  config: PathTracingDenoiseConfig = pathTracingViewportConfig.denoise,
): PathTracingDenoisePipeline {
  const fireflyRecoveryConfig = config.emissiveFireflyRecovery
  const quadScene = new THREE.Scene()
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
  const fireflyConfidenceMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fragmentShader: fireflyConfidenceFragmentShader,
    name: 'Manifest3D path tracing denoise emissive firefly confidence material',
    uniforms: {
      tGuideAlbedo: { value: null as THREE.Texture | null },
      tGuideGeometry: { value: null as THREE.Texture | null },
      tGuideMaterial: { value: null as THREE.Texture | null },
      tInput: { value: null as THREE.Texture | null },
      uDarkReceiverHighLuminance: {
        value: fireflyRecoveryConfig.darkReceiverHighLuminance,
      },
      uDarkReceiverLowLuminance: {
        value: fireflyRecoveryConfig.darkReceiverLowLuminance,
      },
      uDepthPhi: { value: config.depthPhi },
      uDepthRelativePhi: { value: config.depthRelativePhi },
      uLocalDensityMin: { value: fireflyRecoveryConfig.localDensityMin },
      uLocalMinLuminance: { value: fireflyRecoveryConfig.localMinLuminance },
      uLocalMinRatio: { value: fireflyRecoveryConfig.localMinRatio },
      uLocalSigma: { value: fireflyRecoveryConfig.localSigma },
      uMaterialPhi: { value: config.materialPhi },
      uNormalPhi: { value: config.normalPhi },
      uRecoveryStrength: { value: 0 },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: fullScreenVertexShader,
  })
  const fireflyMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fragmentShader: fireflyClampFragmentShader,
    name: 'Manifest3D path tracing denoise firefly clamp material',
    uniforms: {
      tFireflyConfidence: { value: null as THREE.Texture | null },
      tGuideMaterial: { value: null as THREE.Texture | null },
      tInput: { value: null as THREE.Texture | null },
      uMinRatio: { value: config.fireflyMinRatio },
      uRecoveryClampBlend: { value: fireflyRecoveryConfig.clampBlend },
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
      tFireflyConfidence: { value: null as THREE.Texture | null },
      tGuideAlbedo: { value: null as THREE.Texture | null },
      tGuideGeometry: { value: null as THREE.Texture | null },
      tGuideMaterial: { value: null as THREE.Texture | null },
      tInput: { value: null as THREE.Texture | null },
      uColorPhi: { value: config.colorPhi },
      uDepthPhi: { value: config.depthPhi },
      uDepthRelativePhi: { value: config.depthRelativePhi },
      uDetailProtection: { value: config.detailProtection },
      uFireflyNeighborReject: { value: fireflyRecoveryConfig.neighborReject },
      uMaterialPhi: { value: config.materialPhi },
      uNormalPhi: { value: config.normalPhi },
      uStepWidth: { value: 1 },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
      uTransparencyInteriorProtection: {
        value: config.transparencyInteriorProtection,
      },
      uTransparencyProtection: { value: config.transparencyProtection },
    },
    vertexShader: fullScreenVertexShader,
  })
  const diffuseMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fragmentShader: diffuseIlluminationFragmentShader,
    name: 'Manifest3D path tracing denoise diffuse illumination material',
    uniforms: {
      tFireflyConfidence: { value: null as THREE.Texture | null },
      tGuideAlbedo: { value: null as THREE.Texture | null },
      tGuideGeometry: { value: null as THREE.Texture | null },
      tGuideMaterial: { value: null as THREE.Texture | null },
      tInput: { value: null as THREE.Texture | null },
      uAlbedoFloor: { value: config.albedoFloor },
      uDepthPhi: { value: config.depthPhi },
      uDepthRelativePhi: { value: config.depthRelativePhi },
      uDiffuseBlend: { value: config.diffuseBlend },
      uDiffuseIlluminationPhi: { value: config.diffuseIlluminationPhi },
      uFireflyDiffuseBlendBoost: {
        value: fireflyRecoveryConfig.diffuseBlendBoost,
      },
      uFireflyNeighborReject: { value: fireflyRecoveryConfig.neighborReject },
      uMaterialPhi: { value: config.materialPhi },
      uNormalPhi: { value: config.normalPhi },
      uStepWidth: { value: 1 },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: fullScreenVertexShader,
  })
  const finalCompositeMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fragmentShader: finalCompositeFragmentShader,
    name: 'Manifest3D path tracing denoise final detail composite material',
    uniforms: {
      tDiffuse: { value: null as THREE.Texture | null },
      tFireflyConfidence: { value: null as THREE.Texture | null },
      tFiltered: { value: null as THREE.Texture | null },
      tFirefly: { value: null as THREE.Texture | null },
      tGuideAlbedo: { value: null as THREE.Texture | null },
      tGuideGeometry: { value: null as THREE.Texture | null },
      tGuideMaterial: { value: null as THREE.Texture | null },
      tRaw: { value: null as THREE.Texture | null },
      uDepthPhi: { value: config.depthPhi },
      uDepthRelativePhi: { value: config.depthRelativePhi },
      uDetailProtection: { value: config.detailProtection },
      uFireflyCompositeBoost: {
        value: fireflyRecoveryConfig.compositeBoost,
      },
      uFireflyRawProtectionReduction: {
        value: fireflyRecoveryConfig.rawProtectionReduction,
      },
      uResidualBlend: { value: config.residualBlend },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
      uTransparencyInteriorProtection: {
        value: config.transparencyInteriorProtection,
      },
      uTransparencyProtection: { value: config.transparencyProtection },
    },
    vertexShader: fullScreenVertexShader,
  })

  quadScene.add(quad)

  let targetWidth = 1
  let targetHeight = 1
  let hasPipelineError = false
  const guideMaterials = new Map<THREE.Material, GuideMaterialPair>()
  const guideAlbedoTarget = createGuideTarget(targetWidth, targetHeight, 'albedo')
  const guideGeometryTarget = createGuideTarget(targetWidth, targetHeight, 'geometry')
  const guideMaterialTarget = createGuideTarget(targetWidth, targetHeight, 'material')
  const diffuseTargetA = createColorTarget(targetWidth, targetHeight, 'diffuse-a')
  const diffuseTargetB = createColorTarget(targetWidth, targetHeight, 'diffuse-b')
  const fireflyConfidenceTarget = createConfidenceTarget(
    targetWidth,
    targetHeight,
    'emissive-firefly-confidence',
  )
  const fireflyTarget = createColorTarget(targetWidth, targetHeight, 'firefly')
  const pingTargetA = createColorTarget(targetWidth, targetHeight, 'ping-a')
  const pingTargetB = createColorTarget(targetWidth, targetHeight, 'ping-b')
  const compositeTarget = createColorTarget(targetWidth, targetHeight, 'composite')

  function disposeTargets() {
    guideAlbedoTarget.dispose()
    guideGeometryTarget.dispose()
    guideMaterialTarget.dispose()
    diffuseTargetA.dispose()
    diffuseTargetB.dispose()
    fireflyConfidenceTarget.dispose()
    fireflyTarget.dispose()
    pingTargetA.dispose()
    pingTargetB.dispose()
    compositeTarget.dispose()
  }

  function disposeGuideMaterials() {
    for (const pair of guideMaterials.values()) {
      pair.albedo.dispose()
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
    guideAlbedoTarget.setSize(targetWidth, targetHeight)
    guideGeometryTarget.setSize(targetWidth, targetHeight)
    guideMaterialTarget.setSize(targetWidth, targetHeight)
    diffuseTargetA.setSize(targetWidth, targetHeight)
    diffuseTargetB.setSize(targetWidth, targetHeight)
    fireflyConfidenceTarget.setSize(targetWidth, targetHeight)
    fireflyTarget.setSize(targetWidth, targetHeight)
    pingTargetA.setSize(targetWidth, targetHeight)
    pingTargetB.setSize(targetWidth, targetHeight)
    compositeTarget.setSize(targetWidth, targetHeight)
    fireflyConfidenceMaterial.uniforms.uTexelSize.value.set(
      1 / targetWidth,
      1 / targetHeight,
    )
    fireflyMaterial.uniforms.uTexelSize.value.set(1 / targetWidth, 1 / targetHeight)
    atrousMaterial.uniforms.uTexelSize.value.set(1 / targetWidth, 1 / targetHeight)
    diffuseMaterial.uniforms.uTexelSize.value.set(1 / targetWidth, 1 / targetHeight)
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
    fireflyConfidenceMaterial.dispose()
    atrousMaterial.dispose()
    diffuseMaterial.dispose()
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

      renderGuidePass(renderer, scene, camera, guideAlbedoTarget, 'albedo')

      if (didWebGlPassFail(renderer)) {
        hasPipelineError = true
        return createDenoiseErrorResult(inputTexture)
      }

      const fireflyRecoveryStrength =
        getPathTracingDenoiseEmissiveFireflyRecoveryStrength(
          scene,
          fireflyRecoveryConfig,
        )

      fireflyConfidenceMaterial.uniforms.tGuideAlbedo.value =
        guideAlbedoTarget.texture
      fireflyConfidenceMaterial.uniforms.tGuideGeometry.value =
        guideGeometryTarget.texture
      fireflyConfidenceMaterial.uniforms.tGuideMaterial.value =
        guideMaterialTarget.texture
      fireflyConfidenceMaterial.uniforms.tInput.value = inputTexture
      fireflyConfidenceMaterial.uniforms.uRecoveryStrength.value =
        fireflyRecoveryStrength
      renderFullscreenPass(
        renderer,
        fireflyConfidenceMaterial,
        fireflyConfidenceTarget,
      )

      if (didWebGlPassFail(renderer)) {
        hasPipelineError = true
        return createDenoiseErrorResult(inputTexture)
      }

      fireflyMaterial.uniforms.tFireflyConfidence.value =
        fireflyConfidenceTarget.texture
      fireflyMaterial.uniforms.tGuideMaterial.value = guideMaterialTarget.texture
      fireflyMaterial.uniforms.tInput.value = inputTexture
      renderFullscreenPass(renderer, fireflyMaterial, fireflyTarget)

      if (didWebGlPassFail(renderer)) {
        hasPipelineError = true
        return createDenoiseErrorResult(inputTexture)
      }

      let diffuseReadTexture = fireflyTarget.texture
      let diffuseWriteTarget = diffuseTargetA

      diffuseMaterial.uniforms.tGuideAlbedo.value = guideAlbedoTarget.texture
      diffuseMaterial.uniforms.tGuideGeometry.value = guideGeometryTarget.texture
      diffuseMaterial.uniforms.tGuideMaterial.value = guideMaterialTarget.texture
      diffuseMaterial.uniforms.tFireflyConfidence.value =
        fireflyConfidenceTarget.texture

      for (const stepWidth of getPathTracingDenoiseDiffuseStepWidths(
        config.atrousPasses,
      )) {
        diffuseMaterial.uniforms.tInput.value = diffuseReadTexture
        diffuseMaterial.uniforms.uStepWidth.value = stepWidth
        renderFullscreenPass(renderer, diffuseMaterial, diffuseWriteTarget)

        if (didWebGlPassFail(renderer)) {
          hasPipelineError = true
          return createDenoiseErrorResult(inputTexture)
        }

        diffuseReadTexture = diffuseWriteTarget.texture
        diffuseWriteTarget =
          diffuseWriteTarget === diffuseTargetA ? diffuseTargetB : diffuseTargetA
      }

      atrousMaterial.uniforms.tGuideAlbedo.value = guideAlbedoTarget.texture
      atrousMaterial.uniforms.tGuideGeometry.value = guideGeometryTarget.texture
      atrousMaterial.uniforms.tGuideMaterial.value = guideMaterialTarget.texture
      atrousMaterial.uniforms.tFireflyConfidence.value =
        fireflyConfidenceTarget.texture

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

      finalCompositeMaterial.uniforms.tDiffuse.value = diffuseReadTexture
      finalCompositeMaterial.uniforms.tFireflyConfidence.value =
        fireflyConfidenceTarget.texture
      finalCompositeMaterial.uniforms.tFiltered.value = readTexture
      finalCompositeMaterial.uniforms.tFirefly.value = fireflyTarget.texture
      finalCompositeMaterial.uniforms.tGuideAlbedo.value = guideAlbedoTarget.texture
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
      pair.albedo.uniforms.uCameraFar.value = camera.far
      pair.geometry.uniforms.uCameraFar.value = camera.far
      pair.material.uniforms.uCameraFar.value = camera.far
    }

    atrousMaterial.uniforms.uDepthPhi.value = normalizedDepthPhi
    diffuseMaterial.uniforms.uDepthPhi.value = normalizedDepthPhi
    fireflyConfidenceMaterial.uniforms.uDepthPhi.value = normalizedDepthPhi
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
      } else if (mode === 'albedo') {
        renderer.setClearColor(0xffffff, 1)
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

    if (mode === 'geometry') {
      return pair.geometry
    }

    return mode === 'albedo' ? pair.albedo : pair.material
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

export function getPathTracingDenoiseDiffuseStepWidths(passCount: number) {
  return getPathTracingDenoiseStepWidths(passCount + 1)
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
  const albedoMaterial = new THREE.ShaderMaterial({
    depthTest: source.depthTest,
    depthWrite: true,
    fragmentShader: guideAlbedoFragmentShader,
    name: 'Manifest3D path tracing denoise albedo guide material',
    side: source.side,
    transparent: false,
    uniforms: THREE.UniformsUtils.clone({
      ...commonUniforms,
      tMetalnessMap: { value: source.metalnessMap ?? null },
      uBaseColor: { value: getDenoiseGuideBaseColor(source) },
      uMetalness: { value: source.metalness ?? 0 },
      uUsesMetalnessMap: { value: source.metalnessMap ? 1 : 0 },
    }),
    vertexShader: guideVertexShader,
    visible: source.visible,
  })

  albedoMaterial.onBeforeRender = (_renderer, _scene, camera) => {
    albedoMaterial.uniforms.uCameraFar.value = getCameraFar(camera)
  }
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
    albedo: albedoMaterial,
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

function getDenoiseGuideBaseColor(source: MaterialWithDenoiseGuideFields) {
  return source.color?.clone() ?? new THREE.Color(1, 1, 1)
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

function createConfidenceTarget(width: number, height: number, label: string) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false,
    format: THREE.RGBAFormat,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
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
