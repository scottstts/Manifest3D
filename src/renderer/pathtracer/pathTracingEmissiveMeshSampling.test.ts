import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { pathTracingViewportConfig } from './pathTracingConfig'
import {
  buildPathTracingEmissiveMeshSampleSet,
  patchPathTracingEmissiveMeshSamplingShader,
} from './pathTracingEmissiveMeshSampling'

const samplingConfig = pathTracingViewportConfig.emissiveMeshSampling

describe('path tracing emissive mesh sampling', () => {
  it('builds a sampleable emitter table for compact bright emission over a dark rough receiver', () => {
    const scene = createSamplingRiskScene({
      emissiveIntensity: 24,
      receiverMaterial: new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.025, 0.025, 0.025),
        metalness: 0,
        roughness: 0.92,
      }),
    })
    const sampleSet = buildPathTracingEmissiveMeshSampleSet(scene)

    expect(sampleSet.samplingStrength).toBeGreaterThan(0.75)
    expect(sampleSet.triangles.length).toBeGreaterThan(0)
    expect(sampleSet.metrics.maxEmissiveLuminance).toBeCloseTo(24)
  })

  it('does not arm for weak decorative emission', () => {
    const scene = createSamplingRiskScene({
      emissiveIntensity: 0.35,
      receiverMaterial: new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.025, 0.025, 0.025),
        metalness: 0,
        roughness: 0.92,
      }),
    })
    const sampleSet = buildPathTracingEmissiveMeshSampleSet(scene)

    expect(sampleSet.samplingStrength).toBe(0)
    expect(sampleSet.triangles).toHaveLength(0)
  })

  it('requires rough dielectric receiver risk', () => {
    const scene = createSamplingRiskScene({
      emissiveIntensity: 24,
      receiverMaterial: new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.025, 0.025, 0.025),
        metalness: 0.85,
        roughness: 0.18,
      }),
    })
    const sampleSet = buildPathTracingEmissiveMeshSampleSet(scene)

    expect(sampleSet.metrics.roughDiffuseReceiverArea).toBe(0)
    expect(sampleSet.samplingStrength).toBe(0)
    expect(sampleSet.triangles).toHaveLength(0)
  })

  it('can be disabled without disabling path tracing or denoising', () => {
    const scene = createSamplingRiskScene({
      emissiveIntensity: 24,
      receiverMaterial: new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.025, 0.025, 0.025),
        metalness: 0,
        roughness: 0.92,
      }),
    })
    const sampleSet = buildPathTracingEmissiveMeshSampleSet(scene, {
      ...samplingConfig,
      enabled: false,
    })

    expect(sampleSet.samplingStrength).toBe(0)
    expect(sampleSet.triangles).toHaveLength(0)
  })

  it('patches the upstream path tracing shader at the expected integration points', () => {
    const patched = patchPathTracingEmissiveMeshSamplingShader(shaderPatchFixture)

    expect(patched).not.toContain('uniform sampler2D emissiveMeshTriangles;')
    expect(patched).toContain('emissiveMeshTriangleTexelOffset')
    expect(patched).toContain('texelFetch1D( lights.tex')
    expect(patched).toContain('emissiveMeshDirectContribution')
    expect(patched).toContain('emissiveMeshHitContribution')
    expect(patched).toContain('emissiveMeshPreviousReceiverConfidence')
  })
})

const shaderPatchFixture = `
				uniform LightsInfo lights;

				void main() {
					SurfaceHit surfaceHit;
					ScatterRecord scatterRec;

						gl_FragColor.rgb += directLightContribution( - ray.direction, surf, state, hitPoint );
						gl_FragColor.rgb += ( surf.emission * state.throughputColor );
						ray.direction = scatterRec.direction;
				}
`

function createSamplingRiskScene({
  emissiveIntensity,
  receiverMaterial,
}: {
  emissiveIntensity: number
  receiverMaterial: THREE.MeshStandardMaterial
}) {
  const scene = new THREE.Scene()
  const receiver = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 4),
    receiverMaterial,
  )
  const emitter = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.16),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(1, 1, 1),
      emissive: new THREE.Color(1, 1, 1),
      emissiveIntensity,
      metalness: 0,
      roughness: 0.2,
      side: THREE.FrontSide,
    }),
  )

  emitter.position.set(0, 0.2, 0)
  scene.add(receiver, emitter)

  return scene
}
