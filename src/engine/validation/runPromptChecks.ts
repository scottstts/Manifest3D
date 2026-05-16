import * as THREE from 'three/webgpu'
import type { BuiltManifestAsset } from '../geometry/assetBuilder'
import {
  axisContains,
  boxDistance,
  getProjectedGap,
  getProjectedOverlap,
  normalizeAxes,
} from '../geometry/measurements'
import type { ManifestAsset, ManifestCheck } from '../schema/manifestTypes'
import type { ValidationSignal } from '../schema/validationTypes'
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

export function runPromptChecks(
  asset: ManifestAsset,
  builtAsset: BuiltManifestAsset,
): ValidationSignal[] {
  if (asset.checks.length === 0) {
    return [
      createValidationSignal(
        'authored_checks',
        'authored_checks_missing',
        `Asset "${asset.id}" does not declare authored prompt checks.`,
        {
          path: '/checks',
          severity: 'warning',
          source: 'checks',
          stage: 'checks',
        },
      ),
    ]
  }

  return asset.checks.flatMap((check, index) =>
    runPromptCheck(asset, builtAsset, check, `/checks/${index}`),
  )
}

function runPromptCheck(
  asset: ManifestAsset,
  builtAsset: BuiltManifestAsset,
  check: ManifestCheck,
  path: string,
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
            ),
          ]
    case 'joint_exists':
      return runJointExistsCheck(asset, check, path)
    case 'expect_contact':
      return runContactCheck(builtAsset, check, path)
    case 'expect_gap':
      return runGapCheck(builtAsset, check, path)
    case 'expect_overlap':
      return runOverlapCheck(builtAsset, check, path)
    case 'expect_within':
      return runWithinCheck(builtAsset, check, path)
    default:
      return assertNever(check)
  }
}

function runJointExistsCheck(
  asset: ManifestAsset,
  check: Extract<ManifestCheck, { type: 'joint_exists' }>,
  path: string,
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
      ),
    ]
  }

  return []
}

function runContactCheck(
  builtAsset: BuiltManifestAsset,
  check: Extract<ManifestCheck, { type: 'expect_contact' }>,
  path: string,
) {
  const resolved = resolvePairBounds(
    builtAsset,
    check.partAId,
    check.partBId,
    check.visualAId,
    check.visualBId,
  )

  if (isResolvedPairError(resolved)) {
    return [createCheckFailure('missing_exact_geometry', 'check_ref_missing', resolved.error, path, resolved.refs)]
  }

  const contactTolerance = check.contactTolerance ?? 0.005
  const distance = boxDistance(resolved.boundsA, resolved.boundsB)

  if (distance <= contactTolerance) {
    return []
  }

  return [
    createCheckFailure(
      'exact_contact_gap',
      'expect_contact_failed',
      `Expected "${check.partAId}" to contact "${check.partBId}", but measured gap is ${distance.toFixed(4)}m.`,
      path,
      resolved.refs,
      `minDistance=${distance.toFixed(4)} contactTolerance=${contactTolerance}`,
    ),
  ]
}

function runGapCheck(
  builtAsset: BuiltManifestAsset,
  check: Extract<ManifestCheck, { type: 'expect_gap' }>,
  path: string,
) {
  const resolved = resolvePairBounds(
    builtAsset,
    check.positivePartId,
    check.negativePartId,
    check.positiveVisualId,
    check.negativeVisualId,
  )

  if (isResolvedPairError(resolved)) {
    return [createCheckFailure('missing_exact_geometry', 'check_ref_missing', resolved.error, path, resolved.refs)]
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
    ),
  ]
}

function runOverlapCheck(
  builtAsset: BuiltManifestAsset,
  check: Extract<ManifestCheck, { type: 'expect_overlap' }>,
  path: string,
) {
  const resolved = resolvePairBounds(
    builtAsset,
    check.partAId,
    check.partBId,
    check.visualAId,
    check.visualBId,
  )

  if (isResolvedPairError(resolved)) {
    return [createCheckFailure('missing_exact_geometry', 'check_ref_missing', resolved.error, path, resolved.refs)]
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
    ),
  ]
}

function runWithinCheck(
  builtAsset: BuiltManifestAsset,
  check: Extract<ManifestCheck, { type: 'expect_within' }>,
  path: string,
) {
  const resolved = resolvePairBounds(
    builtAsset,
    check.innerPartId,
    check.outerPartId,
    check.innerVisualId,
    check.outerVisualId,
  )

  if (isResolvedPairError(resolved)) {
    return [createCheckFailure('missing_exact_geometry', 'check_ref_missing', resolved.error, path, resolved.refs)]
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
    ),
  ]
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
) {
  return createValidationSignal(kind, code, summary, {
    checkName: code,
    details,
    path,
    refs,
    source: 'checks',
    stage: 'checks',
  })
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Manifest3D check: ${JSON.stringify(value)}`)
}
