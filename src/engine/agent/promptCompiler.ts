import type { ManifestAsset, ManifestScene } from '../schema/manifestTypes'
import createAssetPrompt from './prompts/createAsset.md?raw'
import editAssetPrompt from './prompts/editAsset.md?raw'
import examplesPrompt from './prompts/examples.md?raw'
import repairAssetPrompt from './prompts/repairAsset.md?raw'
import schemaPrompt from './prompts/schema.md?raw'
import systemPrompt from './prompts/system.md?raw'

export type PromptCompilerMode = 'create' | 'edit' | 'repair'

export type PromptImageAttachment = {
  height?: number
  id: string
  mediaType: string
  name?: string
  width?: number
}

export type PromptUserInputHistoryEntry = {
  imageAttachments?: readonly PromptImageAttachment[]
  text: string
  turn: number
}

export type PromptCompilerInput = {
  candidateJson?: unknown
  imageAttachments?: readonly PromptImageAttachment[]
  mode: PromptCompilerMode
  scene: ManifestScene
  selectedAsset?: ManifestAsset | null
  selectedAssetAttemptContext?: string | null
  userInputHistory?: readonly PromptUserInputHistoryEntry[]
  userPrompt: string
  validationFeedback?: string | null
}

export type CompiledManifestPrompt = {
  metadata: {
    imageAttachmentCount: number
    mode: PromptCompilerMode
    selectedAssetId: string | null
  }
  system: string
  user: string
}

const modePrompts: Record<PromptCompilerMode, string> = {
  create: createAssetPrompt,
  edit: editAssetPrompt,
  repair: repairAssetPrompt,
}

export function compileManifestPrompt(
  input: PromptCompilerInput,
): CompiledManifestPrompt {
  if (input.mode === 'edit' && !input.selectedAsset) {
    throw new Error('Edit prompt compilation requires a selected asset.')
  }

  const system = joinSections([systemPrompt, schemaPrompt])
  const userInputHistory = formatUserInputHistory(input.userInputHistory ?? [])
  const user = joinSections([
    userInputHistory ? tag('user_input_history', userInputHistory) : '',
    tag('task_mode', input.mode),
    tag('task_instructions', modePrompts[input.mode].trim()),
    tag('user_prompt', normalizeUserPrompt(input.userPrompt)),
    tag('current_scene', summarizeScene(input.scene)),
    input.selectedAsset
      ? tag('selected_asset_json', stringifyJson(input.selectedAsset))
      : '',
    input.selectedAssetAttemptContext
      ? tag(
          'selected_asset_attempt_history',
          input.selectedAssetAttemptContext.trim(),
        )
      : '',
    input.candidateJson
      ? tag(
          'candidate_json',
          stringifyJson(input.candidateJson, {
            pretty: input.mode !== 'repair',
          }),
        )
      : '',
    tag(
      'image_attachments',
      formatImageAttachments(input.imageAttachments ?? []),
    ),
    input.validationFeedback
      ? tag('validation_feedback', input.validationFeedback.trim())
      : '',
    tag('examples', examplesPrompt.trim()),
    tag(
      'response_contract',
      [
        'Return exactly one Manifest3D asset JSON object.',
        'Do not include markdown fences, comments, prose, or multiple candidates.',
      ].join('\n'),
    ),
  ])

  return {
    metadata: {
      imageAttachmentCount: input.imageAttachments?.length ?? 0,
      mode: input.mode,
      selectedAssetId: input.selectedAsset?.id ?? null,
    },
    system,
    user,
  }
}

function summarizeScene(scene: ManifestScene) {
  if (scene.assets.length === 0) {
    return `schemaVersion=${scene.schemaVersion}\nunits=${scene.units}\nassets=0`
  }

  return [
    `schemaVersion=${scene.schemaVersion}`,
    `units=${scene.units}`,
    `assets=${scene.assets.length}`,
    ...scene.assets.map(
      (asset) =>
        `- assetId=${asset.id} name=${JSON.stringify(asset.name)} parts=${asset.parts.length} joints=${asset.joints.length} checks=${asset.checks.length}`,
    ),
  ].join('\n')
}

function formatImageAttachments(
  attachments: readonly PromptImageAttachment[],
) {
  if (attachments.length === 0) {
    return 'none'
  }

  return attachments
    .map((attachment) => {
      const dimensions =
        attachment.width && attachment.height
          ? ` dimensions=${attachment.width}x${attachment.height}`
          : ''
      const name = attachment.name ? ` name=${JSON.stringify(attachment.name)}` : ''

      return `- id=${attachment.id} mediaType=${attachment.mediaType}${name}${dimensions}`
    })
    .join('\n')
}

function formatUserInputHistory(
  history: readonly PromptUserInputHistoryEntry[],
) {
  if (history.length === 0) {
    return ''
  }

  return history
    .map((entry) =>
      [
        `turn=${entry.turn}`,
        `text=${JSON.stringify(normalizeUserPrompt(entry.text))}`,
        'image_attachments:',
        formatImageAttachments(entry.imageAttachments ?? []),
      ].join('\n'),
    )
    .join('\n\n')
}

function normalizeUserPrompt(userPrompt: string) {
  const trimmed = userPrompt.trim()

  return trimmed.length > 0 ? trimmed : '(empty user prompt)'
}

function stringifyJson(
  value: unknown,
  options: {
    pretty?: boolean
  } = {},
) {
  return JSON.stringify(value, null, options.pretty === false ? 0 : 2)
}

function tag(name: string, content: string) {
  return `<${name}>\n${content}\n</${name}>`
}

function joinSections(sections: readonly string[]) {
  return sections
    .map((section) => section.trim())
    .filter((section) => section.length > 0)
    .join('\n\n')
}
