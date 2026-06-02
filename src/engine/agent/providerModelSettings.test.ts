import { describe, expect, it } from 'vitest'
import {
  createDefaultProviderModelSettings,
  createGeminiModelConfig,
  createOpenAIModelConfig,
  parseProviderModelSettings,
  resetProviderModelId,
  resetProviderReasoningEffort,
  serializeProviderModelSettings,
  updateProviderModelId,
  updateProviderReasoningEffort,
} from './providerModelSettings'

describe('provider model settings', () => {
  it('starts from provider-specific modelConfig defaults', () => {
    expect(createDefaultProviderModelSettings()).toEqual({
      gemini: {
        modelId: 'gemini-flash-latest',
        reasoningEffort: 'high',
      },
      openai: {
        modelId: 'gpt-5.5',
        reasoningEffort: 'high',
      },
    })
  })

  it('parses cached per-provider model IDs and reasoning effort', () => {
    expect(
      parseProviderModelSettings(
        JSON.stringify({
          gemini: {
            modelId: 'gemini-custom',
            reasoningEffort: 'minimal',
          },
          openai: {
            modelId: 'gpt-custom',
            reasoningEffort: 'xhigh',
          },
        }),
      ),
    ).toEqual({
      gemini: {
        modelId: 'gemini-custom',
        reasoningEffort: 'minimal',
      },
      openai: {
        modelId: 'gpt-custom',
        reasoningEffort: 'xhigh',
      },
    })
  })

  it('falls back per field for missing, invalid, or crossed-provider cached values', () => {
    expect(
      parseProviderModelSettings({
        gemini: {
          modelId: 'gemini-custom',
          reasoningEffort: 'xhigh',
        },
        openai: {
          reasoningEffort: 'minimal',
        },
      }),
    ).toEqual({
      gemini: {
        modelId: 'gemini-custom',
        reasoningEffort: 'high',
      },
      openai: {
        modelId: 'gpt-5.5',
        reasoningEffort: 'high',
      },
    })
  })

  it('resets model ID and reasoning effort independently', () => {
    const customSettings = updateProviderReasoningEffort(
      updateProviderModelId(
        createDefaultProviderModelSettings(),
        'openai',
        'gpt-custom',
      ),
      'openai',
      'low',
    )

    expect(resetProviderModelId(customSettings, 'openai').openai).toEqual({
      modelId: 'gpt-5.5',
      reasoningEffort: 'low',
    })
    expect(resetProviderReasoningEffort(customSettings, 'openai').openai).toEqual({
      modelId: 'gpt-custom',
      reasoningEffort: 'high',
    })
  })

  it('maps shared settings to provider-specific runtime configs', () => {
    expect(
      createOpenAIModelConfig({
        modelId: '  gpt-custom  ',
        reasoningEffort: 'none',
      }),
    ).toMatchObject({
      model: 'gpt-custom',
      reasoningEffort: 'none',
    })
    expect(
      createGeminiModelConfig({
        modelId: '  gemini-custom  ',
        reasoningEffort: 'minimal',
      }),
    ).toMatchObject({
      model: 'gemini-custom',
      thinkingLevel: 'minimal',
    })
  })

  it('serializes settings for localStorage', () => {
    expect(
      parseProviderModelSettings(
        serializeProviderModelSettings({
          gemini: {
            modelId: 'gemini-custom',
            reasoningEffort: 'minimal',
          },
          openai: {
            modelId: 'gpt-custom',
            reasoningEffort: 'xhigh',
          },
        }),
      ),
    ).toEqual({
      gemini: {
        modelId: 'gemini-custom',
        reasoningEffort: 'minimal',
      },
      openai: {
        modelId: 'gpt-custom',
        reasoningEffort: 'xhigh',
      },
    })
  })
})
