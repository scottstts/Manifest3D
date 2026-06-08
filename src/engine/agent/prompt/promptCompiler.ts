import type { ManifestAsset, ManifestScene } from '../../schema/manifestTypes'
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
  omitCandidateJson?: boolean
  omitSelectedAssetJson?: boolean
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
    input.selectedAsset && !input.omitSelectedAssetJson
      ? tag('selected_asset_json', stringifyJson(input.selectedAsset))
      : '',
    input.selectedAssetAttemptContext
      ? tag(
          'selected_asset_attempt_history',
          input.selectedAssetAttemptContext.trim(),
        )
      : '',
    input.candidateJson && !input.omitCandidateJson
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
    tag('examples', formatExamples(input.mode)),
    tag('response_contract', formatResponseContract(input.mode)),
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

function formatResponseContract(mode: PromptCompilerMode) {
  if (mode === 'create') {
    return [
      'Return exactly one complete Manifest3D asset JSON object.',
      'The response root must be the asset itself with `schemaVersion`, `id`, `name`, `prompt`, `units`, `parts`, `joints`, `controls`, `materials`, `checks`, `allowances`, and `metadata`.',
      'Do not wrap the asset in `tool`, `argumentsJson`, `asset`, `assets`, `manifest`, or `candidate`.',
      'Do not include markdown fences, comments, prose, or multiple candidates.',
    ].join('\n')
  }

  return [
    'Return exactly one JSON object with `tool` and `operations`.',
    '`tool` must be `apply_manifest_patch`.',
    '`operations` must be an array of focused JSON Patch operations.',
    'Each operation must use `op`, `path`, and `valueJson`.',
    '`valueJson` must be JSON.stringify of the exact add/replace value. For remove, set `valueJson` to "null".',
    'Allowed operations are `add`, `replace`, and `remove`.',
    'Patch the current canonical asset into the revised complete asset; do not return a full asset.',
    'Use focused nested operations whose `path` starts with `/` and points inside the current candidate JSON.',
    'Never use root path "", `/asset`, `/assets`, `/manifest`, or `/candidate`; the current candidate JSON is already the document root.',
    'Do not replace the whole asset to fix schema or validation errors; patch only the invalid fields, arrays, checks, allowances, transforms, or visuals.',
    'Do not paste a complete Manifest3D asset object as a nested replacement value.',
    'Never write authored check descriptors such as `part_exists`, `joint_exists`, or `expect_*` into a visual `geometry` field; checks belong under `/checks`.',
    'Never write allowance descriptors such as `allow_overlap`, `allow_isolated_part`, `allow_*`, `reason`, `partAId`, `partBId`, `visualAId`, or `visualBId` into a visual `geometry` field; allowances belong under `/allowances`.',
    'When replacing a visual `geometry`, encode a valid primitive geometry descriptor in `valueJson`.',
    'Do not return template, example, todo, placeholder, or dummy patch values; every operation must use concrete current-candidate ids and valid values.',
    'Do not include markdown fences, comments, prose, or multiple candidates.',
  ].join('\n')
}

function formatExamples(mode: PromptCompilerMode) {
  if (mode === 'create') {
    return [
      examplesPrompt.trim(),
      '',
      '# Create Response Shape',
      '',
      'The examples above show the Manifest3D asset shape. Return the final asset as the response root.',
      '',
      '```json',
      JSON.stringify(
        {
          allowances: [],
          checks: [],
          controls: [],
          id: 'example-asset',
          joints: [],
          materials: [
            {
              color: '#88909a',
              emission: null,
              emissionAnimation: null,
              id: 'example-metal',
              metalness: 0.4,
              name: 'brushed metal',
              opacity: 1,
              roughness: 0.35,
              side: 'front',
            },
          ],
          metadata: {
            createdAt: '2026-01-01T00:00:00.000Z',
            generationStatus: 'ready',
            sourceImageIds: [],
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          name: 'Example Asset',
          parts: [
            {
              description: 'A simple supported body.',
              id: 'example-body',
              name: 'body',
              role: 'base',
              visuals: [
                {
                  geometry: {
                    size: [1, 0.4, 0.6],
                    type: 'box',
                  },
                  id: 'example-body-box',
                  materialId: 'example-metal',
                  name: 'body box',
                  transform: {
                    position: [0, 0, 0],
                    rotation: [0, 0, 0],
                    scale: [1, 1, 1],
                  },
                },
              ],
            },
          ],
          prompt: 'example asset',
          schemaVersion: 2,
          units: 'meters',
        },
        null,
        2,
      ),
      '```',
    ].join('\n')
  }

  return [
    '# Patch Tool Example',
    '',
    'Return only a compact patch tool object. Do not return a complete Manifest3D asset or a root-level replacement.',
    '',
    '```json',
    JSON.stringify(
      {
        operations: [
          {
            op: 'replace',
            path: '/parts/byId/rotor/visuals/byId/rotor-blade-01/transform/position',
            valueJson: JSON.stringify([0, 0.18, 0]),
          },
          {
            op: 'add',
            path: '/checks/-',
            valueJson: JSON.stringify({
              side: 'double',
              type: 'expect_material_side',
              visualId: 'cutaway-shell',
            }),
          },
        ],
        tool: 'apply_manifest_patch',
      },
      null,
      2,
    ),
    '```',
    '',
    'If a visual geometry path is wrong, replace it with a primitive geometry descriptor. If an authored check is missing, add it under `/checks/-`. Never wrap paths under `/asset` or `/assets`.',
  ].join('\n')
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
