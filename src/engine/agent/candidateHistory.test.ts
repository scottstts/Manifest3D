import { describe, expect, it } from 'vitest'
import {
  createInvalidValidationFixtureAsset,
  createValidValidationFixtureAsset,
} from '../examples/validationFixtures'
import { validateManifestAssetCandidate } from '../validation/validateManifest'
import {
  createValidationReport,
  createValidationSignal,
} from '../validation/reportBuilder'
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

  it('detects repeated semantic failure clusters when raw overlap details change', () => {
    const history = createCandidateHistory({
      now: () => '2026-05-16T00:00:00.000Z',
      runId: 'run-clusters',
    })
    const candidate = createValidValidationFixtureAsset()
    const firstReport = createValidationReport({
      asset: candidate,
      signals: [
        createValidationSignal(
          'sampled_pose_overlap',
          'part_overlap_sampled_pose',
          'Sampled-pose overlap detected between "chain" and "drawbridge".',
          {
            details:
              'depth=(0.0100,0.0200,0.0300) volume=1.000e-5 pose=lowered joints=bridge-hinge=-1.2000',
            refs: {
              partAId: 'chain',
              partBId: 'drawbridge',
              visualAId: 'chain-tube-a',
              visualBId: 'bridge-plank-a',
            },
            source: 'baseline_qc',
            stage: 'sampled_poses',
          },
        ),
      ],
    })
    const secondReport = createValidationReport({
      asset: candidate,
      signals: [
        createValidationSignal(
          'sampled_pose_overlap',
          'part_overlap_sampled_pose',
          'Sampled-pose overlap detected between "drawbridge" and "chain".',
          {
            details:
              'depth=(0.0400,0.0500,0.0600) volume=9.000e-5 pose=lowered joints=bridge-hinge=-1.2000',
            refs: {
              partAId: 'drawbridge',
              partBId: 'chain',
              visualAId: 'bridge-plank-b',
              visualBId: 'chain-tube-b',
            },
            source: 'baseline_qc',
            stage: 'sampled_poses',
          },
        ),
      ],
    })

    const firstAttempt = history.recordValidationAttempt(candidate, firstReport)
    const secondAttempt = history.recordValidationAttempt(candidate, secondReport)

    expect(firstAttempt.failureClusters[0]).toMatchObject({
      count: 1,
      refs: {
        partPair: 'chain<->drawbridge',
      },
    })
    expect(secondAttempt.repeatedFailure).toBe(true)
    expect(secondAttempt.failureSignature).toBe(firstAttempt.failureSignature)
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
