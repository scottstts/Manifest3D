import type { ValidationReport, ValidationSignal } from '../../schema/validationTypes'
import type { ManifestProbeReport } from '../../validation/probeReport'
import {
  createValidationFailureClusters,
  createValidationFailureClusterSignature,
  type ValidationFailureCluster,
} from '../feedback/failureClusters'

export type CandidateAttemptStatus = 'success' | 'failure'

export type CandidateAttempt = {
  candidate: unknown
  candidateFingerprint: string
  createdAt: string
  failureClusters: ValidationFailureCluster[]
  failureSignature: string | null
  failureStreak: number
  id: string
  probeReport: ManifestProbeReport | null
  repeatedFailure: boolean
  report: ValidationReport
  revision: number
  runId: string
  status: CandidateAttemptStatus
}

export type CandidateHistorySnapshot = {
  activeCandidateFingerprint: string | null
  attempts: readonly CandidateAttempt[]
  canReportReady: boolean
  consecutiveFailureCount: number
  currentRevision: number
  latestFailureSignature: string | null
  latestSuccessfulAttempt: CandidateAttempt | null
  runId: string
}

export type CandidateHistory = {
  beginRun: (runId: string) => CandidateHistorySnapshot
  canReportReady: (candidate?: unknown) => boolean
  getLatestAttempt: () => CandidateAttempt | null
  getLatestSuccessfulAttempt: () => CandidateAttempt | null
  getSnapshot: () => CandidateHistorySnapshot
  markCandidateDraft: (candidate: unknown) => string
  recordValidationAttempt: (
    candidate: unknown,
    report: ValidationReport,
    probeReport?: ManifestProbeReport | null,
  ) => CandidateAttempt
}

export type CreateCandidateHistoryOptions = {
  now?: () => string
  runId?: string
}

const defaultRunId = 'run:default'

export function createCandidateHistory(
  options: CreateCandidateHistoryOptions = {},
): CandidateHistory {
  const now = options.now ?? (() => new Date().toISOString())
  let runId = options.runId ?? defaultRunId
  let attempts: CandidateAttempt[] = []
  let currentRevision = 0
  let activeCandidateFingerprint: string | null = null
  let latestSuccessfulAttempt: CandidateAttempt | null = null
  let latestFailureSignature: string | null = null
  let consecutiveFailureCount = 0

  function getSnapshot(): CandidateHistorySnapshot {
    return {
      activeCandidateFingerprint,
      attempts: [...attempts],
      canReportReady: canReportReady(),
      consecutiveFailureCount,
      currentRevision,
      latestFailureSignature,
      latestSuccessfulAttempt,
      runId,
    }
  }

  function beginRun(nextRunId: string): CandidateHistorySnapshot {
    runId = nextRunId
    attempts = []
    currentRevision = 0
    activeCandidateFingerprint = null
    latestSuccessfulAttempt = null
    latestFailureSignature = null
    consecutiveFailureCount = 0

    return getSnapshot()
  }

  function markCandidateDraft(candidate: unknown): string {
    const fingerprint = createCandidateFingerprint(candidate)

    currentRevision += 1
    activeCandidateFingerprint = fingerprint

    return fingerprint
  }

  function recordValidationAttempt(
    candidate: unknown,
    report: ValidationReport,
    probeReport: ManifestProbeReport | null = null,
  ): CandidateAttempt {
    const candidateFingerprint = markCandidateDraft(candidate)
    const failureClusters = createValidationFailureClusters(report.bundle.signals)
    const failureSignature = report.valid
      ? null
      : createValidationFailureClusterSignature(failureClusters)
    const repeatedFailure = Boolean(
      failureSignature && failureSignature === latestFailureSignature,
    )

    if (failureSignature) {
      consecutiveFailureCount += 1
      latestFailureSignature = failureSignature
    } else {
      consecutiveFailureCount = 0
      latestFailureSignature = null
    }

    const attempt: CandidateAttempt = {
      candidate,
      candidateFingerprint,
      createdAt: now(),
      failureClusters,
      failureSignature,
      failureStreak: consecutiveFailureCount,
      id: `${runId}:attempt:${attempts.length + 1}`,
      probeReport,
      repeatedFailure,
      report,
      revision: currentRevision,
      runId,
      status: report.valid ? 'success' : 'failure',
    }

    attempts = [...attempts, attempt]

    if (report.valid) {
      latestSuccessfulAttempt = attempt
    }

    return attempt
  }

  function getLatestAttempt(): CandidateAttempt | null {
    return attempts.at(-1) ?? null
  }

  function getLatestSuccessfulAttempt(): CandidateAttempt | null {
    return latestSuccessfulAttempt
  }

  function canReportReady(candidate?: unknown): boolean {
    if (!latestSuccessfulAttempt) {
      return false
    }

    const candidateFingerprint =
      candidate === undefined
        ? activeCandidateFingerprint
        : createCandidateFingerprint(candidate)

    return latestSuccessfulAttempt.candidateFingerprint === candidateFingerprint
  }

  return {
    beginRun,
    canReportReady,
    getLatestAttempt,
    getLatestSuccessfulAttempt,
    getSnapshot,
    markCandidateDraft,
    recordValidationAttempt,
  }
}

export function createCandidateFingerprint(candidate: unknown): string {
  return hashString(stableSerialize(candidate))
}

export function createValidationFailureSignature(
  signals: readonly ValidationSignal[],
): string | null {
  return createValidationFailureClusterSignature(
    createValidationFailureClusters(signals),
  )
}

function stableSerialize(value: unknown): string {
  const seen = new WeakSet<object>()

  function serialize(item: unknown): string {
    if (item === null) {
      return 'null'
    }

    if (item === undefined) {
      return '"undefined"'
    }

    if (Array.isArray(item)) {
      return `[${item.map((entry) => serialize(entry)).join(',')}]`
    }

    if (typeof item === 'object') {
      if (seen.has(item)) {
        throw new TypeError('Cannot fingerprint circular candidate data.')
      }

      seen.add(item)

      const objectValue = item as Record<string, unknown>
      const entries = Object.keys(objectValue)
        .sort()
        .filter((key) => objectValue[key] !== undefined)
        .map(
          (key) =>
            `${JSON.stringify(key)}:${serialize(objectValue[key])}`,
        )

      seen.delete(item)

      return `{${entries.join(',')}}`
    }

    if (typeof item === 'number') {
      if (Number.isNaN(item)) {
        return '"NaN"'
      }

      if (item === Number.POSITIVE_INFINITY) {
        return '"Infinity"'
      }

      if (item === Number.NEGATIVE_INFINITY) {
        return '"-Infinity"'
      }
    }

    if (typeof item === 'bigint') {
      return `"${item.toString()}n"`
    }

    if (typeof item === 'function' || typeof item === 'symbol') {
      return JSON.stringify(String(item))
    }

    return JSON.stringify(item)
  }

  return serialize(value)
}

function hashString(value: string): string {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}
