import { describe, expect, it } from 'vitest'
import { createValidValidationFixtureAsset } from '../examples/validationFixtures'
import type { ManifestScene } from '../schema/manifestTypes'
import { compileManifestPrompt } from './promptCompiler'

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
    expect(compiled.system).toContain('Pair each `allow_overlap`')
    expect(compiled.user).toContain('Create a complete Manifest3D asset')
    expect(compiled.user).toContain("Model the object's real construction logic")
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
      userPrompt: 'Make the lid thicker.',
    })

    expect(compiled.user).toContain('Revise the selected Manifest3D asset')
    expect(compiled.user).toContain('physical support paths')
    expect(compiled.user).toContain('<selected_asset_json>')
    expect(compiled.user).toContain('"id": "validation-crate"')
    expect(compiled.metadata.selectedAssetId).toBe('validation-crate')
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
    expect(compiled.user).toContain('<candidate_json>')
    expect(compiled.user).toContain('<validation_feedback>')
    expect(compiled.user).toContain('<validation_signals>')
  })
})
