import { describe, expect, it } from 'vitest'
import {
  agentSessionContextLimitTokens,
  createAgentSessionTracker,
  estimateAgentRequestInputTokens,
  getSafeInputTokenLimit,
} from './agentSession'

describe('createAgentSessionTracker', () => {
  it('persists normalized replay exchanges without full compiled prompts', () => {
    const tracker = createAgentSessionTracker({
      now: createNow(),
      providerContext: {
        modelId: 'openai/gpt-5.5',
        provider: 'openrouter',
        reasoningEffort: 'high',
      },
      runId: 'run-1',
    })

    tracker.prepareRequest({
      candidateJson: undefined,
      prompt: {
        metadata: {
          imageAttachmentCount: 0,
          mode: 'create',
          selectedAssetId: null,
        },
        system: 'large stable system prompt',
        user: '<task_mode>create</task_mode><schema>very large schema</schema>',
      },
      replayContent: 'a professional astronomical telescope',
      validationFeedback: null,
    })
    tracker.recordModelResponse({
      candidate: {
        argumentsJson: '{"asset":{"schemaVersion":2}}',
        tool: 'submit_manifest_asset',
      },
      providerResponseId: 'resp-1',
      rawText: '{"tool":"submit_manifest_asset"}',
    })
    tracker.recordHarnessFeedback({
      content: 'validation failed: missing tripod leg contact',
      mode: 'repair',
    })
    tracker.finish({
      candidate: {
        id: 'telescope',
        schemaVersion: 2,
      },
      status: 'complete',
    })

    const session = tracker.getSnapshot().sessions[0]

    expect(session).toMatchObject({
      latestProviderResponseId: 'resp-1',
      modelId: 'openai/gpt-5.5',
      provider: 'openrouter',
      status: 'complete',
    })
    expect(session?.exchanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: 'a professional astronomical telescope',
          kind: 'user',
        }),
        expect.objectContaining({
          content: 'validation failed: missing tripod leg contact',
          kind: 'harness_feedback',
        }),
      ]),
    )
    expect(JSON.stringify(session)).not.toContain('very large schema')
  })

  it('reuses matching parent Gemini cachedContent metadata', () => {
    const parentTracker = createAgentSessionTracker({
      now: createNow(),
      providerContext: {
        modelId: 'gemini-flash-latest',
        provider: 'gemini',
        reasoningEffort: 'high',
      },
      runId: 'parent-run',
    })

    parentTracker.prepareRequest({
      candidateJson: undefined,
      prompt: {
        metadata: {
          imageAttachmentCount: 0,
          mode: 'create',
          selectedAssetId: null,
        },
        system: 'system',
        user: 'create prompt',
      },
      replayContent: 'create prompt',
      validationFeedback: null,
    })
    parentTracker.recordModelResponse({
      candidate: {
        argumentsJson: '{"asset":{"schemaVersion":2}}',
        tool: 'submit_manifest_asset',
      },
      providerState: {
        geminiCachedContent: {
          cacheExpiresAt: '2026-06-04T01:00:00.000Z',
          cachedContentName: 'cachedContents/parent-cache',
          cacheKey: 'stable-cache-key',
          modelId: 'gemini-flash-latest',
          provider: 'gemini',
          sourceMediaIds: ['ref-1'],
        },
      },
      providerResponseId: 'interaction-1',
      rawText: '{}',
    })

    const childTracker = createAgentSessionTracker({
      now: createNow(),
      parentSessions: parentTracker.getSnapshot().sessions,
      providerContext: {
        modelId: 'gemini-flash-latest',
        provider: 'gemini',
        reasoningEffort: 'high',
      },
      runId: 'child-run',
    })
    const prepared = childTracker.prepareRequest({
      candidateJson: undefined,
      geminiCache: {
        cacheKey: 'stable-cache-key',
        sourceMediaIds: ['ref-1'],
        stablePrompt: {
          metadata: {
            imageAttachmentCount: 0,
            mode: 'create',
            selectedAssetId: null,
          },
          system: 'system',
          user: 'stable prompt',
        },
      },
      prompt: {
        metadata: {
          imageAttachmentCount: 0,
          mode: 'create',
          selectedAssetId: null,
        },
        system: 'system',
        user: 'cached delta',
      },
      replayContent: 'create prompt',
      validationFeedback: null,
    })

    expect(childTracker.getPreviousProviderResponseId()).toBeNull()
    expect(childTracker.getSnapshot().sessions[0]?.parentSessionId).toBe(
      'parent-run:session:1',
    )
    expect(prepared).toMatchObject({
      geminiCachedContent: {
        cachedContentName: 'cachedContents/parent-cache',
        cacheKey: 'stable-cache-key',
        sourceMediaIds: ['ref-1'],
      },
      previousProviderResponseId: null,
    })
  })

  it('persists OpenRouter response ids without using them for server-side continuation', () => {
    const tracker = createAgentSessionTracker({
      now: createNow(),
      providerContext: {
        modelId: 'openai/gpt-5.5',
        provider: 'openrouter',
        reasoningEffort: 'high',
      },
      runId: 'openrouter-run',
    })

    tracker.recordModelResponse({
      candidate: {
        argumentsJson: '{"asset":{"schemaVersion":2}}',
        tool: 'submit_manifest_asset',
      },
      providerResponseId: 'gen-openrouter-1',
      rawText: '{}',
    })

    const preparedRepair = tracker.prepareRequest({
      candidateJson: {
        id: 'telescope',
        schemaVersion: 2,
      },
      prompt: {
        metadata: {
          imageAttachmentCount: 0,
          mode: 'repair',
          selectedAssetId: null,
        },
        system: 'system',
        user: 'repair prompt with candidate_json',
      },
      replayContent: 'repair feedback',
      validationFeedback: 'repair feedback',
    })
    const session = tracker.getSnapshot().sessions[0]

    expect(session?.latestProviderResponseId).toBe('gen-openrouter-1')
    expect(tracker.getPreviousProviderResponseId()).toBeNull()
    expect(preparedRepair).toMatchObject({
      includeCandidateJson: true,
      previousProviderResponseId: null,
      sessionId: 'openrouter-run:session:1',
    })
  })

  it('does not reuse OpenRouter parent sessions as provider-side continuation', () => {
    const parentTracker = createAgentSessionTracker({
      now: createNow(),
      providerContext: {
        modelId: 'openai/gpt-5.5',
        provider: 'openrouter',
        reasoningEffort: 'high',
      },
      runId: 'parent-openrouter',
    })

    parentTracker.recordModelResponse({
      candidate: {
        argumentsJson: '{"asset":{"schemaVersion":2}}',
        tool: 'submit_manifest_asset',
      },
      providerResponseId: 'gen-openrouter-parent',
      rawText: '{}',
    })

    const childTracker = createAgentSessionTracker({
      now: createNow(),
      parentSessions: parentTracker.getSnapshot().sessions,
      providerContext: {
        modelId: 'openai/gpt-5.5',
        provider: 'openrouter',
        reasoningEffort: 'high',
      },
      runId: 'child-openrouter',
    })

    expect(childTracker.getPreviousProviderResponseId()).toBeNull()
    expect(childTracker.getSnapshot().sessions[0]?.parentSessionId).toBeNull()
  })


  it('uses the compiled prompt, not just replay text, for continuation budgeting', () => {
    const safeInputTokenLimit = getSafeInputTokenLimit({ maxOutputTokens: 64_000 })
    const parentSession = {
      assetId: null,
      contextBufferTokens: 64_000,
      contextLimitTokens: agentSessionContextLimitTokens,
      createdAt: '2026-06-04T00:00:00.000Z',
      exchanges: [],
      latestAssetFingerprint: null,
      latestProviderResponseId: 'resp-near-limit',
      modelId: 'gpt-5.5',
      parentSessionId: null,
      provider: 'openai' as const,
      reasoningEffort: 'high',
      sessionId: 'parent:session:1',
      status: 'active' as const,
      tokenEstimate: safeInputTokenLimit - 10,
      updatedAt: '2026-06-04T00:00:00.000Z',
    }
    const tracker = createAgentSessionTracker({
      now: createNow(),
      parentSessions: [parentSession],
      providerContext: {
        maxOutputTokens: 64_000,
        modelId: 'gpt-5.5',
        provider: 'openai',
        reasoningEffort: 'high',
      },
      runId: 'child-near-limit',
    })
    const prompt = {
      metadata: {
        imageAttachmentCount: 0,
        mode: 'repair' as const,
        selectedAssetId: null,
      },
      system: 'system',
      user: 'x'.repeat(80),
    }

    expect(tracker.shouldStartContinuation({ prompt })).toBe(true)

    const prepared = tracker.prepareRequest({
      candidateJson: { id: 'candidate', schemaVersion: 2 },
      prompt,
      replayContent: 'tiny repair feedback',
      validationFeedback: 'tiny repair feedback',
    })

    expect(prepared).toMatchObject({
      includeCandidateJson: true,
      previousProviderResponseId: null,
      status: 'ready',
    })
    expect(tracker.getSnapshot().sessions).toHaveLength(2)
  })

  it('does not accumulate prior OpenRouter request estimates when checking a stateless provider', () => {
    const tracker = createAgentSessionTracker({
      now: createNow(),
      providerContext: {
        maxOutputTokens: 64_000,
        modelId: 'openai/gpt-5.5',
        provider: 'openrouter',
        reasoningEffort: 'high',
      },
      runId: 'openrouter-stateless-budget',
    })
    const prompt = {
      metadata: {
        imageAttachmentCount: 0,
        mode: 'repair' as const,
        selectedAssetId: null,
      },
      system: 'system',
      user: 'x'.repeat(8_000),
    }

    for (let index = 0; index < 5; index += 1) {
      const prepared = tracker.prepareRequest({
        candidateJson: { id: `candidate-${index}`, schemaVersion: 2 },
        prompt,
        replayContent: `repair feedback ${index}`,
        validationFeedback: `repair feedback ${index}`,
      })

      expect(prepared.status).toBe('ready')
      tracker.recordModelResponse({
        candidate: {
          operations: [],
          tool: 'apply_manifest_patch',
        },
        providerResponseId: `or-${index}`,
        rawText: '{}',
      })
    }

    const snapshot = tracker.getSnapshot().sessions

    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]?.tokenEstimate).toBe(
      estimateAgentRequestInputTokens({ prompt }) + 1,
    )
  })

  it('returns a preflight context error for a single request that cannot fit a fresh context', () => {
    const tracker = createAgentSessionTracker({
      now: createNow(),
      providerContext: {
        maxOutputTokens: 64_000,
        modelId: 'openai/gpt-5.5',
        provider: 'openrouter',
        reasoningEffort: 'high',
      },
      runId: 'openrouter-too-large',
    })
    const prompt = {
      metadata: {
        imageAttachmentCount: 0,
        mode: 'repair' as const,
        selectedAssetId: null,
      },
      system: 'system',
      user: 'x'.repeat((getSafeInputTokenLimit({ maxOutputTokens: 64_000 }) + 1) * 4),
    }

    const prepared = tracker.prepareRequest({
      candidateJson: { id: 'too-large', schemaVersion: 2 },
      prompt,
      replayContent: 'tiny repair feedback',
      validationFeedback: 'tiny repair feedback',
    })

    expect(prepared).toMatchObject({
      contextLimitTokens: 256_000,
      safeInputTokenLimit: 192_000,
      status: 'context_exceeded',
    })
    if (prepared.status !== 'context_exceeded') {
      throw new Error('Expected preflight context budget failure.')
    }
    expect(prepared.message).toContain('stopped before sending')
  })
})

function createNow() {
  let tick = 0

  return () => {
    tick += 1
    return `2026-06-04T00:00:${String(tick).padStart(2, '0')}.000Z`
  }
}
