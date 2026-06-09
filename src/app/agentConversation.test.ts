import { describe, expect, it } from 'vitest'
import { createCandidateHistory } from '../engine/agent/session/candidateHistory'
import { createValidValidationFixtureAsset } from '../engine/testing/validationFixtureAsset'
import {
  createEmptyAssetLibrarySnapshot,
  saveValidatedAssetVersion,
} from '../engine/persistence/assetLibraryModel'
import type {
  AssetLibraryAsset,
  AssetLibrarySnapshot,
} from '../engine/persistence/assetLibraryTypes'
import { validateManifestAssetCandidate } from '../engine/validation/validateManifest'
import {
  createPromptUserInputHistory,
  createVersionTranscript,
} from './agentConversation'

describe('agent conversation helpers', () => {
  it('builds prompt history from the selected version lineage plus the pending turn', () => {
    const saved = buildTwoTurnAsset()
    const asset = saved.snapshot.assets[0]
    const history = createPromptUserInputHistory({
      asset,
      currentUserInput: {
        imageAttachments: [
          {
            id: 'ref-third',
            imageUrl: 'data:image/png;base64,third',
            mediaType: 'image/png',
          },
        ],
        text: 'Add handles.',
      },
      selectedVersionId: saved.latestVersionId,
    })

    expect(history.map((entry) => entry.turn)).toEqual([0, 1, 2])
    expect(history.map((entry) => entry.text)).toEqual([
      'Create from the first reference.',
      'Make the lid thicker.',
      'Add handles.',
    ])
    expect(
      history.flatMap((entry) =>
        (entry.imageAttachments ?? []).map((attachment) => attachment.id),
      ),
    ).toEqual(['ref-first', 'ref-third'])
  })

  it('renders saved version lineage as interleaved user prompts and attempt timelines', () => {
    const saved = buildTwoTurnAsset()
    const asset = saved.snapshot.assets[0]
    const transcript = createVersionTranscript(asset, asset.versions[1])

    expect(transcript.map((item) => item.role)).toEqual([
      'user',
      'agent',
      'user',
      'agent',
    ])
    expect(transcript[0]).toMatchObject({
      modelId: 'openai/gpt-5.5',
      role: 'user',
      text: 'Create from the first reference.',
    })
    expect(
      transcript[0].role === 'user'
        ? transcript[0].imageAttachments[0].imageUrl
        : null,
    ).toBe('data:image/png;base64,first')
    expect(transcript[2]).toMatchObject({
      modelId: 'gemini-flash-latest',
      role: 'user',
      text: 'Make the lid thicker.',
    })
    expect(transcript[1]).toMatchObject({
      role: 'agent',
      status: 'Ready: Validation Crate v1',
    })
    expect(
      transcript[1].role === 'agent' ? transcript[1].timelineItems.length : 0,
    ).toBeGreaterThan(0)
    expect(
      transcript[1].role === 'agent'
        ? transcript[1].timelineItems.map((item) => item.label).slice(0, 3)
        : [],
    ).toEqual(['Initial attempt', 'Compile prompt', 'Candidate validated'])
  })

  it('leaves legacy versions on the existing attempt-only path', () => {
    const legacy = buildLegacyAsset()
    const asset = legacy[0]

    expect(
      createPromptUserInputHistory({
        asset,
        currentUserInput: {
          imageAttachments: [],
          text: 'Follow up on the legacy asset.',
        },
        selectedVersionId: asset.versions[0].versionId,
      }),
    ).toEqual([])
    expect(createVersionTranscript(asset, asset.versions[0])).toEqual([])
  })

  it('shows unknown model for saved prompt versions without a persisted model id', () => {
    const legacy = buildLegacyPromptAsset()
    const asset = legacy[0]
    const transcript = createVersionTranscript(asset, asset.versions[0])

    expect(transcript[0]).toMatchObject({
      modelId: 'unknown model',
      role: 'user',
      text: 'Create a legacy prompt asset.',
    })
  })
})

function buildTwoTurnAsset(): {
  latestVersionId: string
  snapshot: AssetLibrarySnapshot
} {
  const assetV1 = createValidValidationFixtureAsset()
  const reportV1 = validateManifestAssetCandidate(assetV1).report
  const historyV1 = createCandidateHistory({ runId: 'run-v1' })

  historyV1.recordValidationAttempt(assetV1, reportV1)

  const first = saveValidatedAssetVersion(createEmptyAssetLibrarySnapshot(), {
    agentEvents: createPersistedRunEvents('run-v1'),
    agentSessions: [createPersistedAgentSession('run-v1', 'openai/gpt-5.5')],
    asset: assetV1,
    history: historyV1.getSnapshot(),
    now: () => '2026-05-17T00:00:00.000Z',
    userInput: {
      imageAttachments: [
        {
          id: 'ref-first',
          imageUrl: 'data:image/png;base64,first',
          mediaType: 'image/png',
        },
      ],
      text: 'Create from the first reference.',
    },
    validationReport: reportV1,
  })
  const assetV2 = {
    ...assetV1,
    name: 'Validation Crate Revised',
  }
  const reportV2 = validateManifestAssetCandidate(assetV2).report
  const historyV2 = createCandidateHistory({ runId: 'run-v2' })

  historyV2.recordValidationAttempt(assetV2, reportV2)

  const second = saveValidatedAssetVersion(first.snapshot, {
    agentEvents: createPersistedRunEvents('run-v2'),
    agentSessions: [createPersistedAgentSession('run-v2', 'gemini-flash-latest')],
    asset: assetV2,
    history: historyV2.getSnapshot(),
    now: () => '2026-05-17T00:01:00.000Z',
    parentVersionId: first.version.versionId,
    userInput: {
      imageAttachments: [],
      text: 'Make the lid thicker.',
    },
    validationReport: reportV2,
  })

  return {
    latestVersionId: second.version.versionId,
    snapshot: second.snapshot,
  }
}


function createPersistedRunEvents(runId: string) {
  return [
    {
      detail: 'mode=create',
      id: `${runId}:1:compiling_prompt`,
      label: 'Compile prompt',
      state: 'compiling_prompt' as const,
      status: 'passed' as const,
    },
    {
      detail: null,
      id: `${runId}:2:validating_candidate`,
      label: 'Validate candidate',
      state: 'validating_candidate' as const,
      status: 'passed' as const,
    },
  ]
}

function buildLegacyAsset(): AssetLibraryAsset[] {
  const asset = createValidValidationFixtureAsset()
  const report = validateManifestAssetCandidate(asset).report
  const history = createCandidateHistory({ runId: 'run-legacy' })

  history.recordValidationAttempt(asset, report)

  return saveValidatedAssetVersion(createEmptyAssetLibrarySnapshot(), {
    asset,
    history: history.getSnapshot(),
    now: () => '2026-05-17T00:00:00.000Z',
    validationReport: report,
  }).snapshot.assets
}

function buildLegacyPromptAsset(): AssetLibraryAsset[] {
  const asset = createValidValidationFixtureAsset()
  const report = validateManifestAssetCandidate(asset).report
  const history = createCandidateHistory({ runId: 'run-legacy-prompt' })

  history.recordValidationAttempt(asset, report)

  return saveValidatedAssetVersion(createEmptyAssetLibrarySnapshot(), {
    agentEvents: createPersistedRunEvents('run-legacy-prompt'),
    asset,
    history: history.getSnapshot(),
    now: () => '2026-05-17T00:00:00.000Z',
    userInput: {
      imageAttachments: [],
      text: 'Create a legacy prompt asset.',
    },
    validationReport: report,
  }).snapshot.assets
}

function createPersistedAgentSession(runId: string, modelId: string) {
  return {
    assetId: null,
    contextBufferTokens: 50_000,
    contextLimitTokens: 256_000,
    createdAt: '2026-05-17T00:00:00.000Z',
    exchanges: [],
    latestAssetFingerprint: null,
    latestProviderResponseId: null,
    modelId,
    parentSessionId: null,
    provider: 'openrouter' as const,
    reasoningEffort: 'high',
    sessionId: `${runId}:session:1`,
    status: 'complete' as const,
    tokenEstimate: 0,
    updatedAt: '2026-05-17T00:00:00.000Z',
  }
}
