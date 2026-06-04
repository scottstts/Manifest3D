import * as THREE from 'three/webgpu'
import type { BuiltManifestAsset } from '../geometry/assetBuilder'
import { getBoundsSize, isFiniteBounds } from '../geometry/bounds'
import {
  boxesOverlap,
  boxesTouchOrOverlap,
  pointToBoxDistance,
} from '../geometry/measurements'
import { findCurrentPoseVisualOverlaps } from '../geometry/overlapChecks'
import {
  createVisualRelationProxies,
  findClosestVisualRelation,
  type VisualRelationProxy,
} from '../geometry/relationMetrics'
import {
  createMeshRelationIndex,
  type MeshRelationIndex,
} from '../geometry/meshRelations'
import type { ManifestAsset } from '../schema/manifestTypes'
import type { ValidationSignal } from '../schema/validationTypes'
import {
  formatBoundedOverlapProofDetails,
  getBoundedOverlapProofCheck,
} from './overlapProofChecks'
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
const minMovableJointFitToleranceMeters = 0.02
const maxMovableJointFitToleranceMeters = 0.08
const movableJointFitAssetSpanScale = 0.015

export function runBaselineQc(
  asset: ManifestAsset,
  builtAsset: BuiltManifestAsset,
): ValidationSignal[] {
  const meshRelationIndex = createMeshRelationIndex(builtAsset)
  const relationProxies = createVisualRelationProxies(builtAsset)

  try {
    return [
      ...validateBuiltBounds(asset, builtAsset),
      ...validateMeshReadiness(builtAsset),
      ...validateDisconnectedGeometryIslands(
        asset,
        builtAsset,
        meshRelationIndex,
      ),
      ...validateFloatingParts(
        asset,
        builtAsset,
        meshRelationIndex,
      ),
      ...validateCurrentPoseOverlaps(
        asset,
        builtAsset,
        meshRelationIndex,
        relationProxies,
      ),
      ...validateJointOrigins(asset, builtAsset),
      ...validateMovableJointFits(
        asset,
        builtAsset,
        meshRelationIndex,
        relationProxies,
      ),
      ...validateAllowanceNotes(asset),
    ]
  } finally {
    meshRelationIndex.dispose()
  }
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
  meshRelationIndex: MeshRelationIndex,
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
      meshRelationIndex,
    )

    if (connectedVisualIds.size === visualIds.length) {
      continue
    }

    const disconnectedVisualIds = visualIds.filter(
      (visualId) => !connectedVisualIds.has(visualId),
    )
    const criticalRole = isMechanicallyCriticalPartRole(part.role)

    signals.push(
      createValidationSignal(
        'disconnected_geometry_island',
        'part_disconnected_geometry_islands',
        `Part "${part.id}" contains disconnected visual islands: ${disconnectedVisualIds.join(', ')}.`,
        {
          details: criticalRole
            ? 'Mechanism, support, wheel, hinge, control, and fastener parts must read as physically continuous or use separate fixed child parts for separately mounted pieces.'
            : undefined,
          refs: { partId: part.id },
          ...(criticalRole ? {} : { severity: 'warning' as const }),
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
  meshRelationIndex: MeshRelationIndex,
) {
  const childPartIds = new Set(asset.joints.map((joint) => joint.childPartId))
  const rootPart = asset.parts.find((part) => !childPartIds.has(part.id))

  if (!rootPart) {
    return []
  }

  const reachablePartIds = collectPhysicallyReachableParts(
    asset,
    rootPart.id,
    asset.parts.map((part) => part.id),
    builtAsset,
    supportContactToleranceMeters,
    meshRelationIndex,
  )
  const allowedPartIds = getAllowedIsolatedPartIds(asset.allowances)
  const signals: ValidationSignal[] = []

  for (const part of asset.parts) {
    if (reachablePartIds.has(part.id)) {
      continue
    }

    if (allowedPartIds.has(part.id) && canAllowIsolatedPart(part.role)) {
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

    if (allowedPartIds.has(part.id)) {
      signals.push(
        createValidationSignal(
          'isolated_part',
          'isolated_part_allowance_rejected',
          `Part "${part.id}" is physically isolated, and its role "${part.role ?? 'unspecified'}" should not use an isolation allowance.`,
          {
            details:
              'Mechanical, support, wheel, hinge, control, housing, handle, base, and unspecified parts need a visible support path through contact, a fixed mount, or connectorTube endpoints.',
            refs: { partId: part.id },
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
  meshRelationIndex: MeshRelationIndex,
  relationProxies: readonly VisualRelationProxy[],
) {
  const signals: ValidationSignal[] = []
  const currentPoseChecks = asset.checks.filter((check) => !check.pose)
  const findings = findCurrentPoseVisualOverlaps(builtAsset, {
    meshRelationIndex,
    overlapTolerance: overlapToleranceMeters,
    proxies: relationProxies,
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

    const proof = getBoundedOverlapProofCheck(finding, currentPoseChecks)

    if (proof) {
      signals.push(
        createValidationSignal(
          'real_overlap',
          'part_overlap_proven_fit',
          `Overlap between "${finding.partAId}" and "${finding.partBId}" is covered by a bounded authored fit check.`,
          {
            details: [
              formatOverlapDetails(finding.depth, finding.volume),
              formatBoundedOverlapProofDetails(proof),
            ].join(' '),
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

function validateMovableJointFits(
  asset: ManifestAsset,
  builtAsset: BuiltManifestAsset,
  meshRelationIndex: MeshRelationIndex,
  relationProxies: readonly VisualRelationProxy[],
) {
  const signals: ValidationSignal[] = []
  const tolerance = getMovableJointFitTolerance(builtAsset.bounds)

  for (const joint of asset.joints) {
    if (joint.type === 'fixed') {
      continue
    }

    if (
      partsHaveSupportContact(
        builtAsset,
        joint.parentPartId,
        joint.childPartId,
        tolerance,
        meshRelationIndex,
      )
    ) {
      continue
    }

    const relation = findClosestVisualRelation(builtAsset, {
      partAId: joint.parentPartId,
      partBId: joint.childPartId,
    }, {
      meshRelationIndex,
      proxies: relationProxies,
    })

    if (relation && relation.distance <= tolerance) {
      continue
    }

    signals.push(
      createValidationSignal(
        'mechanical_fit',
        'movable_joint_missing_close_fit',
        `Movable joint "${joint.id}" does not have a close visible mechanical fit between parent and child parts.`,
        {
          details: relation
            ? `closestDistance=${relation.distance.toFixed(4)} tolerance=${tolerance.toFixed(4)} closestVisualPair=${relation.visualAId}<->${relation.visualBId}`
            : `No visual relation was measurable. tolerance=${tolerance.toFixed(4)}`,
          refs: {
            childPartId: joint.childPartId,
            jointId: joint.id,
            parentPartId: joint.parentPartId,
          },
          source: 'baseline_qc',
          stage: 'baseline_qc',
        },
      ),
    )
  }

  return signals
}

function getMovableJointFitTolerance(bounds: THREE.Box3) {
  const size = getBoundsSize(bounds)
  const maxSpan = Math.max(size.x, size.y, size.z)

  if (!Number.isFinite(maxSpan) || maxSpan <= 0) {
    return minMovableJointFitToleranceMeters
  }

  return Math.min(
    maxMovableJointFitToleranceMeters,
    Math.max(
      minMovableJointFitToleranceMeters,
      maxSpan * movableJointFitAssetSpanScale,
    ),
  )
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
      parentDistance <= jointOriginWarningDistanceMeters &&
      childDistance <= jointOriginWarningDistanceMeters
    ) {
      continue
    }

    const distantSides = [
      parentDistance > jointOriginWarningDistanceMeters ? 'parent' : null,
      childDistance > jointOriginWarningDistanceMeters ? 'child' : null,
    ].filter((side): side is string => Boolean(side))

    signals.push(
      createValidationSignal(
        'joint_origin_distance',
        'joint_origin_far_from_geometry',
        `Joint "${joint.id}" origin is far from ${formatDistantSides(distantSides)} geometry.`,
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

function formatDistantSides(sides: readonly string[]) {
  if (sides.length === 1) {
    return sides[0]
  }

  return sides.join(' and ')
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
  meshRelationIndex: MeshRelationIndex,
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

      if (
        candidateBounds &&
        visualsHaveSupportContact(
          visualId,
          candidateVisualId,
          bounds,
          candidateBounds,
          tolerance,
          meshRelationIndex,
        )
      ) {
        pending.push(candidateVisualId)
      }
    }
  }

  return visited
}

function visualsHaveSupportContact(
  visualAId: string,
  visualBId: string,
  boundsA: THREE.Box3,
  boundsB: THREE.Box3,
  tolerance: number,
  meshRelationIndex: MeshRelationIndex,
) {
  if (!boxesTouchOrOverlap(boundsA, boundsB, tolerance)) {
    return false
  }

  if (!boxesOverlap(boundsA, boundsB, 0)) {
    return true
  }

  const meshRelation = meshRelationIndex.getRelation(visualAId, visualBId, {
    includeDistance: false,
  })

  return meshRelation
    ? meshRelation.intersects
    : true
}

function collectPhysicallyReachableParts(
  asset: ManifestAsset,
  rootPartId: string,
  partIds: readonly string[],
  builtAsset: BuiltManifestAsset,
  tolerance: number,
  meshRelationIndex: MeshRelationIndex,
) {
  const pending = [rootPartId]
  const visited = new Set<string>()
  const connectorAdjacency = createConnectorSupportAdjacency(asset)

  while (pending.length > 0) {
    const partId = pending.pop()

    if (!partId || visited.has(partId)) {
      continue
    }

    visited.add(partId)

    for (const candidatePartId of partIds) {
      if (visited.has(candidatePartId)) {
        continue
      }

      if (
        connectorAdjacency.get(partId)?.has(candidatePartId) ||
        partsHaveSupportContact(
          builtAsset,
          partId,
          candidatePartId,
          tolerance,
          meshRelationIndex,
        )
      ) {
        pending.push(candidatePartId)
      }
    }
  }

  return visited
}

function partsHaveSupportContact(
  builtAsset: BuiltManifestAsset,
  partAId: string,
  partBId: string,
  tolerance: number,
  meshRelationIndex: MeshRelationIndex,
) {
  const partBoundsA = builtAsset.partBounds.get(partAId)
  const partBoundsB = builtAsset.partBounds.get(partBId)

  if (
    !partBoundsA ||
    !partBoundsB ||
    !boxesTouchOrOverlap(partBoundsA, partBoundsB, tolerance)
  ) {
    return false
  }

  for (const [visualAId, boundsA] of builtAsset.visualBounds.entries()) {
    if (builtAsset.visualPartIds.get(visualAId) !== partAId) {
      continue
    }

    for (const [visualBId, boundsB] of builtAsset.visualBounds.entries()) {
      if (
        builtAsset.visualPartIds.get(visualBId) !== partBId ||
        !boxesTouchOrOverlap(boundsA, boundsB, tolerance)
      ) {
        continue
      }

      if (!boxesOverlap(boundsA, boundsB, 0)) {
        return true
      }

      const meshRelation = meshRelationIndex.getRelation(visualAId, visualBId, {
        includeDistance: false,
      })

      if (!meshRelation || meshRelation.intersects) {
        return true
      }
    }
  }

  return false
}

function createConnectorSupportAdjacency(asset: ManifestAsset) {
  const adjacency = new Map<string, Set<string>>()

  function connect(left: string, right: string) {
    if (left === right) {
      return
    }

    const leftSet = adjacency.get(left) ?? new Set<string>()
    const rightSet = adjacency.get(right) ?? new Set<string>()

    leftSet.add(right)
    rightSet.add(left)
    adjacency.set(left, leftSet)
    adjacency.set(right, rightSet)
  }

  for (const part of asset.parts) {
    for (const visual of part.visuals) {
      if (visual.geometry.type !== 'connectorTube') {
        continue
      }

      connect(part.id, visual.geometry.start.partId)
      connect(part.id, visual.geometry.end.partId)
      connect(visual.geometry.start.partId, visual.geometry.end.partId)
    }
  }

  return adjacency
}

function canAllowIsolatedPart(role: ManifestAsset['parts'][number]['role']) {
  return role === 'decor'
}

function isMechanicallyCriticalPartRole(
  role: ManifestAsset['parts'][number]['role'],
) {
  return (
    role === 'mechanism' ||
    role === 'support' ||
    role === 'wheel' ||
    role === 'hinge' ||
    role === 'control' ||
    role === 'fastener'
  )
}

function formatOverlapDetails(depth: THREE.Vector3, volume: number) {
  return `depth=(${depth.x.toFixed(4)}, ${depth.y.toFixed(4)}, ${depth.z.toFixed(4)}) volume=${volume.toExponential(3)}`
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true
}
