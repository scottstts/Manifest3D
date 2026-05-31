import * as THREE from 'three/webgpu'
import type { BuiltManifestAsset } from './assetBuilder'
import { findOverlappingVisualRelations } from './relationMetrics'

export type GeometryOverlapFinding = {
  depth: THREE.Vector3
  partAId: string
  partBId: string
  visualAId: string
  visualBId: string
  volume: number
}

export function findCurrentPoseVisualOverlaps(
  builtAsset: BuiltManifestAsset,
  options: {
    overlapTolerance: number
    volumeTolerance: number
  },
): GeometryOverlapFinding[] {
  return findOverlappingVisualRelations(builtAsset, options).map((relation) => ({
    depth: relation.overlapDepth,
    partAId: relation.partAId,
    partBId: relation.partBId,
    visualAId: relation.visualAId,
    visualBId: relation.visualBId,
    volume: relation.overlapVolume,
  }))
}
