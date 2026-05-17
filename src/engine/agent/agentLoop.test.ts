import { describe, expect, it } from 'vitest'
import {
  createInvalidValidationFixtureAsset,
  createValidValidationFixtureAsset,
} from '../examples/validationFixtures'
import { createSceneStore } from '../scene/sceneStore'
import type { ManifestScene } from '../schema/manifestTypes'
import {
  runManifestAgentLoop,
  type AgentLoopEvent,
} from './agentLoop'
import type {
  AgentRequest,
  AgentResponse,
  OpenAIManifestClient,
} from './providerClient'

const emptyScene: ManifestScene = {
  assets: [],
  schemaVersion: 1,
  units: 'meters',
}

describe('runManifestAgentLoop', () => {
  it('retries invalid candidates with repair feedback and commits only the valid candidate', async () => {
    const requests: AgentRequest[] = []
    const events: AgentLoopEvent[] = []
    const sceneStore = createSceneStore(emptyScene)
    const client = createQueuedClient(
      [
        {
          candidate: createInvalidValidationFixtureAsset(),
          rawText: '{}',
          responseId: 'resp_invalid',
          status: 'ok',
        },
        {
          candidate: createValidValidationFixtureAsset(),
          rawText: '{}',
          responseId: 'resp_valid',
          status: 'ok',
        },
      ],
      requests,
    )

    const result = await runManifestAgentLoop(
      {
        mode: 'create',
        runId: 'run-repair',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        onEvent: (event) => events.push(event),
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(sceneStore.getSnapshot().scene.assets.map((asset) => asset.id)).toEqual([
      'validation-crate',
    ])
    expect(result.history.attempts.map((attempt) => attempt.status)).toEqual([
      'failure',
      'success',
    ])
    expect(requests.map((request) => request.prompt.metadata.mode)).toEqual([
      'create',
      'repair',
    ])
    expect(requests[1].prompt.user).toContain('<validation_signals>')
    expect(events.map((event) => event.state)).toEqual(
      expect.arrayContaining([
        'compiling_prompt',
        'requesting_model',
        'parsing_candidate',
        'validating_candidate',
        'repairing',
        'committing',
        'ready',
      ]),
    )
  })

  it('stops after the configured repair turn cap without committing', async () => {
    const sceneStore = createSceneStore(emptyScene)
    const client = createQueuedClient([
      {
        candidate: createInvalidValidationFixtureAsset(),
        rawText: '{}',
        responseId: 'resp_invalid_1',
        status: 'ok',
      },
      {
        candidate: createInvalidValidationFixtureAsset(),
        rawText: '{}',
        responseId: 'resp_invalid_2',
        status: 'ok',
      },
    ])

    const result = await runManifestAgentLoop(
      {
        maxRepairTurns: 1,
        mode: 'create',
        runId: 'run-cap',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('failed')
    expect(sceneStore.getSnapshot().scene.assets).toHaveLength(0)
    expect(result.history.attempts).toHaveLength(2)
    expect(result.history.canReportReady).toBe(false)
  })

  it('surfaces missing-key unavailable state without recording attempts or changing the scene', async () => {
    const sceneStore = createSceneStore(emptyScene)
    const client: OpenAIManifestClient = {
      async generateAsset() {
        return {
          message:
            'Generation is unavailable because VITE_OPENAI_API_KEY is not set.',
          reason: 'missing_api_key',
          status: 'unavailable',
        }
      },
    }

    const result = await runManifestAgentLoop(
      {
        mode: 'create',
        runId: 'run-missing-key',
        scene: emptyScene,
        userPrompt: 'Create a small box.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('unavailable')
    expect(result.history.attempts).toHaveLength(0)
    expect(sceneStore.getSnapshot().scene.assets).toHaveLength(0)
  })

  it('reports cancellation after an in-flight model request is aborted', async () => {
    const controller = new AbortController()
    const events: AgentLoopEvent[] = []
    const sceneStore = createSceneStore(emptyScene)
    const client: OpenAIManifestClient = {
      async generateAsset() {
        controller.abort()

        return {
          message: 'The request was aborted.',
          responseId: null,
          status: 'error',
        }
      },
    }

    const result = await runManifestAgentLoop(
      {
        mode: 'create',
        runId: 'run-cancel',
        scene: emptyScene,
        signal: controller.signal,
        userPrompt: 'Create a small box.',
      },
      {
        client,
        onEvent: (event) => events.push(event),
        sceneStore,
      },
    )

    expect(result.status).toBe('cancelled')
    expect(sceneStore.getSnapshot().scene.assets).toHaveLength(0)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Request candidate',
          state: 'requesting_model',
          status: 'skipped',
        }),
        expect.objectContaining({
          label: 'Agent run cancelled',
          state: 'cancelled',
          status: 'skipped',
        }),
      ]),
    )
  })
})

function createQueuedClient(
  responses: AgentResponse[],
  requests: AgentRequest[] = [],
): OpenAIManifestClient {
  return {
    async generateAsset(request) {
      requests.push(request)

      return (
        responses.shift() ?? {
          message: 'No queued response.',
          responseId: null,
          status: 'error',
        }
      )
    },
  }
}
