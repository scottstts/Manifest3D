import type { CandidateAttempt } from '../session/candidateHistory'
import { renderValidationSignals } from '../feedback/repairFeedback'
import { createRelationLoopHints } from './relationLoopHints'

export function renderRepairFeedback(
  attempt: CandidateAttempt,
  attempts: readonly CandidateAttempt[] = [attempt],
) {
  return renderValidationSignals(attempt.report.bundle, {
    candidateFingerprint: attempt.candidateFingerprint,
    failureClusters: attempt.failureClusters,
    failureStreak: attempt.failureStreak,
    probeReport: attempt.probeReport,
    relationLoopHints: createRelationLoopHints(attempts),
    repeated: attempt.repeatedFailure,
    revision: attempt.revision,
  })
}

