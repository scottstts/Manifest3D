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
import type { AgentLoopEvent } from './agentLoop'
import {
  createAgentProgressTimeline,
  createCandidateHistoryTimeline,
} from './validationTimeline'

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

  it('projects candidate history into separated attempt timeline sections', () => {
    const history = createCandidateHistory({
      now: () => '2026-05-16T00:00:00.000Z',
      runId: 'run-timeline',
    })
    const invalidCandidate = createInvalidValidationFixtureAsset()
    const result = validateManifestAssetCandidate(invalidCandidate)

    history.recordValidationAttempt(invalidCandidate, result.report)
    history.recordValidationAttempt(invalidCandidate, result.report)

    const timeline = createCandidateHistoryTimeline(history.getSnapshot())

    expect(timeline.map((item) => item.label)).toEqual([
      'Initial attempt',
      'Candidate validation failed',
      '',
      'Repair 1',
      'Candidate validation failed',
      '',
    ])
    expect(timeline[1]).toMatchObject({
      kind: 'candidate_attempt',
      label: 'Candidate validation failed',
      status: 'failed',
    })
    expect(timeline[1].detail).toContain(
      'The candidate reused an id that must be unique.',
    )
    expect(
      timeline.some((item) => item.label === 'Check asset structure'),
    ).toBe(false)
  })

  it('interleaves completed validation attempts with the live agent event stream', () => {
    const history = createCandidateHistory({
      now: () => '2026-05-16T00:00:00.000Z',
      runId: 'run-progress',
    })
    const invalidCandidate = createInvalidValidationFixtureAsset()
    const result = validateManifestAssetCandidate(invalidCandidate)

    history.recordValidationAttempt(invalidCandidate, result.report)

    const events: AgentLoopEvent[] = [
      {
        detail: 'mode=create',
        id: 'run-progress:1:compiling_prompt',
        label: 'Compile prompt',
        state: 'compiling_prompt',
        status: 'passed',
      },
      {
        detail: null,
        id: 'run-progress:2:validating_candidate',
        label: 'Validate candidate',
        state: 'validating_candidate',
        status: 'failed',
      },
      {
        detail: 'repairTurn=1',
        id: 'run-progress:3:repairing',
        label: 'Prepare repair feedback',
        state: 'repairing',
        status: 'passed',
      },
    ]

    const timeline = createAgentProgressTimeline(events, history.getSnapshot())
    const labels = timeline.map((item) => item.label)
    const compileIndex = labels.indexOf('Compile prompt')
    const attemptIndex = labels.indexOf('Candidate validation failed')
    const repairHeaderIndex = labels.indexOf('Repair 1')
    const repairIndex = labels.indexOf('Prepare repair feedback')

    expect(labels).not.toContain('Validate candidate')
    expect(compileIndex).toBeGreaterThan(-1)
    expect(attemptIndex).toBeGreaterThan(compileIndex)
    expect(repairHeaderIndex).toBeGreaterThan(attemptIndex)
    expect(repairIndex).toBeGreaterThan(repairHeaderIndex)
    expect(timeline[attemptIndex]).toMatchObject({
      kind: 'candidate_attempt',
      status: 'failed',
    })
    expect(timeline[attemptIndex].detail).toContain(
      'The candidate reused an id that must be unique.',
    )
  })

  it('leaves the current attempt section open while a step is running', () => {
    const history = createCandidateHistory({ runId: 'run-open-section' })
    const timeline = createAgentProgressTimeline(
      [
        {
          detail: null,
          id: 'run-open-section:1:requesting_model',
          label: 'Request candidate',
          state: 'requesting_model',
          status: 'running',
        },
      ],
      history.getSnapshot(),
    )

    expect(timeline.map((item) => item.label)).toEqual([
      'Initial attempt',
      'Request candidate',
    ])
    expect(timeline.some((item) => item.kind === 'attempt_footer')).toBe(false)
  })

  it('does not append unmatched validation attempts under a running step', () => {
    const history = createCandidateHistory({ runId: 'run-no-orphan-attempt' })
    const invalidCandidate = createInvalidValidationFixtureAsset()

    history.recordValidationAttempt(
      invalidCandidate,
      validateManifestAssetCandidate(invalidCandidate).report,
    )

    const timeline = createAgentProgressTimeline(
      [
        {
          detail: null,
          id: 'run-no-orphan-attempt:1:requesting_model',
          label: 'Request candidate',
          state: 'requesting_model',
          status: 'running',
        },
      ],
      history.getSnapshot(),
    )

    expect(timeline.map((item) => item.label)).toEqual([
      'Initial attempt',
      'Request candidate',
    ])
    expect(
      timeline.some((item) => item.label === 'Candidate validation failed'),
    ).toBe(false)
    expect(timeline.some((item) => item.kind === 'attempt_footer')).toBe(false)
  })

  it('keeps full validation steps for successful attempts', () => {
    const history = createCandidateHistory({ runId: 'run-success-steps' })
    const validCandidate = createValidValidationFixtureAsset()

    history.recordValidationAttempt(
      validCandidate,
      validateManifestAssetCandidate(validCandidate).report,
    )

    const timeline = createAgentProgressTimeline([], history.getSnapshot())
    const labels = timeline.map((item) => item.label)

    expect(labels).toContain('Candidate validated')
    expect(labels).toContain('Parse Manifest3D schema')
    expect(labels).toContain('Check asset structure')
    expect(labels).toContain('Build candidate geometry')
    expect(labels).toContain('Run baseline QC')
    expect(labels).toContain('Run authored checks')
    expect(labels).toContain('Run sampled-pose checks')
    expect(labels).toContain('Check export readiness')
    expect(timeline.at(-1)).toMatchObject({ kind: 'attempt_footer' })
  })

  it('keeps failed agent event details concise and hides routine event details', () => {
    const history = createCandidateHistory({ runId: 'run-event-detail' })
    const timeline = createAgentProgressTimeline(
      [
        {
          detail: 'mode=create',
          id: 'run-event-detail:1:compiling_prompt',
          label: 'Compile prompt',
          state: 'compiling_prompt',
          status: 'passed',
        },
        {
          detail: [
            'Patched candidate does not satisfy the Manifest3D asset schema.',
            '/details omitted',
          ].join('\n'),
          id: 'run-event-detail:2:parsing_candidate',
          label: 'Parse candidate JSON',
          state: 'parsing_candidate',
          status: 'failed',
        },
      ],
      history.getSnapshot(),
    )

    expect(timeline[1].detail).toBeNull()
    expect(timeline[2].detail).toBe(
      'Patched candidate does not satisfy the Manifest3D asset schema.',
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
