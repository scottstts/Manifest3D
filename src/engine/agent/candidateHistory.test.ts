import { describe, expect, it } from 'vitest'
import {
  createInvalidValidationFixtureAsset,
  createValidValidationFixtureAsset,
} from '../examples/validationFixtures'
import { validateManifestAssetCandidate } from '../validation/validateManifest'
import { createCandidateHistory } from './candidateHistory'
import { createCandidateHistoryTimeline } from './validationTimeline'

describe('createCandidateHistory', () => {
  it('allows ready only when the latest active candidate has a fresh successful report', () => {
    const history = createCandidateHistory({
      now: () => '2026-05-16T00:00:00.000Z',
      runId: 'run-freshness',
    })
    const validCandidate = createValidValidationFixtureAsset()
    const validResult = validateManifestAssetCandidate(validCandidate)

    history.recordValidationAttempt(validCandidate, validResult.report)

    expect(history.canReportReady()).toBe(true)
    expect(history.canReportReady(validCandidate)).toBe(true)

    history.markCandidateDraft({
      ...validCandidate,
      name: 'Validation Crate Mutated After Validation',
    })

    expect(history.canReportReady()).toBe(false)
  })

  it('keeps invalid attempts in history and detects repeated failure signatures', () => {
    const history = createCandidateHistory({
      now: () => '2026-05-16T00:00:00.000Z',
      runId: 'run-repeated',
    })
    const invalidCandidate = createInvalidValidationFixtureAsset()
    const firstResult = validateManifestAssetCandidate(invalidCandidate)
    const secondResult = validateManifestAssetCandidate(invalidCandidate)

    const firstAttempt = history.recordValidationAttempt(
      invalidCandidate,
      firstResult.report,
    )
    const secondAttempt = history.recordValidationAttempt(
      invalidCandidate,
      secondResult.report,
    )

    expect(firstAttempt.repeatedFailure).toBe(false)
    expect(firstAttempt.failureStreak).toBe(1)
    expect(secondAttempt.repeatedFailure).toBe(true)
    expect(secondAttempt.failureStreak).toBe(2)
    expect(history.getSnapshot().attempts).toHaveLength(2)
    expect(history.canReportReady()).toBe(false)
  })

  it('projects candidate history into label-only attempt timeline rows', () => {
    const history = createCandidateHistory({
      now: () => '2026-05-16T00:00:00.000Z',
      runId: 'run-timeline',
    })
    const invalidCandidate = createInvalidValidationFixtureAsset()
    const result = validateManifestAssetCandidate(invalidCandidate)

    history.recordValidationAttempt(invalidCandidate, result.report)
    history.recordValidationAttempt(invalidCandidate, result.report)

    const timeline = createCandidateHistoryTimeline(history.getSnapshot())

    expect(timeline[0]).toMatchObject({
      detail: null,
      kind: 'candidate_attempt',
      label: 'Candidate validation failed',
      status: 'failed',
    })
    expect(
      timeline
        .filter((item) => item.kind === 'candidate_attempt')
        .map((item) => item.detail),
    ).toEqual([null, null])
    expect(timeline.map((item) => item.id)).toContain(
      'run-timeline:attempt:2:validation:invalid-validation-crate:structure',
    )
  })

  it('resets repeated failure tracking after a successful validation', () => {
    const history = createCandidateHistory({
      now: () => '2026-05-16T00:00:00.000Z',
      runId: 'run-reset',
    })
    const invalidCandidate = createInvalidValidationFixtureAsset()
    const validCandidate = createValidValidationFixtureAsset()

    history.recordValidationAttempt(
      invalidCandidate,
      validateManifestAssetCandidate(invalidCandidate).report,
    )
    history.recordValidationAttempt(
      validCandidate,
      validateManifestAssetCandidate(validCandidate).report,
    )

    expect(history.getSnapshot().consecutiveFailureCount).toBe(0)
    expect(history.getSnapshot().latestFailureSignature).toBeNull()
    expect(history.canReportReady()).toBe(true)
  })
})
