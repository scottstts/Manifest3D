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

export function collectRequestImageAttachments(
  history: readonly UserInputHistoryEntry[],
  currentAttachments: readonly AgentImageAttachment[],
) {
  const attachmentsByKey = new Map<string, AgentImageAttachment>()

  for (const attachment of [
    ...history.flatMap((entry) => entry.imageAttachments ?? []),
    ...currentAttachments,
  ]) {
    attachmentsByKey.set(`${attachment.id}\n${attachment.imageUrl}`, attachment)
  }

  return [...attachmentsByKey.values()]
}

