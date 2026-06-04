import type { ManifestCheck } from '../schema/manifestTypes'

export type RelationCheckPartVisualPair = {
  partAId: string
  partBId: string
  visualAId?: string
  visualBId?: string
}

export function getRelationCheckPartVisualPairs(
  check: ManifestCheck,
): RelationCheckPartVisualPair[] {
  switch (check.type) {
    case 'expect_contact':
    case 'expect_overlap':
      return [{
        partAId: check.partAId,
        partBId: check.partBId,
        visualAId: check.visualAId,
        visualBId: check.visualBId,
      }]
    case 'expect_gap':
      return [{
        partAId: check.positivePartId,
        partBId: check.negativePartId,
        visualAId: check.positiveVisualId,
        visualBId: check.negativeVisualId,
      }]
    case 'expect_path_contacts':
      return check.targets.map((target) => ({
        partAId: check.pathPartId,
        partBId: target.partId,
        visualAId: check.pathVisualId,
        visualBId: target.visualId,
      }))
    case 'expect_within':
      return [{
        partAId: check.innerPartId,
        partBId: check.outerPartId,
        visualAId: check.innerVisualId,
        visualBId: check.outerVisualId,
      }]
    case 'joint_exists':
    case 'part_exists':
    case 'expect_material_side':
      return []
    default:
      return assertNeverRelationCheck(check)
  }
}

function assertNeverRelationCheck(value: never): never {
  throw new Error(
    `Unsupported Manifest3D relation check value: ${JSON.stringify(value)}`,
  )
}
