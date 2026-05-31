import * as THREE from 'three/webgpu'
import type { BuiltManifestAsset } from '../geometry/assetBuilder'
import {
  axisContains,
  getProjectedGap,
  getProjectedOverlap,
  normalizeAxes,
} from '../geometry/measurements'
import { normalizeManifestMaterialSide } from '../geometry/materialSide'
import {
  findVisualRelations,
  type VisualPairRelation,
} from '../geometry/relationMetrics'
import type { ManifestAsset, ManifestCheck } from '../schema/manifestTypes'
import type { ValidationSignal, ValidationStage } from '../schema/validationTypes'
import { createValidationSignal } from './reportBuilder'

type ResolvedPairBounds =
  | {
      boundsA: THREE.Box3
      boundsB: THREE.Box3
      error?: undefined
      refs: Record<string, string>
    }
  | {
      boundsA?: undefined
      boundsB?: undefined
      error: string
      refs: Record<string, string>
    }

export type IndexedManifestCheck = {
  check: ManifestCheck
  index: number
}

export type RunPromptChecksOptions = {
  checks?: readonly IndexedManifestCheck[]
  includeMissingChecksWarning?: boolean
  poseLabel?: string
  stage?: ValidationStage
}

const defaultContactToleranceMeters = 0.005
const defaultContactMaxPenetrationMeters = 0.006

export function runPromptChecks(
  asset: ManifestAsset,
  builtAsset: BuiltManifestAsset,
  options: RunPromptChecksOptions = {},
): ValidationSignal[] {
  const includeMissingChecksWarning = options.includeMissingChecksWarning ?? true
  const indexedChecks =
    options.checks ??
    asset.checks
      .map((check, index) => ({ check, index }))
      .filter(({ check }) => !check.pose)

  if (asset.checks.length === 0 && includeMissingChecksWarning) {
    return [
      createValidationSignal(
        'authored_checks',
        'authored_checks_missing',
        `Asset "${asset.id}" does not declare authored prompt checks.`,
        {
          path: '/checks',
          severity: 'warning',
          source: 'checks',
          stage: options.stage ?? 'checks',
        },
      ),
    ]
  }

  return indexedChecks.flatMap(({ check, index }) =>
    runPromptCheck(asset, builtAsset, check, `/checks/${index}`, {
      poseLabel: options.poseLabel,
      stage: options.stage ?? 'checks',
    }),
  )
}

function runPromptCheck(
  asset: ManifestAsset,
  builtAsset: BuiltManifestAsset,
  check: ManifestCheck,
  path: string,
  context: {
    poseLabel?: string
    stage: ValidationStage
  },
): ValidationSignal[] {
  switch (check.type) {
    case 'part_exists':
      return asset.parts.some((part) => part.id === check.partId)
        ? []
        : [
            createCheckFailure(
              'missing_exact_geometry',
              'check_part_missing',
              `Authored check expected part "${check.partId}".`,
              path,
              { partId: check.partId },
              undefined,
              context,
            ),
          ]
    case 'joint_exists':
      return runJointExistsCheck(asset, check, path, context)
    case 'expect_material_side':
      return runMaterialSideCheck(asset, check, path, context)
    case 'expect_contact':
      return runContactCheck(builtAsset, check, path, context)
    case 'expect_gap':
      return runGapCheck(builtAsset, check, path, context)
    case 'expect_overlap':
      return runOverlapCheck(builtAsset, check, path, context)
    case 'expect_within':
      return runWithinCheck(builtAsset, check, path, context)
    default:
      return assertNever(check)
  }
}

function runMaterialSideCheck(
  asset: ManifestAsset,
  check: Extract<ManifestCheck, { type: 'expect_material_side' }>,
  path: string,
  context: {
    poseLabel?: string
    stage: ValidationStage
  },
) {
  const visualEntry = findVisualEntry(asset, check.visualId)

  if (!visualEntry) {
    return [
      createCheckFailure(
        'missing_exact_geometry',
        'check_ref_missing',
        `Authored check expected visual "${check.visualId}".`,
        path,
        { visualId: check.visualId },
        undefined,
        context,
      ),
    ]
  }

  const material = asset.materials.find(
    (candidate) => candidate.id === visualEntry.visual.materialId,
  )

  if (!material) {
    return [
      createCheckFailure(
        'missing_exact_geometry',
        'check_ref_missing',
        `Authored check expected material "${visualEntry.visual.materialId}".`,
        path,
        {
          partId: visualEntry.partId,
          visualId: check.visualId,
          materialId: visualEntry.visual.materialId,
        },
        undefined,
        context,
      ),
    ]
  }

  const actualSide = normalizeManifestMaterialSide(material.side)

  if (actualSide === check.side) {
    return []
  }

  return [
    createCheckFailure(
      'authored_check',
      'expect_material_side_failed',
      `Expected visual "${check.visualId}" to render material side "${check.side}", but material "${material.id}" uses "${actualSide}".`,
      path,
      {
        partId: visualEntry.partId,
        visualId: check.visualId,
        materialId: material.id,
      },
      `expectedSide=${check.side} actualSide=${actualSide}`,
      context,
    ),
  ]
}

function runJointExistsCheck(
  asset: ManifestAsset,
  check: Extract<ManifestCheck, { type: 'joint_exists' }>,
  path: string,
  context: {
    poseLabel?: string
    stage: ValidationStage
  },
) {
  const joint = asset.joints.find((candidate) => candidate.id === check.jointId)

  if (!joint) {
    return [
      createCheckFailure(
        'missing_exact_geometry',
        'check_joint_missing',
        `Authored check expected joint "${check.jointId}".`,
        path,
        { jointId: check.jointId },
        undefined,
        context,
      ),
    ]
  }

  if (check.jointType && joint.type !== check.jointType) {
    return [
      createCheckFailure(
        'authored_check',
        'check_joint_type_mismatch',
        `Authored check expected joint "${check.jointId}" to be "${check.jointType}", but it is "${joint.type}".`,
        path,
        { jointId: check.jointId },
        undefined,
        context,
      ),
    ]
  }

  return []
}

function runContactCheck(
  builtAsset: BuiltManifestAsset,
  check: Extract<ManifestCheck, { type: 'expect_contact' }>,
  path: string,
  context: {
    poseLabel?: string
    stage: ValidationStage
  },
) {
  const resolved = resolvePairBounds(
    builtAsset,
    check.partAId,
    check.partBId,
    check.visualAId,
    check.visualBId,
  )

  if (isResolvedPairError(resolved)) {
    return [
      createCheckFailure(
        'missing_exact_geometry',
        'check_ref_missing',
        resolved.error,
        path,
        resolved.refs,
        undefined,
        context,
      ),
    ]
  }

  const contactTolerance = check.contactTolerance ?? defaultContactToleranceMeters
  const maxPenetration =
    check.maxPenetration ?? defaultContactMaxPenetrationMeters
  const relation = selectBestContactRelation(
    findVisualRelations(builtAsset, {
      partAId: check.partAId,
      partBId: check.partBId,
      visualAId: check.visualAId,
      visualBId: check.visualBId,
    }),
    {
      contactTolerance,
      maxPenetration,
    },
  )

  if (
    relation &&
    relation.distance <= contactTolerance &&
    relation.penetrationDepth <= maxPenetration
  ) {
    return []
  }

  const details = relation
    ? [
        `minDistance=${relation.distance.toFixed(4)}`,
        `penetrationDepth=${relation.penetrationDepth.toFixed(4)}`,
        `contactTolerance=${contactTolerance}`,
        `maxPenetration=${maxPenetration}`,
        `closestVisualPair=${relation.visualAId}<->${relation.visualBId}`,
      ].join(' ')
    : `contactTolerance=${contactTolerance} maxPenetration=${maxPenetration}`

  return [
    createCheckFailure(
      'exact_contact_gap',
      'expect_contact_failed',
      relation && relation.penetrationDepth > maxPenetration
        ? `Expected "${check.partAId}" to contact "${check.partBId}", but the closest relation penetrates too deeply.`
        : `Expected "${check.partAId}" to contact "${check.partBId}", but measured gap is ${relation?.distance.toFixed(4) ?? 'unavailable'}m.`,
      path,
      resolved.refs,
      details,
      context,
    ),
  ]
}

function runGapCheck(
  builtAsset: BuiltManifestAsset,
  check: Extract<ManifestCheck, { type: 'expect_gap' }>,
  path: string,
  context: {
    poseLabel?: string
    stage: ValidationStage
  },
) {
  const resolved = resolvePairBounds(
    builtAsset,
    check.positivePartId,
    check.negativePartId,
    check.positiveVisualId,
    check.negativeVisualId,
  )

  if (isResolvedPairError(resolved)) {
    return [
      createCheckFailure(
        'missing_exact_geometry',
        'check_ref_missing',
        resolved.error,
        path,
        resolved.refs,
        undefined,
        context,
      ),
    ]
  }

  const minGap =
    check.minGap ??
    (check.maxPenetration === undefined ? 0 : -check.maxPenetration)
  const maxGap = check.maxGap ?? Number.POSITIVE_INFINITY

  if (maxGap < minGap) {
    return [
      createCheckFailure(
        'authored_check',
        'expect_gap_invalid_thresholds',
        'expect_gap maxGap must be greater than or equal to minGap.',
        path,
        resolved.refs,
        undefined,
        context,
      ),
    ]
  }

  const gap = getProjectedGap(resolved.boundsA, resolved.boundsB, check.axis)

  if (gap >= minGap && gap <= maxGap) {
    return []
  }

  return [
    createCheckFailure(
      'exact_contact_gap',
      'expect_gap_failed',
      `Expected gap on ${check.axis} between "${check.positivePartId}" and "${check.negativePartId}" to be within range.`,
      path,
      resolved.refs,
      `gap=${gap.toFixed(4)} minGap=${minGap} maxGap=${Number.isFinite(maxGap) ? maxGap : 'inf'}`,
      context,
    ),
  ]
}

function runOverlapCheck(
  builtAsset: BuiltManifestAsset,
  check: Extract<ManifestCheck, { type: 'expect_overlap' }>,
  path: string,
  context: {
    poseLabel?: string
    stage: ValidationStage
  },
) {
  const resolved = resolvePairBounds(
    builtAsset,
    check.partAId,
    check.partBId,
    check.visualAId,
    check.visualBId,
  )

  if (isResolvedPairError(resolved)) {
    return [
      createCheckFailure(
        'missing_exact_geometry',
        'check_ref_missing',
        resolved.error,
        path,
        resolved.refs,
        undefined,
        context,
      ),
    ]
  }

  const minOverlap = check.minOverlap ?? 0
  const failedAxes = normalizeAxes(check.axes).filter(
    (axis) =>
      getProjectedOverlap(resolved.boundsA, resolved.boundsB, axis) < minOverlap,
  )

  if (failedAxes.length === 0) {
    return []
  }

  return [
    createCheckFailure(
      'authored_check',
      'expect_overlap_failed',
      `Expected projected overlap between "${check.partAId}" and "${check.partBId}" on axes "${check.axes}".`,
      path,
      resolved.refs,
      failedAxes
        .map(
          (axis) =>
            `overlap_${axis}=${getProjectedOverlap(resolved.boundsA, resolved.boundsB, axis).toFixed(4)}`,
        )
        .join(' '),
      context,
    ),
  ]
}

function runWithinCheck(
  builtAsset: BuiltManifestAsset,
  check: Extract<ManifestCheck, { type: 'expect_within' }>,
  path: string,
  context: {
    poseLabel?: string
    stage: ValidationStage
  },
) {
  const resolved = resolvePairBounds(
    builtAsset,
    check.innerPartId,
    check.outerPartId,
    check.innerVisualId,
    check.outerVisualId,
  )

  if (isResolvedPairError(resolved)) {
    return [
      createCheckFailure(
        'missing_exact_geometry',
        'check_ref_missing',
        resolved.error,
        path,
        resolved.refs,
        undefined,
        context,
      ),
    ]
  }

  const margin = check.margin ?? 0
  const failedAxes = normalizeAxes(check.axes).filter(
    (axis) => !axisContains(resolved.boundsA, resolved.boundsB, axis, margin),
  )

  if (failedAxes.length === 0) {
    return []
  }

  return [
    createCheckFailure(
      'authored_check',
      'expect_within_failed',
      `Expected "${check.innerPartId}" to be within "${check.outerPartId}" on axes "${check.axes}".`,
      path,
      resolved.refs,
      `failedAxes=${failedAxes.join(',')} margin=${margin}`,
      context,
    ),
  ]
}

function selectBestContactRelation(
  relations: readonly VisualPairRelation[],
  options: {
    contactTolerance: number
    maxPenetration: number
  },
) {
  return relations.reduce<VisualPairRelation | null>((best, relation) => {
    if (!best) {
      return relation
    }

    const relationViolation = getContactViolationScore(relation, options)
    const bestViolation = getContactViolationScore(best, options)

    if (relationViolation !== bestViolation) {
      return relationViolation < bestViolation ? relation : best
    }

    if (relation.distance !== best.distance) {
      return relation.distance < best.distance ? relation : best
    }

    return relation.penetrationDepth < best.penetrationDepth ? relation : best
  }, null)
}

function getContactViolationScore(
  relation: VisualPairRelation,
  options: {
    contactTolerance: number
    maxPenetration: number
  },
) {
  const gapViolation = Math.max(0, relation.distance - options.contactTolerance)
  const penetrationViolation = Math.max(
    0,
    relation.penetrationDepth - options.maxPenetration,
  )

  return gapViolation + penetrationViolation
}

function findVisualEntry(asset: ManifestAsset, visualId: string) {
  for (const part of asset.parts) {
    for (const visual of part.visuals) {
      if (visual.id === visualId) {
        return { partId: part.id, visual }
      }
    }
  }

  return null
}

function resolvePairBounds(
  builtAsset: BuiltManifestAsset,
  partAId: string,
  partBId: string,
  visualAId: string | undefined,
  visualBId: string | undefined,
): ResolvedPairBounds {
  const refs = {
    partAId,
    partBId,
    ...(visualAId ? { visualAId } : {}),
    ...(visualBId ? { visualBId } : {}),
  }
  const boundsA = visualAId
    ? builtAsset.visualBounds.get(visualAId)
    : builtAsset.partBounds.get(partAId)
  const boundsB = visualBId
    ? builtAsset.visualBounds.get(visualBId)
    : builtAsset.partBounds.get(partBId)

  if (!builtAsset.partGroups.has(partAId)) {
    return { error: `Referenced part "${partAId}" does not exist.`, refs }
  }

  if (!builtAsset.partGroups.has(partBId)) {
    return { error: `Referenced part "${partBId}" does not exist.`, refs }
  }

  if (visualAId && builtAsset.visualPartIds.get(visualAId) !== partAId) {
    return {
      error: `Referenced visual "${visualAId}" does not belong to part "${partAId}".`,
      refs,
    }
  }

  if (visualBId && builtAsset.visualPartIds.get(visualBId) !== partBId) {
    return {
      error: `Referenced visual "${visualBId}" does not belong to part "${partBId}".`,
      refs,
    }
  }

  if (!boundsA || !boundsB) {
    return { error: 'Referenced bounds were not available.', refs }
  }

  return { boundsA, boundsB, refs }
}

function isResolvedPairError(
  resolved: ResolvedPairBounds,
): resolved is Extract<ResolvedPairBounds, { error: string }> {
  return resolved.error !== undefined
}

function createCheckFailure(
  kind: string,
  code: string,
  summary: string,
  path: string,
  refs: Record<string, string>,
  details?: string,
  context: {
    poseLabel?: string
    stage: ValidationStage
  } = {
    stage: 'checks',
  },
) {
  const poseDetails = context.poseLabel ? `pose=${context.poseLabel}` : null
  const combinedDetails = [details, poseDetails].filter(Boolean).join(' ')

  return createValidationSignal(kind, code, summary, {
    checkName: code,
    details: combinedDetails || undefined,
    path,
    refs,
    source: 'checks',
    stage: context.stage,
  })
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Manifest3D check: ${JSON.stringify(value)}`)
}
