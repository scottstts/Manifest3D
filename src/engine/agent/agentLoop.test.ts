import { describe, expect, it } from 'vitest'
import {
  createInvalidValidationFixtureAsset,
  createValidValidationFixtureAsset,
} from '../testing/validationFixtureAsset'
import { createSceneStore } from '../scene/sceneStore'
import type { ManifestAsset, ManifestScene } from '../schema/manifestTypes'
import {
  createValidationReport,
  createValidationSignal,
} from '../validation/reportBuilder'
import type { ManifestValidationResult } from '../validation/validateManifest'
import {
  createRelationLoopHints,
  defaultRepairTurnCap,
  runManifestAgentLoop,
  type AgentLoopEvent,
} from './agentLoop'
import {
  createCandidateHistory,
  type CandidateAttempt,
} from './candidateHistory'
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
  it('only renders relation-loop hints after relation states alternate across attempts', () => {
    const sameAttemptHints = createRelationLoopHints([
      relationLoopAttempt(1, [
        relationFailureCluster('real_overlap', 'part_overlap_current_pose'),
        relationFailureCluster('path_contact_fit', 'expect_path_contacts_failed'),
      ]),
    ])
    const alternatingAttemptHints = createRelationLoopHints([
      relationLoopAttempt(1, [
        relationFailureCluster('real_overlap', 'part_overlap_current_pose'),
      ]),
      relationLoopAttempt(2, [
        relationFailureCluster('path_contact_fit', 'expect_path_contacts_failed'),
      ]),
    ])

    expect(sameAttemptHints).toEqual([])
    expect(alternatingAttemptHints).toHaveLength(1)
    expect(alternatingAttemptHints[0]).toContain('crankshaft<->timing-chain')
  })

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
    const repairRequestProgressLabels: string[][] = []
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
        onProgress: (progress) => {
          const requestCandidateItem = progress.timelineItems.at(-1)

          if (
            requestCandidateItem?.label === 'Request candidate' &&
            requestCandidateItem.status === 'running' &&
            progress.timelineItems.some((item) => item.label === 'Repair 1')
          ) {
            repairRequestProgressLabels.push(
              progress.timelineItems.map((item) => item.label),
            )
          }
        },
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(observedAttemptCounts).toEqual([1, 2])
    expect(repairRequestProgressLabels.at(-1)).toEqual([
      'Initial attempt',
      'Agent run started',
      'Compile prompt',
      'Request candidate',
      'Parse candidate JSON',
      'Candidate validation failed',
      '',
      'Repair 1',
      'Prepare repair feedback',
      'Compile prompt',
      'Request candidate',
    ])
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
      'no operation from the rejected patch was partially applied',
    )
    expect(requests[2].prompt.user).toContain(
      'resend them in the corrected patch',
    )
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

  it('prioritizes physical target failures after a schema-invalid repair patch', async () => {
    const requests: AgentRequest[] = []
    const sceneStore = createSceneStore(emptyScene)
    let validationCalls = 0
    const client = createQueuedClient(
      [
        {
          candidate: createValidValidationFixtureAsset(),
          rawText: '{}',
          responseId: 'resp_initial',
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
          candidate: replaceRootPatch(createValidValidationFixtureAsset()),
          rawText: '{}',
          responseId: 'resp_valid',
          status: 'ok',
        },
      ],
      requests,
    )

    const validateCandidate = (candidate: unknown): ManifestValidationResult => {
      const asset = candidate as ManifestAsset

      validationCalls += 1

      if (validationCalls > 1) {
        return {
          asset,
          probeReport: null,
          report: createValidationReport({ asset, signals: [] }),
        }
      }

      return {
        asset,
        probeReport: null,
        report: createValidationReport({
          asset,
          signals: [
            createValidationSignal(
              'mechanical_relation_coverage',
              'mechanical_guided_pose_target_missing',
              'Mechanical coverage should not lead patch-error recovery.',
              {
                refs: { partId: 'piston' },
                source: 'checks',
                stage: 'structure',
              },
            ),
            createValidationSignal(
              'real_overlap',
              'part_overlap_current_pose',
              'Physical overlap should lead patch-error recovery.',
              {
                refs: { partPair: 'crankshaft<->engine-block' },
                source: 'baseline_qc',
                stage: 'baseline_qc',
              },
            ),
          ],
        }),
      }
    }

    const result = await runManifestAgentLoop(
      {
        mode: 'create',
        runId: 'run-prioritized-patch-target-context',
        scene: emptyScene,
        userPrompt: 'Create a CAD-like piston mechanism.',
      },
      {
        client,
        sceneStore,
        validateCandidate,
      },
    )

    const patchErrorPrompt = requests[2].prompt.user
    const physicalFailureIndex = patchErrorPrompt.indexOf(
      '[baseline_qc/part_overlap_current_pose] Physical overlap should lead patch-error recovery.',
    )
    const relationFailureIndex = patchErrorPrompt.indexOf(
      '[structure/mechanical_guided_pose_target_missing] Mechanical coverage should not lead patch-error recovery.',
    )

    expect(result.status).toBe('ready')
    expect(patchErrorPrompt).toContain('<patch_application_error>')
    expect(physicalFailureIndex).toBeGreaterThanOrEqual(0)
    expect(relationFailureIndex).toBeGreaterThanOrEqual(0)
    expect(physicalFailureIndex).toBeLessThan(relationFailureIndex)
  })

  it('adds targeted path hints for joint limit patch mistakes', async () => {
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
                path: '/joints/byId/crate-lid-hinge/limits',
                value: {
                  position: [0, 0, 0],
                  rotation: [0, 0, 0],
                  scale: [1, 1, 1],
                },
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_bad_limits_patch',
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
        runId: 'run-joint-limit-patch-hint',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(requests[2].prompt.user).toContain('<path_hints>')
    expect(requests[2].prompt.user).toContain('Joint `limits` only accepts')
    expect(requests[2].prompt.user).toContain('/joints/byId/<joint-id>/origin/position')
  })

  it('adds targeted path hints for check descriptors placed in control limits', async () => {
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
                path: '/controls/0/limits',
                value: {
                  contactTolerance: 0.01,
                  maxPenetration: 0.002,
                  partAId: 'crate-base',
                  partBId: 'crate-lid',
                  type: 'expect_contact',
                  visualAId: 'crate-base-shell',
                  visualBId: 'crate-lid-panel',
                },
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_control_limits_check_patch',
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
        runId: 'run-control-limits-check-patch-hint',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(requests[2].prompt.user).toContain('<path_hints>')
    expect(requests[2].prompt.user).toContain('Control `limits` only accepts')
    expect(requests[2].prompt.user).toContain('/checks/-')
  })

  it('adds targeted path hints for transform-shaped check pose mistakes', async () => {
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
                op: 'add',
                path: '/checks/-',
                value: {
                  partAId: 'crate-base',
                  partBId: 'crate-lid',
                  pose: {
                    position: [0, 0, 0],
                    rotation: [0, 0, 0],
                    scale: [1, 1, 1],
                  },
                  type: 'expect_contact',
                },
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_bad_check_pose_patch',
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
        runId: 'run-check-pose-patch-hint',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(requests[2].prompt.user).toContain('<path_hints>')
    expect(requests[2].prompt.user).toContain('Authored `check.pose` is a joint pose')
    expect(requests[2].prompt.user).toContain('"joints"')
  })

  it('adds targeted path hints for asset-shaped check pose mistakes', async () => {
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
                op: 'add',
                path: '/checks/-',
                value: {
                  partAId: 'crate-base',
                  partBId: 'crate-lid',
                  pose: {
                    allowances: [],
                    checks: [],
                    controls: [],
                    id: 'not-a-pose',
                    joints: [],
                    materials: [],
                    metadata: {
                      createdAt: '2026-06-04T00:00:00.000Z',
                      generationStatus: 'ready',
                      sourceImageIds: [],
                      updatedAt: '2026-06-04T00:00:00.000Z',
                    },
                    parts: [],
                    prompt: 'not a pose',
                    schemaVersion: 2,
                    units: 'meters',
                  },
                  type: 'expect_contact',
                },
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_asset_shaped_check_pose_patch',
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
        runId: 'run-asset-shaped-check-pose-patch-hint',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(requests[2].prompt.user).toContain('<path_hints>')
    expect(requests[2].prompt.user).toContain(
      'Do not paste a whole asset',
    )
    expect(requests[2].prompt.user).toContain('compact joint pose object')
  })

  it('adds targeted path hints for check-shaped check pose mistakes', async () => {
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
                op: 'add',
                path: '/checks/-',
                value: {
                  partAId: 'crate-base',
                  partBId: 'crate-lid',
                  pose: {
                    contactTolerance: 0.01,
                    maxPenetration: 0.002,
                    partAId: 'crate-base',
                    partBId: 'crate-lid',
                    type: 'expect_contact',
                    visualAId: 'crate-base-shell',
                    visualBId: 'crate-lid-panel',
                  },
                  type: 'expect_contact',
                },
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_check_shaped_check_pose_patch',
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
        runId: 'run-check-shaped-check-pose-patch-hint',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(requests[2].prompt.user).toContain('<path_hints>')
    expect(requests[2].prompt.user).toContain(
      'Do not nest another authored check object inside `check.pose`',
    )
    expect(requests[2].prompt.user).toContain('/checks/-')
  })

  it('adds targeted path hints for check pose joint entries shaped as checks', async () => {
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
                op: 'add',
                path: '/checks/-',
                value: {
                  partAId: 'crate-base',
                  partBId: 'crate-lid',
                  pose: {
                    joints: [
                      {
                        jointId: 'crate-lid-hinge',
                        jointType: 'revolute',
                        type: 'joint_exists',
                      },
                    ],
                    name: 'opened',
                  },
                  type: 'expect_contact',
                },
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_bad_check_pose_joint_patch',
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
        runId: 'run-check-pose-joint-patch-hint',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(requests[2].prompt.user).toContain('<path_hints>')
    expect(requests[2].prompt.user).toContain(
      'Entries in `check.pose.joints` are joint values',
    )
    expect(requests[2].prompt.user).toContain('"jointId"')
    expect(requests[2].prompt.user).toContain('"value"')
  })

  it('adds targeted path hints for full joint descriptors inside check pose joint samples', async () => {
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
                op: 'add',
                path: '/checks/-',
                value: {
                  partAId: 'crate-base',
                  partBId: 'crate-lid',
                  pose: {
                    joints: [
                      {
                        axis: [0, 0, 1],
                        childPartId: 'crate-lid',
                        id: 'crate-lid-hinge',
                        limits: {
                          lower: 0,
                          upper: 1,
                        },
                        name: 'Crate lid hinge',
                        origin: {},
                        parentPartId: 'crate-base',
                        type: 'revolute',
                      },
                    ],
                    name: 'opened',
                  },
                  type: 'expect_contact',
                },
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_full_joint_pose_sample_patch',
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
        runId: 'run-full-joint-pose-sample-patch-hint',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(requests[2].prompt.user).toContain('<path_hints>')
    expect(requests[2].prompt.user).toContain(
      'not full joint descriptors',
    )
    expect(requests[2].prompt.user).toContain('/joints/byId/<joint-id>/')
  })

  it('rejects authored relation checks placed in visual geometry', async () => {
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
                path: '/parts/byId/crate-base/visuals/byId/crate-base-shell/geometry',
                value: {
                  type: 'expect_overlap',
                  partAId: 'crate-base',
                  partBId: 'crate-lid',
                  axes: 'xz',
                  minOverlap: 0.5,
                  visualAId: 'crate-base-shell',
                  visualBId: 'crate-lid-panel',
                },
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_bad_geometry_overlap_check_patch',
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
        runId: 'run-geometry-overlap-check-patch-rejection',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(requests.map((request) => request.prompt.metadata.mode)).toEqual([
      'create',
      'repair',
      'repair',
    ])
    expect(result.history.attempts.map((attempt) => attempt.status)).toEqual([
      'failure',
      'success',
    ])
    expect(requests[2].prompt.user).toContain('<patch_application_error>')
    expect(requests[2].prompt.user).toContain('authored check object')
    expect(requests[2].prompt.user).toContain('/checks/-')
    expect(requests[2].prompt.user).toContain(
      'visual `geometry` field',
    )
  })

  it('rejects misplaced authored checks with placeholder refs instead of salvaging them', async () => {
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
                path: '/parts/byId/crate-base/visuals/byId/crate-base-shell/geometry',
                value: {
                  type: 'expect_contact',
                  partAId: '__invalid__',
                  partBId: 'y',
                  visualAId: 'a',
                  visualBId: 'b',
                  contactTolerance: 0,
                  maxPenetration: 0,
                },
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_placeholder_geometry_check_patch',
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
        runId: 'run-placeholder-geometry-check-patch',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    const successCandidate = result.history.attempts[1]?.candidate as ManifestAsset

    expect(result.status).toBe('ready')
    expect(result.history.attempts.map((attempt) => attempt.status)).toEqual([
      'failure',
      'success',
    ])
    expect(requests.map((request) => request.prompt.metadata.mode)).toEqual([
      'create',
      'repair',
      'repair',
    ])
    expect(requests[2].prompt.user).toContain('<patch_application_error>')
    expect(requests[2].prompt.user).toContain('partAId=__invalid__')
    expect(requests[2].prompt.user).toContain('placeholder reference ids')
    expect(successCandidate.checks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          partAId: '__invalid__',
          partBId: 'y',
          type: 'expect_contact',
        }),
      ]),
    )
  })

  it('rejects presence checks placed in visual geometry instead of salvaging no-op repairs', async () => {
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
                path: '/parts/byId/crate-base/visuals/byId/crate-base-shell/geometry',
                value: {
                  type: 'joint_exists',
                  jointId: 'crate-lid-hinge',
                  jointType: 'revolute',
                },
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_geometry_joint_exists_patch',
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
        runId: 'run-geometry-presence-check-patch',
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
    expect(requests[2].prompt.user).toContain('<patch_application_error>')
    expect(requests[2].prompt.user).toContain('authored check object')
    expect(requests[2].prompt.user).toContain('/checks/-')
    expect(requests[2].prompt.user).toContain(
      'do not repair physical contact, overlap, fit, or motion failures',
    )
    expect(requests[2].prompt.user.indexOf('<path_hints>')).toBeLessThan(
      requests[2].prompt.user.indexOf('<rejected_patch_summary>'),
    )
  })

  it('rejects allowances placed in visual geometry instead of silently rerouting them', async () => {
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
                path: '/parts/byId/crate-base/visuals/byId/crate-base-shell/geometry',
                value: {
                  type: 'allow_overlap',
                  partAId: 'crate-base',
                  partBId: 'crate-lid',
                  reason: 'Crate lid is intentionally seated into the base lip.',
                  visualAId: 'crate-base-shell',
                  visualBId: 'crate-lid-panel',
                },
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_bad_geometry_allowance_patch',
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
        runId: 'run-geometry-allowance-patch-hint',
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
    expect(requests[2].prompt.user).toContain('<patch_application_error>')
    expect(requests[2].prompt.user).toContain('allowance object')
    expect(requests[2].prompt.user).toContain('/allowances/-')
    expect(requests[2].prompt.user).toContain(
      'visual `geometry` field',
    )
  })

  it('rejects expect checks placed in visual geometry instead of silently rerouting them', async () => {
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
                path: '/parts/byId/crate-base/visuals/byId/crate-base-shell/transform/position',
                value: [0, 0.16, 0],
              },
              {
                op: 'replace',
                path: '/parts/byId/crate-base/visuals/byId/crate-base-shell/geometry',
                value: {
                  type: 'expect_contact',
                  partAId: 'crate-base',
                  partBId: 'crate-lid',
                  visualAId: 'crate-base-shell',
                  visualBId: 'crate-lid-panel',
                  contactTolerance: 0.02,
                  maxPenetration: 0.004,
                },
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_bad_geometry_expect_patch',
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
        runId: 'run-geometry-expect-check-patch-rejection',
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
    expect(requests[2].prompt.user).toContain('<patch_application_error>')
    expect(requests[2].prompt.user).toContain('authored check object')
    expect(requests[2].prompt.user).toContain('/checks/-')
    expect(requests[2].prompt.user).toContain(
      'no operation from the rejected patch was partially applied',
    )
  })

  it('adds visual geometry path hints even when the bad operation is hidden by compact patch summaries', async () => {
    const requests: AgentRequest[] = []
    const sceneStore = createSceneStore(emptyScene)
    const fillerOperation = {
      op: 'replace',
      path: '/parts/byId/crate-base/visuals/byId/crate-base-shell/transform/position',
      value: [0, 0.17, 0],
    }
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
              fillerOperation,
              fillerOperation,
              fillerOperation,
              fillerOperation,
              fillerOperation,
              fillerOperation,
              {
                op: 'replace',
                path: '/parts/byId/crate-base/visuals/byId/crate-base-shell/geometry',
                value: {
                  type: 'notGeometry',
                },
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_hidden_bad_geometry_patch',
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
        runId: 'run-hidden-geometry-patch-hint',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(requests[2].prompt.user).toContain('<path_hints>')
    expect(requests[2].prompt.user).toContain('invalid visual `geometry.type`')
    expect(requests[2].prompt.user).toContain('/checks/-')
    expect(requests[2].prompt.user).toContain('...and 1 more operation(s).')
    expect(requests[2].prompt.user).toContain(
      'Flagged hidden schema-domain operation(s):',
    )
    expect(requests[2].prompt.user).toContain(
      '7. replace /parts/byId/crate-base/visuals/byId/crate-base-shell/geometry value=object(type=notGeometry',
    )
  })

  it('surfaces a hidden failed patch operation when a numeric array index is out of range', async () => {
    const requests: AgentRequest[] = []
    const sceneStore = createSceneStore(emptyScene)
    const fillerOperation = {
      op: 'replace',
      path: '/parts/byId/crate-base/visuals/byId/crate-base-shell/transform/position',
      value: [0, 0.17, 0],
    }
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
              fillerOperation,
              fillerOperation,
              fillerOperation,
              fillerOperation,
              fillerOperation,
              fillerOperation,
              {
                op: 'replace',
                path: '/checks/43/maxPenetration',
                value: 0.018,
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_hidden_out_of_range_patch',
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
        runId: 'run-hidden-out-of-range-patch-hint',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(requests[2].prompt.user).toContain('<patch_application_error>')
    expect(requests[2].prompt.user).toContain(
      'Patch operation 7 failed: Array index "43" is out of range.',
    )
    expect(requests[2].prompt.user).toContain('Failed operation:')
    expect(requests[2].prompt.user).toContain(
      '7. replace /checks/43/maxPenetration value=0.018',
    )
    expect(requests[2].prompt.user).toContain(
      'Use `/checks/-` or `/allowances/-` to append',
    )
    expect(requests[2].prompt.user).toContain('/parts/byId/')
  })

  it('flags hidden whole-asset objects pasted into nested patch values', async () => {
    const requests: AgentRequest[] = []
    const sceneStore = createSceneStore(emptyScene)
    const fillerOperation = {
      op: 'replace',
      path: '/parts/byId/crate-base/visuals/byId/crate-base-shell/transform/position',
      value: [0, 0.17, 0],
    }
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
              fillerOperation,
              fillerOperation,
              fillerOperation,
              fillerOperation,
              fillerOperation,
              fillerOperation,
              {
                op: 'add',
                path: '/joints/byId/crate-lid-hinge/limits',
                value: createValidValidationFixtureAsset(),
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_hidden_whole_asset_nested_patch',
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
        runId: 'run-hidden-whole-asset-nested-patch-hint',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(requests[2].prompt.user).toContain('<path_hints>')
    expect(requests[2].prompt.user).toContain('whole asset object')
    expect(requests[2].prompt.user).toContain(
      'Flagged hidden schema-domain operation(s):',
    )
    expect(requests[2].prompt.user).toContain(
      '7. add /joints/byId/crate-lid-hinge/limits value=object(keys=schemaVersion, id, name, prompt, units, ...+7)',
    )
  })

  it('normalizes replace operations at append paths to add operations', async () => {
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
                path: '/checks/-',
                value: {
                  partAId: 'crate-base',
                  partBId: 'crate-lid',
                  type: 'expect_contact',
                  visualAId: 'crate-base-shell',
                  visualBId: 'crate-lid-panel',
                },
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_replace_append_check',
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
        runId: 'run-replace-append-normalized',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(requests[2].prompt.user).not.toContain('<patch_application_error>')
    expect((result.history.attempts[1]?.candidate as ManifestAsset).checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          partAId: 'crate-base',
          partBId: 'crate-lid',
          type: 'expect_contact',
        }),
      ]),
    )
  })

  it('hints when check objects are placed in control joint bindings', async () => {
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
                path: '/controls/byId/crate-lid-control/joints/-',
                value: {
                  jointId: 'crate-lid-hinge',
                  jointType: 'revolute',
                  type: 'joint_exists',
                },
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_bad_control_joint_binding',
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
        runId: 'run-control-joint-binding-hint',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(requests[2].prompt.user).toContain('<patch_application_error>')
    expect(requests[2].prompt.user).toContain('Control `joints` entries')
    expect(requests[2].prompt.user).toContain('scale')
    expect(requests[2].prompt.user).toContain('offset')
    expect(requests[2].prompt.user).toContain('/checks/-')
  })

  it('surfaces hidden check descriptors placed in control joint bindings', async () => {
    const requests: AgentRequest[] = []
    const sceneStore = createSceneStore(emptyScene)
    const fillerOperation = {
      op: 'replace',
      path: '/parts/byId/crate-base/visuals/byId/crate-base-shell/transform/position',
      value: [0, 0.17, 0],
    }
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
              fillerOperation,
              fillerOperation,
              fillerOperation,
              fillerOperation,
              fillerOperation,
              fillerOperation,
              {
                op: 'add',
                path: '/controls/byId/crate-lid-control/joints/-',
                value: {
                  partId: 'crate-lid',
                  type: 'part_exists',
                },
              },
              {
                op: 'remove',
                path: '/controls/byId/crate-lid-control/joints/-',
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_hidden_bad_control_joint_binding',
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
        runId: 'run-hidden-control-joint-binding-hint',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(requests[2].prompt.user).toContain('<patch_application_error>')
    expect(requests[2].prompt.user).toContain(
      'Flagged hidden schema-domain operation(s):',
    )
    expect(requests[2].prompt.user).toContain(
      '7. add /controls/byId/crate-lid-control/joints/- value=object(type=part_exists',
    )
    expect(requests[2].prompt.user).toContain(
      '8. remove /controls/byId/crate-lid-control/joints/-',
    )
    expect(requests[2].prompt.user).toContain(
      'Control `joints` entries accept only control bindings',
    )
    expect(requests[2].prompt.user).toContain(
      'The `/-` suffix is append-only',
    )
    expect(requests[2].prompt.user).toContain('/checks/-')
  })

  it('unwraps a single control binding nested in a full control object', async () => {
    const requests: AgentRequest[] = []
    const sceneStore = createSceneStore(emptyScene)
    let validationCalls = 0
    const client = createQueuedClient(
      [
        {
          candidate: createValidValidationFixtureAsset(),
          rawText: '{}',
          responseId: 'resp_initial',
          status: 'ok',
        },
        {
          candidate: {
            patch: [
              {
                op: 'add',
                path: '/controls/byId/crate-lid-control/joints/-',
                value: {
                  id: 'crate-extra-binding',
                  name: 'Misplaced binding wrapper',
                  joints: [
                    {
                      jointId: 'crate-lid-hinge',
                      offset: 0.5,
                      scale: -1,
                    },
                  ],
                  limits: { lower: -1.9, upper: 0 },
                },
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_nested_control_binding',
          status: 'ok',
        },
      ],
      requests,
    )

    const validateCandidate = (candidate: unknown): ManifestValidationResult => {
      const asset = candidate as ManifestAsset

      validationCalls += 1

      if (validationCalls > 1) {
        return {
          asset,
          probeReport: null,
          report: createValidationReport({ asset, signals: [] }),
        }
      }

      return {
        asset,
        probeReport: null,
        report: createValidationReport({
          asset,
          signals: [
            createValidationSignal(
              'mechanical_relation_coverage',
              'mechanical_linked_control_missing',
              'Linked mechanism needs another control binding.',
              {
                refs: { movableJointCount: '2' },
                source: 'checks',
                stage: 'structure',
              },
            ),
          ],
        }),
      }
    }

    const result = await runManifestAgentLoop(
      {
        mode: 'create',
        runId: 'run-unwrap-nested-control-binding',
        scene: emptyScene,
        userPrompt: 'Create a linked hinged utility mechanism.',
      },
      {
        client,
        sceneStore,
        validateCandidate,
      },
    )

    expect(result.status).toBe('ready')
    expect(requests.map((request) => request.prompt.metadata.mode)).toEqual([
      'create',
      'repair',
    ])
    expect(sceneStore.getSnapshot().scene.assets[0]?.controls[0]?.joints).toEqual(
      expect.arrayContaining([
        { jointId: 'crate-lid-hinge', offset: 0.5, scale: -1 },
      ]),
    )
  })

  it('hints when id-addressed append paths target objects that do not exist yet', async () => {
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
                op: 'add',
                path: '/controls/byId/engine-motion-control/joints/-',
                value: {
                  jointId: 'crate-lid-hinge',
                  offset: 0,
                  scale: 1,
                },
              },
            ],
          },
          rawText: '{}',
          responseId: 'resp_missing_control_parent',
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
        runId: 'run-missing-by-id-parent-hint',
        scene: emptyScene,
        userPrompt: 'Create a hinged utility crate.',
      },
      {
        client,
        sceneStore,
      },
    )

    expect(result.status).toBe('ready')
    expect(requests[2].prompt.user).toContain('<patch_application_error>')
    expect(requests[2].prompt.user).toContain('byId/<id>')
    expect(requests[2].prompt.user).toContain('/controls/-')
    expect(requests[2].prompt.user).toContain('append the complete object')
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

function relationLoopAttempt(
  revision: number,
  failureClusters: CandidateAttempt['failureClusters'],
) {
  return {
    failureClusters,
    revision,
    status: 'failure',
  } as CandidateAttempt
}

function relationFailureCluster(
  kind: string,
  code: string,
): CandidateAttempt['failureClusters'][number] {
  return {
    code,
    count: 1,
    key: `${kind}:${code}`,
    kind,
    label: `[baseline_qc/${code}] partPair=crankshaft<->timing-chain`,
    poseKey: null,
    refs: {
      partPair: 'crankshaft<->timing-chain',
    },
    source: 'baseline_qc',
    stage: 'baseline_qc',
  }
}

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
  if (isRecord(value)) {
    return {
      patch: Object.entries(value).map(([key, entry]) => ({
        op: 'replace',
        path: `/${escapeJsonPointer(key)}`,
        value: entry,
      })),
    }
  }

  return {
    patch: [
      {
        op: 'replace',
        path: '/metadata',
        value,
      },
    ],
  }
}

function escapeJsonPointer(value: string) {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
