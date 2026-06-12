import type { PromptImageAttachment, PromptUserInputHistoryEntry } from '../prompt/promptCompiler'
import type { AgentImageAttachment } from '../provider/providerClient'

type UserInputHistoryEntry = {
  imageAttachments?: readonly AgentImageAttachment[]
  text: string
  turn: number
}

export function imageAttachmentMetadata(
  attachments: readonly AgentImageAttachment[],
): PromptImageAttachment[] {
  return attachments.map(({ height, id, mediaType, name, width }) => ({
    height,
    id,
    mediaType,
    name,
    width,
  }))
}

export function userInputHistoryMetadata(
  history: readonly UserInputHistoryEntry[],
): PromptUserInputHistoryEntry[] {
  return history.map((entry) => ({
    imageAttachments: imageAttachmentMetadata(entry.imageAttachments ?? []),
    text: entry.text,
    turn: entry.turn,
  }))
}

export function statelessReplayUserInputHistoryMetadata(
  history: readonly UserInputHistoryEntry[],
  currentAttachments: readonly AgentImageAttachment[],
): PromptUserInputHistoryEntry[] {
  const currentAttachmentKeys = new Set(
    currentAttachments.map((attachment) => imageAttachmentKey(attachment)),
  )

  return history.map((entry, index) => ({
    imageAttachments: imageAttachmentMetadata(
      index === 0
        ? entry.imageAttachments ?? []
        : (entry.imageAttachments ?? []).filter((attachment) =>
            currentAttachmentKeys.has(imageAttachmentKey(attachment)),
          ),
    ),
    text: entry.text,
    turn: entry.turn,
  }))
}

export function collectRequestImageAttachments(
  history: readonly UserInputHistoryEntry[],
  currentAttachments: readonly AgentImageAttachment[],
) {
  return collectStableImageAttachments(history, currentAttachments)
}

export function collectStableImageAttachments(
  history: readonly UserInputHistoryEntry[],
  currentAttachments: readonly AgentImageAttachment[],
) {
  const attachmentsByKey = new Map<string, AgentImageAttachment>()

  for (const attachment of [
    ...history.flatMap((entry) => entry.imageAttachments ?? []),
    ...currentAttachments,
  ]) {
    attachmentsByKey.set(imageAttachmentKey(attachment), attachment)
  }

  return [...attachmentsByKey.values()]
}

export function collectStatelessReplayImageAttachments(
  history: readonly UserInputHistoryEntry[],
  currentAttachments: readonly AgentImageAttachment[],
) {
  const originalAttachments = history[0]?.imageAttachments ?? []

  return collectStableImageAttachments(
    originalAttachments.length > 0
      ? [{ imageAttachments: originalAttachments, text: '', turn: 0 }]
      : [],
    currentAttachments,
  )
}

function imageAttachmentKey(attachment: AgentImageAttachment) {
  return `${attachment.id}\n${attachment.imageUrl}`
}
