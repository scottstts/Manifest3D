export const pathTracingViewportConfig = {
  bloom: {
    radius: 0.3,
    strength: 0.52,
    threshold: 1.05,
  },
  bounces: 8,
  emissionGain: 1,
  environmentFillIntensity: 0.22,
  filterGlossyFactor: 0.55,
  maxSamples: 100,
  maxTextureSize: 1024,
  minSamples: 1,
  renderDelayMs: 0,
  toneMappingExposure: 1,
  tiles: [1, 1] as const,
}
