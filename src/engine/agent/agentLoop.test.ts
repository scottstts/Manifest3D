import { describe, expect, it } from 'vitest'
import {
  createInvalidValidationFixtureAsset,
  createValidValidationFixtureAsset,
} from '../examples/validationFixtures'
import { createSceneStore } from '../scene/sceneStore'
import type { ManifestScene } from '../schema/manifestTypes'
import {
  defaultRepairTurnCap,
  runManifestAgentLoop,
  type AgentLoopEvent,
} from './agentLoop'
import { createCandidateHistory } from './candidateHistory'
import type {
  AgentRequest,
  AgentResponse,
  ManifestProviderClient,
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
          candidate: replaceRootPatch(createValidValidationFixtureAsset()),
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

  it('makes each recorded validation attempt available when the validate step finishes', async () => {
    const sceneStore = createSceneStore(emptyScene)
    const history = createCandidateHistory()
    const observedAttemptCounts: number[] = []
    const client = createQueuedClient([
      {
        candidate: createInvalidValidationFixtureAsset(),
        rawText: '{}',
        responseId: 'resp_invalid',
        status: 'ok',
      },
      {
        candidate: replaceRootPatch(createValidValidationFixtureAsset()),
        rawText: '{}',
        responseId: 'resp_valid',
        status: 'ok',
      },
    ])

    const result = await runManifestAgentLoop(
      {
        mode: 'create',
        runId: 'run-live-attempts',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        history,
        onEvent: (event) => {
          if (
            event.state === 'validating_candidate' &&
            event.status !== 'running'
          ) {
            observedAttemptCounts.push(history.getSnapshot().attempts.length)
          }
        },
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(observedAttemptCounts).toEqual([1, 2])
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
        candidate: replaceRootPatch(createInvalidValidationFixtureAsset()),
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

  it('rejects schema-invalid repair patches before recording a new attempt', async () => {
    const requests: AgentRequest[] = []
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
          candidate: {
            patch: [
              {
                op: 'replace',
                path: '/parts/0/visuals/0/transform/position',
                value: [],
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_bad_patch',
          status: 'ok',
        },
        {
          candidate: {
            patch: [
              {
                op: 'replace',
                path: '/parts/0/visuals/0/transform/position',
                value: [],
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_repeated_bad_patch',
          status: 'ok',
        },
        {
          candidate: replaceRootPatch(createValidValidationFixtureAsset()),
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
        runId: 'run-schema-invalid-patch',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(result.history.attempts.map((attempt) => attempt.status)).toEqual([
      'failure',
      'success',
    ])
    expect(requests.map((request) => request.prompt.metadata.mode)).toEqual([
      'create',
      'repair',
      'repair',
      'repair',
    ])
    expect(requests[2].prompt.user).toContain('<patch_application_error>')
    expect(requests[2].prompt.user).toContain(
      '/parts/0/visuals/0/transform/position',
    )
    expect(requests[2].prompt.user).toContain('array(length=0)')
    expect(requests[3].prompt.user).toContain(
      'This patch-application error has repeated 2 times.',
    )
    expect(requests[3].prompt.user).toContain(
      'Do not send the same rejected operation or value again.',
    )
  })

  it('uses ten repair turns by default before failing', async () => {
    const sceneStore = createSceneStore(emptyScene)
    const client = createQueuedClient(
      Array.from({ length: defaultRepairTurnCap + 1 }, (_, index) => ({
        candidate:
          index === 0
            ? createInvalidValidationFixtureAsset()
            : replaceRootPatch(createInvalidValidationFixtureAsset()),
        rawText: '{}',
        responseId: `resp_invalid_${index + 1}`,
        status: 'ok' as const,
      })),
    )

    const result = await runManifestAgentLoop(
      {
        mode: 'create',
        runId: 'run-default-cap',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(defaultRepairTurnCap).toBe(10)
    expect(result.status).toBe('failed')
    expect(sceneStore.getSnapshot().scene.assets).toHaveLength(0)
    expect(result.history.attempts).toHaveLength(defaultRepairTurnCap + 1)
    expect(result.history.canReportReady).toBe(false)
  })

  it('includes accumulated user input history and its images on every stateless request', async () => {
    const requests: AgentRequest[] = []
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
          candidate: replaceRootPatch(createValidValidationFixtureAsset()),
          rawText: '{}',
          responseId: 'resp_valid',
          status: 'ok',
        },
      ],
      requests,
    )

    const result = await runManifestAgentLoop(
      {
        imageAttachments: [
          {
            id: 'ref-current',
            imageUrl: 'data:image/png;base64,current',
            mediaType: 'image/png',
          },
        ],
        mode: 'edit',
        runId: 'run-user-history',
        scene: emptyScene,
        selectedAsset: createValidValidationFixtureAsset(),
        userInputHistory: [
          {
            imageAttachments: [
              {
                id: 'ref-initial',
                imageUrl: 'data:image/png;base64,initial',
                mediaType: 'image/png',
              },
            ],
            text: 'Initial image prompt.',
            turn: 0,
          },
          {
            imageAttachments: [
              {
                id: 'ref-current',
                imageUrl: 'data:image/png;base64,current',
                mediaType: 'image/png',
              },
            ],
            text: 'Current edit prompt.',
            turn: 1,
          },
        ],
        userPrompt: 'Current edit prompt.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(requests).toHaveLength(2)
    expect(requests.map((request) => request.prompt.metadata.mode)).toEqual([
      'edit',
      'repair',
    ])
    expect(requests[0].prompt.user).toContain('<user_input_history>')
    expect(requests[0].prompt.user).toContain('turn=0')
    expect(requests[0].prompt.user).toContain('id=ref-initial')
    expect(requests[1].prompt.user).toContain('<user_input_history>')
    expect(
      requests.map((request) =>
        request.imageAttachments?.map((attachment) => attachment.id),
      ),
    ).toEqual([
      ['ref-initial', 'ref-current'],
      ['ref-initial', 'ref-current'],
    ])
  })

  it('surfaces missing-key unavailable state without recording attempts or changing the scene', async () => {
    const sceneStore = createSceneStore(emptyScene)
    const client: ManifestProviderClient = {
      async generateAsset() {
        return {
          message: 'Generation is unavailable because no OpenAI API key is loaded.',
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
    const client: ManifestProviderClient = {
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
): ManifestProviderClient {
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

function replaceRootPatch(value: unknown) {
  return {
    patch: [
      {
        op: 'replace',
        path: '',
        value,
      },
    ],
  }
}
