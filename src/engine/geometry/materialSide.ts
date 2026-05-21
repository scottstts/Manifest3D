import * as THREE from 'three/webgpu'
import type { ManifestMaterialSide } from '../schema/manifestTypes'

export const defaultManifestMaterialSide: ManifestMaterialSide = 'front'

export function normalizeManifestMaterialSide(
  side: ManifestMaterialSide | undefined,
): ManifestMaterialSide {
  return side ?? defaultManifestMaterialSide
}

export function toThreeMaterialSide(
  side: ManifestMaterialSide | undefined,
): THREE.Side {
  const normalizedSide = normalizeManifestMaterialSide(side)

  switch (normalizedSide) {
    case 'front':
      return THREE.FrontSide
    case 'back':
      return THREE.BackSide
    case 'double':
      return THREE.DoubleSide
    default:
      return assertNever(normalizedSide)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Manifest3D material side: ${value}`)
}
