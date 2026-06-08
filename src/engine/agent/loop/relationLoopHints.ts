import type { CandidateAttempt } from '../session/candidateHistory'

export function createRelationLoopHints(attempts: readonly CandidateAttempt[]) {
  const recentFailures = attempts
    .filter((candidateAttempt) => candidateAttempt.status === 'failure')
    .slice(-5)
  const relationStatesByPair = new Map<
    string,
    Map<RelationClusterState, Set<number>>
  >()

  for (const candidateAttempt of recentFailures) {
    for (const cluster of candidateAttempt.failureClusters) {
      const partPair = cluster.refs.partPair

      if (!partPair) {
        continue
      }

      const state = classifyRelationCluster(cluster.kind, cluster.code)

      if (!state) {
        continue
      }

      const states =
        relationStatesByPair.get(partPair) ??
        new Map<RelationClusterState, Set<number>>()
      const attemptRevisions = states.get(state) ?? new Set<number>()

      attemptRevisions.add(candidateAttempt.revision)
      states.set(state, attemptRevisions)
      relationStatesByPair.set(partPair, states)
    }
  }

  return [...relationStatesByPair.entries()]
    .filter(([, states]) => hasRelationStateAlternation(states))
    .slice(0, 4)
    .map(([partPair]) =>
      `Recent repairs alternated between overlap and gap/contact failures for ${partPair}. Treat this as one mounting relation problem: choose exact visual endpoints, add a bracket/saddle/hanger/support path, and use bounded contact or scoped allowance only when the physical fit is intentional.`,
    )
}

type RelationClusterState = 'too-close' | 'too-far'

function classifyRelationCluster(
  kind: string,
  code: string,
): RelationClusterState | null {
  if (
    kind === 'real_overlap' ||
    kind === 'sampled_pose_overlap' ||
    code.includes('overlap_current_pose') ||
    code.includes('overlap_sampled_pose')
  ) {
    return 'too-close'
  }

  if (
    kind === 'exact_contact_gap' ||
    kind === 'path_contact_fit' ||
    code === 'expect_contact_failed' ||
    code === 'expect_gap_failed' ||
    code === 'expect_path_contacts_failed'
  ) {
    return 'too-far'
  }

  return null
}

function hasRelationStateAlternation(
  states: ReadonlyMap<RelationClusterState, ReadonlySet<number>>,
) {
  const tooCloseAttempts = states.get('too-close')
  const tooFarAttempts = states.get('too-far')

  if (!tooCloseAttempts || !tooFarAttempts) {
    return false
  }

  for (const closeAttempt of tooCloseAttempts) {
    for (const farAttempt of tooFarAttempts) {
      if (closeAttempt !== farAttempt) {
        return true
      }
    }
  }

  return false
}

