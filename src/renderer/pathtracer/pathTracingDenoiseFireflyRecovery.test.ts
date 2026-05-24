import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { pathTracingViewportConfig } from './pathTracingConfig'
import {
  getPathTracingDenoiseEmissiveFireflyRecoveryStrength,
  getPathTracingDenoiseEmissiveFireflySceneMetrics,
} from './pathTracingDenoiseFireflyRecovery'

const recoveryConfig =
  pathTracingViewportConfig.denoise.emissiveFireflyRecovery

describe('path tracing emissive firefly recovery risk', () => {
  it('arms for a compact bright emissive surface over a dark rough diffuse receiver', () => {
    const scene = createFireflyRiskScene({
      emissiveIntensity: 24,
      receiverMaterial: new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.025, 0.025, 0.025),
        metalness: 0,
        roughness: 0.92,
      }),
    })

    expect(
      getPathTracingDenoiseEmissiveFireflyRecoveryStrength(scene),
    ).toBeGreaterThan(0.75)
  })

  it('does not arm for weak decorative emission', () => {
    const scene = createFireflyRiskScene({
      emissiveIntensity: 0.35,
      receiverMaterial: new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.025, 0.025, 0.025),
        metalness: 0,
        roughness: 0.92,
      }),
    })

    expect(getPathTracingDenoiseEmissiveFireflyRecoveryStrength(scene)).toBe(0)
  })

  it('requires a rough dielectric receiver surface', () => {
    const scene = createFireflyRiskScene({
      emissiveIntensity: 24,
      receiverMaterial: new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.025, 0.025, 0.025),
        metalness: 0.85,
        roughness: 0.18,
      }),
    })

    const metrics = getPathTracingDenoiseEmissiveFireflySceneMetrics(scene)

    expect(metrics.roughDiffuseReceiverArea).toBe(0)
    expect(getPathTracingDenoiseEmissiveFireflyRecoveryStrength(scene)).toBe(0)
  })

  it('can be disabled internally without disabling the whole denoiser', () => {
    const scene = createFireflyRiskScene({
      emissiveIntensity: 24,
      receiverMaterial: new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.025, 0.025, 0.025),
        metalness: 0,
        roughness: 0.92,
      }),
    })

    expect(
      getPathTracingDenoiseEmissiveFireflyRecoveryStrength(scene, {
        ...recoveryConfig,
        enabled: false,
      }),
    ).toBe(0)
  })
})

function createFireflyRiskScene({
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
    new THREE.SphereGeometry(0.08, 8, 8),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(1, 1, 1),
      emissive: new THREE.Color(1, 1, 1),
      emissiveIntensity,
      metalness: 0,
      roughness: 0.2,
    }),
  )

  emitter.position.set(0, 0.2, 0)
  scene.add(receiver, emitter)

  return scene
}
