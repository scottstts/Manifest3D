import * as THREE from 'three/webgpu'
import type { BuiltManifestAsset } from './assetBuilder'
import {
  boxesOverlap,
  getOverlapDepth,
  getPositiveOverlapVolume,
} from './measurements'

export type GeometryOverlapFinding = {
  partAId: string
  partBId: string
  visualAId: string
  visualBId: string
  depth: THREE.Vector3
  volume: number
}

export function findCurrentPoseVisualOverlaps(
  builtAsset: BuiltManifestAsset,
  options: {
    overlapTolerance: number
    volumeTolerance: number
  },
): GeometryOverlapFinding[] {
  const entries = [...builtAsset.visualBounds.entries()]
  const findings: GeometryOverlapFinding[] = []

  for (let indexA = 0; indexA < entries.length; indexA += 1) {
    const [visualAId, boundsA] = entries[indexA]
    const partAId = builtAsset.visualPartIds.get(visualAId)

    if (!partAId) {
      continue
    }

    for (let indexB = indexA + 1; indexB < entries.length; indexB += 1) {
      const [visualBId, boundsB] = entries[indexB]
      const partBId = builtAsset.visualPartIds.get(visualBId)

      if (!partBId || partAId === partBId) {
        continue
      }

      if (!boxesOverlap(boundsA, boundsB, options.overlapTolerance)) {
        continue
      }

      const volume = getPositiveOverlapVolume(boundsA, boundsB)

      if (volume <= options.volumeTolerance) {
        continue
      }

      findings.push({
        depth: getOverlapDepth(boundsA, boundsB),
        partAId,
        partBId,
        visualAId,
        visualBId,
        volume,
      })
    }
  }

  return findings
}
