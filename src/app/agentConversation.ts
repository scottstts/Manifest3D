import type {
  AgentUserInputHistoryEntry,
} from '../engine/agent/agentLoop'
import type { AgentImageAttachment } from '../engine/agent/providerClient'
import {
  createCandidateHistoryTimeline,
  type AgentTimelineItem,
} from '../engine/agent/validationTimeline'
import type {
  AssetLibraryAsset,
  AssetLibraryVersion,
  PersistedCandidateAttempt,
  PersistedUserInput,
} from '../engine/persistence/assetLibraryTypes'
import type { ChatPanelTranscriptItem } from '../ui/ChatPanel'

export type SubmittedUserInput = {
  imageAttachments: readonly AgentImageAttachment[]
  text: string
}

export function createPromptUserInputHistory({
  asset,
  currentUserInput,
  selectedVersionId,
}: {
  asset: AssetLibraryAsset | null
  currentUserInput: SubmittedUserInput
  selectedVersionId: string | null
}): AgentUserInputHistoryEntry[] {
  const previousInputs = asset && selectedVersionId
    ? getVersionLineage(asset, selectedVersionId)
        .map((version) => version.userInput ?? null)
        .filter((userInput): userInput is PersistedUserInput =>
          Boolean(userInput),
        )
    : []

  if (previousInputs.length === 0) {
    return []
  }

  return [
    ...previousInputs.map((userInput, index) => ({
      imageAttachments: toAgentImageAttachments(userInput),
      text: userInput.text,
      turn: index,
    })),
    {
      imageAttachments: currentUserInput.imageAttachments,
      text: currentUserInput.text,
      turn: previousInputs.length,
    },
  ]
}

export function createVersionTranscript(
  asset: AssetLibraryAsset,
  version: AssetLibraryVersion,
): ChatPanelTranscriptItem[] {
  const lineage = getVersionLineage(asset, version.versionId)

  if (!lineage.some((lineageVersion) => lineageVersion.userInput)) {
    return []
  }

  return lineage.flatMap((lineageVersion) => {
    const items: ChatPanelTranscriptItem[] = []

    if (lineageVersion.userInput) {
      items.push({
        id: `${lineageVersion.versionId}:user`,
        imageAttachments: toAgentImageAttachments(lineageVersion.userInput),
        role: 'user',
        text: lineageVersion.userInput.text,
      })
    }

    items.push({
      id: `${lineageVersion.versionId}:agent`,
      role: 'agent',
      status: `Ready: ${lineageVersion.asset.name} v${lineageVersion.versionNumber}`,
      timelineItems: createVersionTimeline(lineageVersion),
    })

    return items
  })
}

export function createVersionTimeline(
  version: AssetLibraryVersion,
): AgentTimelineItem[] {
  const latestAttempt = version.attempts.at(-1) ?? null
  const latestSuccessfulAttempt =
    [...version.attempts]
      .reverse()
      .find((attempt) => attempt.status === 'success') ?? null
  const latestFailureAttempt =
    [...version.attempts]
      .reverse()
      .find((attempt) => attempt.status === 'failure') ?? null

  return createCandidateHistoryTimeline({
    activeCandidateFingerprint: latestAttempt?.candidateFingerprint ?? null,
    attempts: version.attempts,
    canReportReady: latestAttempt?.status === 'success',
    consecutiveFailureCount: latestFailureAttempt?.failureStreak ?? 0,
    currentRevision: latestAttempt?.revision ?? 0,
    latestFailureSignature: latestFailureAttempt?.failureSignature ?? null,
    latestSuccessfulAttempt,
    runId: version.sourceRunId,
  })
}

export function formatAttemptContext(version: AssetLibraryVersion) {
  const latestAttempt = version.attempts.at(-1)
  const failureAttempts = version.attempts.filter(
    (attempt) => attempt.status === 'failure',
  )

  return [
    `versionId=${version.versionId}`,
    `assetId=${version.assetId}`,
    `attempts=${version.attempts.length}`,
    `failedAttempts=${failureAttempts.length}`,
    latestAttempt
      ? `latestAttemptStatus=${latestAttempt.status} latestReport=${latestAttempt.report.bundle.summary}`
      : 'latestAttemptStatus=none',
    ...version.attempts
      .slice(-4)
      .map((attempt) => formatAttemptSummary(attempt)),
  ].join('\n')
}

export function persistSubmittedUserInput(
  userInput: SubmittedUserInput,
): PersistedUserInput {
  return {
    imageAttachments: userInput.imageAttachments.map((attachment) => ({
      ...attachment,
    })),
    text: userInput.text,
  }
}

function getVersionLineage(
  asset: AssetLibraryAsset,
  versionId: string,
): AssetLibraryVersion[] {
  const versionsById = new Map(
    asset.versions.map((version) => [version.versionId, version]),
  )
  const lineage: AssetLibraryVersion[] = []
  const seenVersionIds = new Set<string>()
  let currentVersion = versionsById.get(versionId) ?? null

  while (currentVersion) {
    if (seenVersionIds.has(currentVersion.versionId)) {
      break
    }

    lineage.push(currentVersion)
    seenVersionIds.add(currentVersion.versionId)

    currentVersion = currentVersion.parentVersionId
      ? versionsById.get(currentVersion.parentVersionId) ?? null
      : null
  }

  return lineage.reverse()
}

function toAgentImageAttachments(
  userInput: PersistedUserInput,
): AgentImageAttachment[] {
  return userInput.imageAttachments.map((attachment) => ({ ...attachment }))
}

function formatAttemptSummary(attempt: PersistedCandidateAttempt) {
  return [
    `- revision=${attempt.revision}`,
    `status=${attempt.status}`,
    `failureStreak=${attempt.failureStreak}`,
    `report=${attempt.report.bundle.summary}`,
  ].join(' ')
}
