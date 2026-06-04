import type { GeometryOverlapFinding } from '../geometry/overlapChecks'
import type { ManifestCheck } from '../schema/manifestTypes'

const defaultContactMaxPenetrationMeters = 0.006
const defaultPathContactMaxPenetrationMeters = 0.006

export type BoundedOverlapProofCheck = {
  checkType:
    | 'expect_contact'
    | 'expect_gap'
    | 'expect_path_contacts'
    | 'expect_within'
  maxPenetration: number
}

export function getBoundedOverlapProofCheck(
  finding: GeometryOverlapFinding,
  checks: readonly ManifestCheck[],
): BoundedOverlapProofCheck | null {
  const penetration = getFindingPenetrationDepth(finding)

  for (const check of checks) {
    switch (check.type) {
      case 'expect_contact': {
        const maxPenetration =
          check.maxPenetration ?? defaultContactMaxPenetrationMeters

        if (
          penetration <= maxPenetration &&
          exactVisualPairMatches(finding, {
            partAId: check.partAId,
            partBId: check.partBId,
            visualAId: check.visualAId,
            visualBId: check.visualBId,
          })
        ) {
          return {
            checkType: check.type,
            maxPenetration,
          }
        }

        break
      }
      case 'expect_path_contacts': {
        const maxPenetration =
          check.maxPenetration ?? defaultPathContactMaxPenetrationMeters

        for (const target of check.targets) {
          if (
            penetration <= maxPenetration &&
            exactVisualPairMatches(finding, {
              partAId: check.pathPartId,
              partBId: target.partId,
              visualAId: check.pathVisualId,
              visualBId: target.visualId,
            })
          ) {
            return {
              checkType: check.type,
              maxPenetration,
            }
          }
        }

        break
      }
      case 'expect_gap': {
        if (
          check.maxPenetration !== undefined &&
          penetration <= check.maxPenetration &&
          exactVisualPairMatches(finding, {
            partAId: check.positivePartId,
            partBId: check.negativePartId,
            visualAId: check.positiveVisualId,
            visualBId: check.negativeVisualId,
          })
        ) {
          return {
            checkType: check.type,
            maxPenetration: check.maxPenetration,
          }
        }

        break
      }
      case 'expect_within': {
        if (
          check.maxPenetration !== undefined &&
          penetration <= check.maxPenetration &&
          exactVisualPairMatches(finding, {
            partAId: check.innerPartId,
            partBId: check.outerPartId,
            visualAId: check.innerVisualId,
            visualBId: check.outerVisualId,
          })
        ) {
          return {
            checkType: check.type,
            maxPenetration: check.maxPenetration,
          }
        }

        break
      }
      case 'expect_material_side':
      case 'expect_overlap':
      case 'joint_exists':
      case 'part_exists':
        break
      default:
        assertNever(check)
    }
  }

  return null
}

export function formatBoundedOverlapProofDetails(
  proof: BoundedOverlapProofCheck,
) {
  return `proofCheck=${proof.checkType} maxPenetration=${proof.maxPenetration}`
}

function getFindingPenetrationDepth(finding: GeometryOverlapFinding) {
  return Math.min(finding.depth.x, finding.depth.y, finding.depth.z)
}

function exactVisualPairMatches(
  finding: GeometryOverlapFinding,
  pair: {
    partAId: string
    partBId: string
    visualAId?: string
    visualBId?: string
  },
) {
  if (!pair.visualAId || !pair.visualBId) {
    return false
  }

  const visualAId = pair.visualAId
  const visualBId = pair.visualBId

  return (
    orderedVisualPairMatches(finding, {
      partAId: pair.partAId,
      partBId: pair.partBId,
      visualAId,
      visualBId,
    }) ||
    orderedVisualPairMatches(finding, {
      partAId: pair.partBId,
      partBId: pair.partAId,
      visualAId: visualBId,
      visualBId: visualAId,
    })
  )
}

function orderedVisualPairMatches(
  finding: GeometryOverlapFinding,
  pair: {
    partAId: string
    partBId: string
    visualAId: string
    visualBId: string
  },
) {
  return (
    finding.partAId === pair.partAId &&
    finding.partBId === pair.partBId &&
    finding.visualAId === pair.visualAId &&
    finding.visualBId === pair.visualBId
  )
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Manifest3D check: ${JSON.stringify(value)}`)
}
