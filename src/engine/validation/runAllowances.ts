import type { ManifestAllowance } from '../schema/manifestTypes'
import type { GeometryOverlapFinding } from '../geometry/overlapChecks'

export function isOverlapAllowed(
  finding: GeometryOverlapFinding,
  allowances: readonly ManifestAllowance[],
) {
  return allowances.some(
    (allowance) =>
      allowance.type === 'allow_overlap' &&
      overlapAllowanceMatches(finding, allowance),
  )
}

export function getAllowedIsolatedPartIds(
  allowances: readonly ManifestAllowance[],
) {
  return new Set(
    allowances
      .filter((allowance) => allowance.type === 'allow_isolated_part')
      .map((allowance) => allowance.partId),
  )
}

export function getAllowanceKey(allowance: ManifestAllowance) {
  switch (allowance.type) {
    case 'allow_overlap':
      return [
        allowance.type,
        allowance.partAId,
        allowance.partBId,
        allowance.visualAId ?? '*',
        allowance.visualBId ?? '*',
      ].join(':')
    case 'allow_isolated_part':
      return [allowance.type, allowance.partId].join(':')
    default:
      return assertNever(allowance)
  }
}

function overlapAllowanceMatches(
  finding: GeometryOverlapFinding,
  allowance: Extract<ManifestAllowance, { type: 'allow_overlap' }>,
) {
  return (
    overlapAllowanceMatchesOrdered(
      finding.partAId,
      finding.partBId,
      finding.visualAId,
      finding.visualBId,
      allowance,
    ) ||
    overlapAllowanceMatchesOrdered(
      finding.partBId,
      finding.partAId,
      finding.visualBId,
      finding.visualAId,
      allowance,
    )
  )
}

function overlapAllowanceMatchesOrdered(
  partAId: string,
  partBId: string,
  visualAId: string,
  visualBId: string,
  allowance: Extract<ManifestAllowance, { type: 'allow_overlap' }>,
) {
  return (
    allowance.partAId === partAId &&
    allowance.partBId === partBId &&
    (allowance.visualAId === undefined || allowance.visualAId === visualAId) &&
    (allowance.visualBId === undefined || allowance.visualBId === visualBId)
  )
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Manifest3D allowance: ${JSON.stringify(value)}`)
}
