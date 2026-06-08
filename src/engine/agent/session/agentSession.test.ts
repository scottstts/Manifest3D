import { describe, expect, it } from 'vitest'
import { createAgentSessionTracker } from './agentSession'

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

  it('continues from a matching parent provider response id', () => {
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

    expect(childTracker.getPreviousProviderResponseId()).toBe('interaction-1')
    expect(childTracker.getSnapshot().sessions[0]?.parentSessionId).toBe(
      'parent-run:session:1',
    )
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
})

function createNow() {
  let tick = 0

  return () => {
    tick += 1
    return `2026-06-04T00:00:${String(tick).padStart(2, '0')}.000Z`
  }
}
