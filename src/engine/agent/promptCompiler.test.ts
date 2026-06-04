import { describe, expect, it } from 'vitest'
import { createValidValidationFixtureAsset } from '../testing/validationFixtureAsset'
import { parseManifestAsset } from '../schema/manifestSchema'
import type { ManifestScene } from '../schema/manifestTypes'
import { compileManifestPrompt } from './promptCompiler'
import examplesPrompt from './prompts/examples.md?raw'

const emptyScene: ManifestScene = {
  assets: [],
  schemaVersion: 1,
  units: 'meters',
}

describe('compileManifestPrompt', () => {
  it('composes create prompts from prompt files, scene summary, user text, images, and examples', () => {
    const compiled = compileManifestPrompt({
      imageAttachments: [
        {
          height: 480,
          id: 'ref-front',
          mediaType: 'image/png',
          name: 'front reference',
          width: 640,
        },
      ],
      mode: 'create',
      scene: emptyScene,
      userPrompt: 'Create a hinged utility crate.',
    })

    expect(compiled.system).toContain('Manifest3D Author')
    expect(compiled.system).toContain('Manifest3D Contract V2')
    expect(compiled.system).toContain('Realistic geometry is the dominant quality bar')
    expect(compiled.system).toContain('roundedBox')
    expect(compiled.system).toContain('Multi-joint assets must not rely')
    expect(compiled.system).toContain('fan blades inside wire grilles')
    expect(compiled.system).toContain('blade visibly rooted')
    expect(compiled.system).toContain('Pair each `allow_overlap`')
    expect(compiled.user).toContain('Create a complete Manifest3D asset')
    expect(compiled.user).toContain("Model the object's real construction logic")
    expect(compiled.user).toContain('controls must cover every movable joint')
    expect(compiled.user).toContain('stationary guard bars')
    expect(compiled.user).toContain('<current_scene>')
    expect(compiled.user).toContain('assets=0')
    expect(compiled.user).toContain('Create a hinged utility crate.')
    expect(compiled.user).toContain('id=ref-front mediaType=image/png')
    expect(compiled.user).toContain('Example Hinged Box')
    expect(compiled.metadata).toEqual({
      imageAttachmentCount: 1,
      mode: 'create',
      selectedAssetId: null,
    })
  })

  it('requires and includes selected asset JSON for edit prompts', () => {
    const selectedAsset = createValidValidationFixtureAsset()
    const scene: ManifestScene = {
      ...emptyScene,
      assets: [selectedAsset],
    }

    expect(() =>
      compileManifestPrompt({
        mode: 'edit',
        scene,
        userPrompt: 'Make the lid thicker.',
      }),
    ).toThrow('selected asset')

    const compiled = compileManifestPrompt({
      mode: 'edit',
      scene,
      selectedAsset,
      selectedAssetAttemptContext:
        'versionId=validation-crate:v1 attempts=2 latestStatus=success',
      userPrompt: 'Make the lid thicker.',
    })

    expect(compiled.user).toContain('Revise the selected Manifest3D asset')
    expect(compiled.user).toContain('physical support paths')
    expect(compiled.user).toContain('<selected_asset_json>')
    expect(compiled.user).toContain('<selected_asset_attempt_history>')
    expect(compiled.user).toContain('versionId=validation-crate:v1')
    expect(compiled.user).toContain('"id": "validation-crate"')
    expect(compiled.metadata.selectedAssetId).toBe('validation-crate')
  })

  it('prepends accumulated user input history ahead of the existing edit context', () => {
    const selectedAsset = createValidValidationFixtureAsset()
    const scene: ManifestScene = {
      ...emptyScene,
      assets: [selectedAsset],
    }
    const compiled = compileManifestPrompt({
      imageAttachments: [
        {
          id: 'ref-current',
          mediaType: 'image/png',
          name: 'current.png',
        },
      ],
      mode: 'edit',
      scene,
      selectedAsset,
      userInputHistory: [
        {
          imageAttachments: [
            {
              height: 480,
              id: 'ref-initial',
              mediaType: 'image/png',
              name: 'initial.png',
              width: 640,
            },
          ],
          text: 'Initial object request.',
          turn: 0,
        },
        {
          imageAttachments: [],
          text: 'Make the lid thicker.',
          turn: 1,
        },
      ],
      userPrompt: 'Make the lid thicker.',
    })

    expect(compiled.user.indexOf('<user_input_history>')).toBeLessThan(
      compiled.user.indexOf('<task_mode>'),
    )
    expect(compiled.user).toContain('turn=0')
    expect(compiled.user).toContain('text="Initial object request."')
    expect(compiled.user).toContain(
      'id=ref-initial mediaType=image/png name="initial.png" dimensions=640x480',
    )
    expect(compiled.user).toContain('turn=1')
    expect(compiled.user).toContain('text="Make the lid thicker."')
    expect(compiled.user).toContain('id=ref-current mediaType=image/png')
  })

  it('includes candidate JSON and validation feedback for repair prompts', () => {
    const candidate = createValidValidationFixtureAsset()
    const compiled = compileManifestPrompt({
      candidateJson: candidate,
      mode: 'repair',
      scene: emptyScene,
      userPrompt: 'Repair the candidate.',
      validationFeedback:
        '<validation_signals>\n<summary>failed</summary>\n</validation_signals>',
    })

    expect(compiled.user).toContain('Repair the candidate using the validation feedback')
    expect(compiled.user).toContain('If a failure repeats')
    expect(compiled.user).toContain('missing controls')
    expect(compiled.user).toContain('moving rotor/blade/wheel')
    expect(compiled.user).toContain('<candidate_json>')
    expect(compiled.user).toContain('<validation_feedback>')
    expect(compiled.user).toContain('<validation_signals>')
    expect(compiled.user).toContain('<candidate_json>\n{"schemaVersion":2')
    expect(compiled.user).toContain('top-level `patch` array')
    expect(compiled.user).toContain('Repair Patch Example')
    expect(compiled.user).toContain('/checks/-')
    expect(compiled.user).toContain('Do not paste a complete Manifest3D asset object')
    expect(compiled.user).toContain('Never write authored check descriptors')
    expect(compiled.user).toContain('Never write allowance descriptors')
    expect(compiled.user).toContain('allow_overlap')
    expect(compiled.user).toContain('allowances belong under `/allowances`')
    expect(compiled.user).toContain('valid primitive geometry descriptor')
    expect(compiled.user).toContain('dummy patch values')
    expect(compiled.user).toContain('placeholder reference ids')
    expect(compiled.user).toContain('`dummy`')
    expect(compiled.user).not.toContain('Example Hinged Box')
  })

  it('keeps the compact example parseable as Contract V2 JSON', () => {
    const exampleJson = extractFirstJsonCodeBlock(examplesPrompt)

    expect(parseManifestAsset(JSON.parse(exampleJson))).toMatchObject({
      id: 'example-hinged-box',
      metadata: {
        generationStatus: 'ready',
      },
      schemaVersion: 2,
    })
  })
})

function extractFirstJsonCodeBlock(markdown: string) {
  const match = markdown.match(/```json\s*([\s\S]*?)```/)

  if (!match) {
    throw new Error('Expected examples prompt to contain a JSON code block.')
  }

  return match[1]
}
