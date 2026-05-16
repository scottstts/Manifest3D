import * as THREE from 'three/webgpu'
import type { BuiltManifestAsset } from '../geometry/assetBuilder'
import { getBoundsSize, isFiniteBounds } from '../geometry/bounds'
import {
  boxesTouchOrOverlap,
  pointToBoxDistance,
} from '../geometry/measurements'
import { findCurrentPoseVisualOverlaps } from '../geometry/overlapChecks'
import type { ManifestAsset } from '../schema/manifestTypes'
import type { ValidationSignal } from '../schema/validationTypes'
import { createValidationSignal } from './reportBuilder'
import {
  getAllowanceKey,
  getAllowedIsolatedPartIds,
  isOverlapAllowed,
} from './runAllowances'

const minDimensionMeters = 0.001
const minAssetSpanMeters = 0.02
const maxAssetSpanMeters = 20
const supportContactToleranceMeters = 0.015
const overlapToleranceMeters = 0.001
const overlapVolumeToleranceCubicMeters = 1e-8
const jointOriginWarningDistanceMeters = 0.25

export function runBaselineQc(
  asset: ManifestAsset,
  builtAsset: BuiltManifestAsset,
): ValidationSignal[] {
  return [
    ...validateBuiltBounds(asset, builtAsset),
    ...validateMeshReadiness(builtAsset),
    ...validateDisconnectedGeometryIslands(asset, builtAsset),
    ...validateFloatingParts(asset, builtAsset),
    ...validateCurrentPoseOverlaps(asset, builtAsset),
    ...validateJointOrigins(asset, builtAsset),
    ...validateAllowanceNotes(asset),
  ]
}

function validateBuiltBounds(
  asset: ManifestAsset,
  builtAsset: BuiltManifestAsset,
) {
  const signals: ValidationSignal[] = []

  signals.push(
    ...validateBounds(
      builtAsset.bounds,
      'asset',
      `Asset "${asset.id}"`,
      { assetId: asset.id },
    ),
  )

  for (const part of asset.parts) {
    const bounds = builtAsset.partBounds.get(part.id)

    if (!bounds) {
      signals.push(
        createValidationSignal(
          'mesh_assets',
          'part_bounds_missing',
          `Part "${part.id}" has no computed bounds.`,
          {
            refs: { partId: part.id },
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
      )
      continue
    }

    signals.push(
      ...validateBounds(bounds, 'part', `Part "${part.id}"`, {
        partId: part.id,
      }),
    )
  }

  return signals
}

function validateBounds(
  bounds: THREE.Box3,
  target: 'asset' | 'part',
  targetLabel: string,
  refs: Record<string, string>,
) {
  const signals: ValidationSignal[] = []

  if (bounds.isEmpty() || !isFiniteBounds(bounds)) {
    signals.push(
      createValidationSignal(
        'mesh_assets',
        `${target}_bounds_empty`,
        `${targetLabel} has empty or non-finite bounds.`,
        {
          refs,
          source: 'baseline_qc',
          stage: 'baseline_qc',
        },
      ),
    )
    return signals
  }

  const size = getBoundsSize(bounds)
  const maxSpan = Math.max(size.x, size.y, size.z)

  if (size.x <= minDimensionMeters || size.y <= minDimensionMeters || size.z <= minDimensionMeters) {
    signals.push(
      createValidationSignal(
        'mesh_assets',
        `${target}_bounds_flat`,
        `${targetLabel} has a near-zero bounding-box dimension.`,
        {
          refs,
          source: 'baseline_qc',
          stage: 'baseline_qc',
        },
      ),
    )
  }

  if (target === 'asset' && maxSpan < minAssetSpanMeters) {
    signals.push(
      createValidationSignal(
        'mesh_assets',
        'asset_too_tiny',
        `${targetLabel} is smaller than ${minAssetSpanMeters} meters across.`,
        {
          refs,
          source: 'baseline_qc',
          stage: 'baseline_qc',
        },
      ),
    )
  }

  if (target === 'asset' && maxSpan > maxAssetSpanMeters) {
    signals.push(
      createValidationSignal(
        'mesh_assets',
        'asset_too_large',
        `${targetLabel} is larger than ${maxAssetSpanMeters} meters across.`,
        {
          refs,
          severity: 'warning',
          source: 'baseline_qc',
          stage: 'baseline_qc',
        },
      ),
    )
  }

  return signals
}

function validateMeshReadiness(builtAsset: BuiltManifestAsset) {
  const signals: ValidationSignal[] = []
  let meshCount = 0

  builtAsset.group.traverse((object) => {
    if (!isMesh(object)) {
      return
    }

    meshCount += 1

    if (!object.geometry.getAttribute('position')) {
      signals.push(
        createValidationSignal(
          'mesh_assets',
          'export_mesh_missing_positions',
          `Mesh "${object.name}" cannot be exported because it has no position attribute.`,
          {
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
      )
    }
  })

  if (meshCount === 0) {
    signals.push(
      createValidationSignal(
        'mesh_assets',
        'mesh_assets_missing',
        'Built asset contains no mesh geometry.',
        {
          source: 'baseline_qc',
          stage: 'baseline_qc',
        },
      ),
    )
  }

  return signals
}

function validateDisconnectedGeometryIslands(
  asset: ManifestAsset,
  builtAsset: BuiltManifestAsset,
) {
  const signals: ValidationSignal[] = []

  for (const part of asset.parts) {
    if (part.visuals.length <= 1) {
      continue
    }

    const visualIds = part.visuals.map((visual) => visual.id)
    const connectedVisualIds = collectConnectedVisuals(
      visualIds[0],
      visualIds,
      builtAsset,
      supportContactToleranceMeters,
    )

    if (connectedVisualIds.size === visualIds.length) {
      continue
    }

    const disconnectedVisualIds = visualIds.filter(
      (visualId) => !connectedVisualIds.has(visualId),
    )

    signals.push(
      createValidationSignal(
        'disconnected_geometry_island',
        'part_disconnected_geometry_islands',
        `Part "${part.id}" contains disconnected visual islands: ${disconnectedVisualIds.join(', ')}.`,
        {
          refs: { partId: part.id },
          severity: 'warning',
          source: 'baseline_qc',
          stage: 'baseline_qc',
        },
      ),
    )
  }

  return signals
}

function validateFloatingParts(
  asset: ManifestAsset,
  builtAsset: BuiltManifestAsset,
) {
  const childPartIds = new Set(asset.joints.map((joint) => joint.childPartId))
  const rootPart = asset.parts.find((part) => !childPartIds.has(part.id))

  if (!rootPart) {
    return []
  }

  const reachablePartIds = collectPhysicallyReachableParts(
    rootPart.id,
    asset.parts.map((part) => part.id),
    builtAsset,
    supportContactToleranceMeters,
  )
  const allowedPartIds = getAllowedIsolatedPartIds(asset.allowances)
  const signals: ValidationSignal[] = []

  for (const part of asset.parts) {
    if (reachablePartIds.has(part.id)) {
      continue
    }

    if (allowedPartIds.has(part.id)) {
      signals.push(
        createValidationSignal(
          'isolated_part',
          'isolated_part_allowed',
          `Part "${part.id}" is physically isolated but allowed by authored justification.`,
          {
            refs: { partId: part.id },
            severity: 'note',
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
      )
      continue
    }

    signals.push(
      createValidationSignal(
        'isolated_part',
        'part_physically_disconnected',
        `Part "${part.id}" is not physically connected to the rooted body in the current pose.`,
        {
          details: 'The joint tree is structurally connected, but approximate bounds/contact QC found no support path to this part.',
          refs: { partId: part.id },
          source: 'baseline_qc',
          stage: 'baseline_qc',
        },
      ),
    )
  }

  return signals
}

function validateCurrentPoseOverlaps(
  asset: ManifestAsset,
  builtAsset: BuiltManifestAsset,
) {
  const signals: ValidationSignal[] = []
  const findings = findCurrentPoseVisualOverlaps(builtAsset, {
    overlapTolerance: overlapToleranceMeters,
    volumeTolerance: overlapVolumeToleranceCubicMeters,
  })

  for (const finding of findings) {
    if (isOverlapAllowed(finding, asset.allowances)) {
      signals.push(
        createValidationSignal(
          'real_overlap',
          'part_overlap_allowed',
          `Overlap between "${finding.partAId}" and "${finding.partBId}" is covered by an authored allowance.`,
          {
            details: formatOverlapDetails(finding.depth, finding.volume),
            refs: {
              partAId: finding.partAId,
              partBId: finding.partBId,
              visualAId: finding.visualAId,
              visualBId: finding.visualBId,
            },
            severity: 'note',
            source: 'baseline_qc',
            stage: 'baseline_qc',
          },
        ),
      )
      continue
    }

    signals.push(
      createValidationSignal(
        'real_overlap',
        'part_overlap_current_pose',
        `Current-pose overlap detected between "${finding.partAId}" and "${finding.partBId}".`,
        {
          details: formatOverlapDetails(finding.depth, finding.volume),
          refs: {
            partAId: finding.partAId,
            partBId: finding.partBId,
            visualAId: finding.visualAId,
            visualBId: finding.visualBId,
          },
          source: 'baseline_qc',
          stage: 'baseline_qc',
        },
      ),
    )
  }

  return signals
}

function validateJointOrigins(
  asset: ManifestAsset,
  builtAsset: BuiltManifestAsset,
) {
  const signals: ValidationSignal[] = []

  for (const joint of asset.joints) {
    const jointGroup = builtAsset.jointGroups.get(joint.id)
    const parentBounds = builtAsset.partBounds.get(joint.parentPartId)
    const childBounds = builtAsset.partBounds.get(joint.childPartId)

    if (!jointGroup || !parentBounds || !childBounds) {
      continue
    }

    const jointOrigin = new THREE.Vector3()

    jointGroup.getWorldPosition(jointOrigin)

    const parentDistance = pointToBoxDistance(jointOrigin, parentBounds)
    const childDistance = pointToBoxDistance(jointOrigin, childBounds)

    if (
      parentDistance <= jointOriginWarningDistanceMeters ||
      childDistance <= jointOriginWarningDistanceMeters
    ) {
      continue
    }

    signals.push(
      createValidationSignal(
        'joint_origin_distance',
        'joint_origin_far_from_geometry',
        `Joint "${joint.id}" origin is far from both parent and child geometry.`,
        {
          details: `parentDistance=${parentDistance.toFixed(4)} childDistance=${childDistance.toFixed(4)} tolerance=${jointOriginWarningDistanceMeters}`,
          refs: {
            childPartId: joint.childPartId,
            jointId: joint.id,
            parentPartId: joint.parentPartId,
          },
          severity: 'warning',
          source: 'baseline_qc',
          stage: 'baseline_qc',
        },
      ),
    )
  }

  return signals
}

function validateAllowanceNotes(asset: ManifestAsset) {
  return asset.allowances.map((allowance) =>
    createValidationSignal(
      'allowance',
      'allowance_declared',
      `Allowance declared: ${allowance.type}.`,
      {
        dedupeKey: getAllowanceKey(allowance),
        details: allowance.reason,
        refs:
          allowance.type === 'allow_overlap'
            ? {
                partAId: allowance.partAId,
                partBId: allowance.partBId,
                ...(allowance.visualAId ? { visualAId: allowance.visualAId } : {}),
                ...(allowance.visualBId ? { visualBId: allowance.visualBId } : {}),
              }
            : { partId: allowance.partId },
        severity: 'note',
        source: 'baseline_qc',
        stage: 'baseline_qc',
      },
    ),
  )
}

function collectConnectedVisuals(
  rootVisualId: string,
  visualIds: readonly string[],
  builtAsset: BuiltManifestAsset,
  tolerance: number,
) {
  const pending = [rootVisualId]
  const visited = new Set<string>()
  const visualIdSet = new Set(visualIds)

  while (pending.length > 0) {
    const visualId = pending.pop()

    if (!visualId || visited.has(visualId)) {
      continue
    }

    visited.add(visualId)

    const bounds = builtAsset.visualBounds.get(visualId)

    if (!bounds) {
      continue
    }

    for (const candidateVisualId of visualIds) {
      if (
        !visualIdSet.has(candidateVisualId) ||
        visited.has(candidateVisualId)
      ) {
        continue
      }

      const candidateBounds = builtAsset.visualBounds.get(candidateVisualId)

      if (candidateBounds && boxesTouchOrOverlap(bounds, candidateBounds, tolerance)) {
        pending.push(candidateVisualId)
      }
    }
  }

  return visited
}

function collectPhysicallyReachableParts(
  rootPartId: string,
  partIds: readonly string[],
  builtAsset: BuiltManifestAsset,
  tolerance: number,
) {
  const pending = [rootPartId]
  const visited = new Set<string>()

  while (pending.length > 0) {
    const partId = pending.pop()

    if (!partId || visited.has(partId)) {
      continue
    }

    visited.add(partId)

    const bounds = builtAsset.partBounds.get(partId)

    if (!bounds) {
      continue
    }

    for (const candidatePartId of partIds) {
      if (visited.has(candidatePartId)) {
        continue
      }

      const candidateBounds = builtAsset.partBounds.get(candidatePartId)

      if (candidateBounds && boxesTouchOrOverlap(bounds, candidateBounds, tolerance)) {
        pending.push(candidatePartId)
      }
    }
  }

  return visited
}

function formatOverlapDetails(depth: THREE.Vector3, volume: number) {
  return `depth=(${depth.x.toFixed(4)}, ${depth.y.toFixed(4)}, ${depth.z.toFixed(4)}) volume=${volume.toExponential(3)}`
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true
}
