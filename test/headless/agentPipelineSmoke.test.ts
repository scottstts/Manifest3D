import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, extname, relative, resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  defaultRepairTurnCap,
  runManifestAgentLoop,
  type AgentLoopEvent,
} from '../../src/engine/agent/agentLoop'
import {
  createValidationFailureClusters,
  createValidationFailureClusterSignature,
  type ValidationFailureCluster,
} from '../../src/engine/agent/feedback/failureClusters'
import { createManifestProviderClient } from '../../src/engine/agent/provider/manifestProviderClient'
import { parseModelProvider } from '../../src/engine/agent/provider/providerPreference'
import type { ProviderModelSettings } from '../../src/engine/agent/provider/providerModelSettings'
import type {
  AgentImageAttachment,
  AgentRequest,
  AgentResponse,
  ManifestProviderClient,
} from '../../src/engine/agent/provider/providerClient'
import {
  geminiModelConfig,
  modelConfig,
  openRouterModelConfig,
  type ModelProvider,
} from '../../src/engine/config/modelConfig'
import { createAssetLibraryStore } from '../../src/engine/persistence/assetLibraryStore'
import { createMemoryAssetLibraryRepository } from '../../src/engine/persistence/assetLibraryRepository'
import { createSceneStore } from '../../src/engine/scene/sceneStore'
import {
  canExportManifestAssetAnimation,
  exportManifestAssetGlb,
  type GlbExportMode,
} from '../../src/engine/scene/exportGlb'
import type {
  ManifestAsset,
  ManifestScene,
} from '../../src/engine/schema/manifestTypes'
import type {
  ValidationReport,
  ValidationSignal,
} from '../../src/engine/schema/validationTypes'
import { safeParseManifestAsset } from '../../src/engine/schema/manifestSchema'
import { validateManifestAssetCandidate } from '../../src/engine/validation/validateManifest'
import {
  resolveHeadlessRunConfig,
  type HeadlessRunMode,
} from './headlessRunModes'
import {
  createHeadlessPatchApplicationStopper,
  type HeadlessPatchApplicationStopState,
} from './headlessPatchApplicationStopper'

type HeadlessAgentResult = Awaited<ReturnType<typeof runManifestAgentLoop>>
type HeadlessAttempt = HeadlessAgentResult['history']['attempts'][number]
type HeadlessModelProvider = ModelProvider

type HeadlessRepairReplaySeed = {
  candidate: unknown
  path: string
}

type CapturedExchange = {
  artifacts: {
    candidateJson?: string
    errorJson?: string
    rawText?: string
    requestJson: string
    systemPrompt: string
    userPrompt: string
  }
  index: number
  metadata: AgentRequest['prompt']['metadata']
  provider: HeadlessModelProvider
  request: {
    approximateInputTokens: number
    imageAttachmentCount: number
    promptChars: {
      system: number
      total: number
      user: number
    }
    userSectionChars: Record<string, number>
  }
  response: {
    approximateOutputTokens?: number
    candidateJsonChars?: number
    completedAt: string
    durationMs: number
    rawTextChars?: number
    responseId: string | null
    startedAt: string
    status: AgentResponse['status']
    statusCode?: number
    synthetic?: boolean
    syntheticSeedPath?: string
  }
}

type HeadlessGlbArtifact = {
  byteLength: number
  fileName: string
  mode: GlbExportMode
  path: string
  viewerUrl: string | null
}

type HeadlessAttemptGlbArtifacts = {
  attemptId: string
  attemptIndex: number
  glbExports: HeadlessGlbArtifact[]
  message: string | null
  status: 'exported' | 'failed' | 'skipped'
}

type HeadlessImageArtifact = {
  mediaType: string
  name: string
  path: string
}

type HeadlessProgressLogger = {
  logEarlyStopArmed: (state: HeadlessRepeatedFailureStopState) => void
  logPatchApplicationStopArmed: (
    state: HeadlessPatchApplicationStopState,
  ) => void
  logAgentEvent: (event: AgentLoopEvent) => void
  logFinalResult: (result: HeadlessAgentResult) => void
  logGlbExportComplete: (
    attemptIndex: number,
    artifact: HeadlessAttemptGlbArtifacts,
  ) => void
  logGlbExportStart: (attemptIndex: number, attemptCount: number) => void
  logModelRequestFailed: (
    index: number,
    startedAt: Date,
    error: unknown,
  ) => void
  logModelRequestStart: (
    index: number,
    request: AgentRequest,
    metrics: ReturnType<typeof createRequestMetrics>,
  ) => void
  logModelRequestStillWaiting: (index: number, startedAt: Date) => void
  logModelResponse: (exchange: CapturedExchange) => void
  logRunConfigured: (input: {
    headlessMode: HeadlessRunMode
    imageAttachmentCount: number
    prompt: string
    repairReplaySeedPath: string | null
  }) => void
  logValidationAttempt: (attemptIndex: number, report: ValidationReport) => void
  path: string
}

type HeadlessRepeatedFailureStopState = {
  clusters: readonly ValidationFailureCluster[]
  reason: string
  signature: string
  streak: number
  threshold: number
}

// intentionally use a more difficult prompt to stress test the pipeline
const defaultPrompt =
  'a silver boxy pickup truck with spinning wheels and front wheels that can turn left and right'
const defaultRunTimeoutMs = 3_600_000
const emptyScene: ManifestScene = {
  assets: [],
  schemaVersion: 1,
  units: 'meters',
}
const describeLiveHeadless = isHeadlessAgentEnabled() ? describe : describe.skip

describeLiveHeadless('headless agent pipeline smoke', () => {
  beforeAll(() => {
    vi.stubGlobal('FileReader', HeadlessFileReader)
  })

  it(
    'runs the real create pipeline and captures every candidate attempt',
    async () => {
      const headlessRunConfig = resolveHeadlessRunConfig(
        process.env,
        defaultRepairTurnCap,
      )
      const repairReplaySeed = readHeadlessRepairReplaySeed(
        headlessRunConfig.repairSeedPath,
      )
      const prompt = readStringEnv(
        'HEADLESS_AGENT_PROMPT',
        getRepairReplayPromptFallback(repairReplaySeed) ?? defaultPrompt,
      )
      const runId = createHeadlessRunId()
      const artifactRoot = createArtifactRoot(runId)
      const runTimeoutMs = readNumberEnv(
        'HEADLESS_AGENT_RUN_TIMEOUT_MS',
        defaultRunTimeoutMs,
      )
      const maxRepairTurns = headlessRunConfig.maxRepairTurns
      const repeatedFailureStopper = createHeadlessRepeatedFailureStopper(
        readNonNegativeNumberEnv('HEADLESS_AGENT_REPEATED_FAILURE_STOP_STREAK', 3),
      )
      const patchApplicationStopper = createHeadlessPatchApplicationStopper(
        readNonNegativeNumberEnv('HEADLESS_AGENT_PATCH_ERROR_STOP_STREAK', 2),
      )
      const abortController = new AbortController()
      const runTimeout = setTimeout(() => {
        abortController.abort()
      }, runTimeoutMs)
      const provider = readHeadlessModelProvider()
      const modelSettings = readHeadlessProviderModelSettings(provider)
      const apiKey = readRequiredProviderApiKey(provider)
      const events: AgentLoopEvent[] = []
      const { artifacts: imageArtifacts, attachments: imageAttachments } =
        readHeadlessImageAttachments(artifactRoot)
      const progress = createHeadlessProgressLogger({
        artifactRoot,
        headlessMode: headlessRunConfig.mode,
        maxRepairTurns,
        provider,
        runId,
        runTimeoutMs,
      })
      const sceneStore = createSceneStore(emptyScene)
      const assetLibraryStore = createAssetLibraryStore(
        createMemoryAssetLibraryRepository(),
      )
      const { client, exchanges } = createCapturedClient({
        apiKey,
        artifactRoot,
        modelSettings,
        progress,
        provider,
        repairReplaySeed,
        shouldStopBeforeRequest: () =>
          repeatedFailureStopper.getStopReason() ??
          patchApplicationStopper.getStopReason(),
      })
      const runStartedAt = new Date()
      let validationAttemptCount = 0

      progress.logRunConfigured({
        headlessMode: headlessRunConfig.mode,
        imageAttachmentCount: imageAttachments.length,
        prompt,
        repairReplaySeedPath: repairReplaySeed?.path ?? null,
      })

      await assetLibraryStore.load()

      let result: Awaited<ReturnType<typeof runManifestAgentLoop>>

      try {
        result = await runManifestAgentLoop(
          {
            maxRepairTurns,
            imageAttachments,
            mode: 'create',
            providerContext: createHeadlessProviderContext(
              provider,
              modelSettings,
            ),
            runId,
            scene: emptyScene,
            signal: abortController.signal,
            userPrompt: prompt,
          },
          {
            client,
            onEvent: (event) => {
              events.push(event)
              progress.logAgentEvent(event)
              const patchStopState =
                patchApplicationStopper.recordAgentEvent(event)

              if (patchStopState) {
                progress.logPatchApplicationStopArmed(patchStopState)
              }
            },
            sceneStore,
            validateCandidate: (candidate) => {
              const validationResult = validateManifestAssetCandidate(candidate)

              validationAttemptCount += 1
              progress.logValidationAttempt(
                validationAttemptCount,
                validationResult.report,
              )
              const earlyStopState =
                repeatedFailureStopper.recordValidationReport(
                  validationResult.report,
                )

              if (earlyStopState) {
                progress.logEarlyStopArmed(earlyStopState)
              }

              return validationResult
            },
          },
        )
      } catch (error) {
        writeCrashArtifacts({
          artifactRoot,
          error,
          events,
          exchanges,
          expectReady: headlessRunConfig.expectReady,
          headlessMode: headlessRunConfig.mode,
          maxRepairTurns,
          prompt,
          repairReplaySeed,
          runId,
          runStartedAt,
          runCompletedAt: new Date(),
          runTimeoutMs,
          progressArtifact: progress.path,
        })
        throw error
      } finally {
        clearTimeout(runTimeout)
      }

      let savedVersionId: string | null = null
      let glbExports: HeadlessGlbArtifact[] = []
      const attemptGlbArtifacts = await writeAttemptGlbArtifacts(
        artifactRoot,
        result.history.attempts,
        progress,
      )

      if (result.status === 'ready') {
        const savedVersion = await assetLibraryStore.saveValidatedVersion({
          agentSessions: result.agentSessions,
          asset: result.asset,
          history: result.history,
          parentVersionId: null,
          validationReport: result.report,
        })

        savedVersionId = savedVersion.versionId
        sceneStore.setCreateAsset(result.asset, savedVersion.versionId)
        glbExports = await writeHeadlessGlbExports(artifactRoot, result.asset, {
          relativeDir: 'glb',
        })
      }

      writeHeadlessArtifacts({
        artifactRoot,
        attemptGlbArtifacts,
        events,
        exchanges,
        expectReady: headlessRunConfig.expectReady,
        headlessMode: headlessRunConfig.mode,
        maxRepairTurns,
        prompt,
        repairReplaySeed,
        provider,
        result,
        runId,
        runStartedAt,
        runCompletedAt: new Date(),
        runTimeoutMs,
        glbExports,
        imageArtifacts,
        savedVersionId,
        scene: sceneStore.getSnapshot().scene,
        library: assetLibraryStore.getSnapshot().library,
        progressArtifact: progress.path,
      })

      progress.logFinalResult(result)
      logHeadlessSummary(artifactRoot, result)

      if (headlessRunConfig.expectReady) {
        expect(result.status).toBe('ready')
      }
    },
    readNumberEnv(
      'HEADLESS_AGENT_TIMEOUT_MS',
      readNumberEnv('HEADLESS_AGENT_RUN_TIMEOUT_MS', defaultRunTimeoutMs) +
        60_000,
    ),
  )
})

function createCapturedClient({
  apiKey,
  artifactRoot,
  modelSettings,
  progress,
  provider,
  repairReplaySeed,
  shouldStopBeforeRequest,
}: {
  apiKey: string
  artifactRoot: string
  modelSettings: ProviderModelSettings
  progress?: HeadlessProgressLogger
  provider: HeadlessModelProvider
  repairReplaySeed?: HeadlessRepairReplaySeed | null
  shouldStopBeforeRequest?: () => string | null
}) {
  const realClient = createManifestProviderClient({
    apiKey,
    modelSettings,
    provider,
  })
  const exchanges: CapturedExchange[] = []
  let pendingRepairReplaySeed = repairReplaySeed ?? null
  const client: ManifestProviderClient = {
    async generateAsset(request) {
      const index = exchanges.length + 1
      const exchangeDir = `exchanges/${String(index).padStart(2, '0')}`
      const startedAt = new Date()
      const requestMetrics = createRequestMetrics(request)
      progress?.logModelRequestStart(index, request, requestMetrics)
      const requestJson = writeJsonArtifact(
        artifactRoot,
        `${exchangeDir}/request.json`,
        {
          metadata: request.prompt.metadata,
          ...requestMetrics,
        },
      )
      const systemPrompt = writeTextArtifact(
        artifactRoot,
        `${exchangeDir}/system-prompt.txt`,
        request.prompt.system,
      )
      const userPrompt = writeTextArtifact(
        artifactRoot,
        `${exchangeDir}/user-prompt.txt`,
        request.prompt.user,
      )
      const earlyStopReason = shouldStopBeforeRequest?.() ?? null
      let response: AgentResponse
      let syntheticSeedPath: string | null = null

      if (pendingRepairReplaySeed && index === 1) {
        syntheticSeedPath = pendingRepairReplaySeed.path
        response = {
          candidate: pendingRepairReplaySeed.candidate,
          rawText: `${JSON.stringify(pendingRepairReplaySeed.candidate, null, 2)}\n`,
          responseId: `headless-repair-seed:${basename(pendingRepairReplaySeed.path)}`,
          status: 'ok',
        }
        pendingRepairReplaySeed = null
      } else if (earlyStopReason) {
        response = {
          message: earlyStopReason,
          responseId: null,
          status: 'error',
        }
      } else {
        const progressInterval = setInterval(() => {
          progress?.logModelRequestStillWaiting(index, startedAt)
        }, readNumberEnv('HEADLESS_AGENT_PROGRESS_INTERVAL_MS', 30_000))

        try {
          response = await realClient.generateAsset(request)
        } catch (error) {
          progress?.logModelRequestFailed(index, startedAt, error)
          throw error
        } finally {
          clearInterval(progressInterval)
        }
      }

      const completedAt = new Date()
      const captured: CapturedExchange = {
        artifacts: {
          requestJson,
          systemPrompt,
          userPrompt,
        },
        index,
        metadata: request.prompt.metadata,
        provider,
        request: requestMetrics,
        response: {
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - startedAt.getTime(),
          responseId: 'responseId' in response ? response.responseId : null,
          startedAt: startedAt.toISOString(),
          status: response.status,
          ...(syntheticSeedPath
            ? {
                synthetic: true,
                syntheticSeedPath,
              }
            : {}),
          ...('statusCode' in response && response.statusCode
            ? { statusCode: response.statusCode }
            : {}),
        },
      }

      if (response.status === 'ok') {
        const candidateJson = `${JSON.stringify(response.candidate, null, 2)}\n`

        captured.artifacts.rawText = writeTextArtifact(
          artifactRoot,
          `${exchangeDir}/raw-response.json`,
          response.rawText,
        )
        captured.artifacts.candidateJson = writeJsonArtifact(
          artifactRoot,
          `${exchangeDir}/candidate.json`,
          response.candidate,
        )
        captured.response.rawTextChars = response.rawText.length
        captured.response.candidateJsonChars = candidateJson.length
        captured.response.approximateOutputTokens = estimateTokensFromChars(
          response.rawText.length,
        )
      } else {
        captured.artifacts.errorJson = writeJsonArtifact(
          artifactRoot,
          `${exchangeDir}/error.json`,
          response,
        )
      }

      exchanges.push(captured)
      progress?.logModelResponse(captured)

      return response
    },
  }

  return {
    client,
    exchanges,
  }
}

function createRequestMetrics(request: AgentRequest) {
  const promptChars = {
    system: request.prompt.system.length,
    total: request.prompt.system.length + request.prompt.user.length,
    user: request.prompt.user.length,
  }

  return {
    approximateInputTokens: estimateTokensFromChars(promptChars.total),
    imageAttachmentCount: request.imageAttachments?.length ?? 0,
    promptChars,
    userSectionChars: extractTopLevelTaggedSectionChars(request.prompt.user),
  }
}

function createHeadlessRepeatedFailureStopper(threshold: number) {
  let lastSignature: string | null = null
  let stopState: HeadlessRepeatedFailureStopState | null = null
  let streak = 0

  return {
    getStopReason() {
      return stopState?.reason ?? null
    },
    recordValidationReport(
      report: ValidationReport,
    ): HeadlessRepeatedFailureStopState | null {
      if (threshold <= 0 || report.valid) {
        lastSignature = null
        streak = 0
        return null
      }

      const clusters = createValidationFailureClusters(report.bundle.signals)
      const signature = createValidationFailureClusterSignature(clusters)

      if (!signature) {
        lastSignature = null
        streak = 0
        return null
      }

      if (signature === lastSignature) {
        streak += 1
      } else {
        lastSignature = signature
        streak = 1
      }

      if (stopState || streak < threshold) {
        return null
      }

      stopState = {
        clusters,
        reason: [
          `Headless repeated-failure stop: validation signature ${signature} repeated ${streak} times.`,
          `Top clusters: ${clusters
            .slice(0, 5)
            .map((cluster) => `${cluster.count}x ${cluster.label}`)
            .join('; ')}`,
          'Set HEADLESS_AGENT_REPEATED_FAILURE_STOP_STREAK=0 to disable this headless-only stop.',
        ].join(' '),
        signature,
        streak,
        threshold,
      }

      return stopState
    },
  }
}

function extractTopLevelTaggedSectionChars(value: string) {
  const sectionChars: Record<string, number> = {}
  const sectionPattern = /^<([a-z_]+)>\n([\s\S]*?)\n<\/\1>$/gm

  for (const match of value.matchAll(sectionPattern)) {
    sectionChars[match[1]] = match[2].length
  }

  return sectionChars
}

function estimateTokensFromChars(chars: number) {
  return Math.ceil(chars / 4)
}

function writeHeadlessArtifacts({
  artifactRoot,
  attemptGlbArtifacts,
  events,
  exchanges,
  expectReady,
  headlessMode,
  maxRepairTurns,
  prompt,
  repairReplaySeed,
  provider,
  result,
  runId,
  runStartedAt,
  runCompletedAt,
  runTimeoutMs,
  glbExports,
  imageArtifacts,
  savedVersionId,
  scene,
  library,
  progressArtifact,
}: {
  artifactRoot: string
  attemptGlbArtifacts: readonly HeadlessAttemptGlbArtifacts[]
  events: readonly AgentLoopEvent[]
  exchanges: readonly CapturedExchange[]
  expectReady: boolean
  headlessMode: HeadlessRunMode
  maxRepairTurns: number
  prompt: string
  repairReplaySeed: HeadlessRepairReplaySeed | null
  provider: HeadlessModelProvider
  result: Awaited<ReturnType<typeof runManifestAgentLoop>>
  runId: string
  runStartedAt: Date
  runCompletedAt: Date
  runTimeoutMs: number
  glbExports: readonly HeadlessGlbArtifact[]
  imageArtifacts: readonly HeadlessImageArtifact[]
  savedVersionId: string | null
  scene: ManifestScene
  library: unknown
  progressArtifact: string
}) {
  writeJsonArtifact(artifactRoot, 'events.json', events)
  writeJsonArtifact(artifactRoot, 'scene.json', scene)
  writeJsonArtifact(artifactRoot, 'asset-library.json', library)
  writeJsonArtifact(artifactRoot, 'history.json', result.history)

  result.history.attempts.forEach((attempt, index) => {
    const attemptDir = `attempts/${String(index + 1).padStart(2, '0')}`

    writeJsonArtifact(artifactRoot, `${attemptDir}/candidate.json`, attempt.candidate)
    writeJsonArtifact(artifactRoot, `${attemptDir}/report.json`, attempt.report)
    if (attempt.probeReport) {
      writeJsonArtifact(artifactRoot, `${attemptDir}/probe.json`, attempt.probeReport)
    }
    writeJsonArtifact(
      artifactRoot,
      `${attemptDir}/signals.json`,
      attempt.report.bundle.signals,
    )
  })

  writeJsonArtifact(artifactRoot, 'summary.json', {
    artifactRoot,
    attemptCount: result.history.attempts.length,
    createdAt: new Date().toISOString(),
    exchangeCount: exchanges.length,
    exchanges,
    expectReady,
    prompt,
    provider,
    repairReplay: repairReplaySeed
      ? {
          candidatePath: repairReplaySeed.path,
        }
      : null,
    runCompletedAt: runCompletedAt.toISOString(),
    runDurationMs: runCompletedAt.getTime() - runStartedAt.getTime(),
    resultStatus: result.status,
    runId,
    runStartedAt: runStartedAt.toISOString(),
    runTimeoutMs,
    maxRepairTurns,
    progressArtifact,
    glbExports,
    glbViewerUrls: glbExports
      .map((glbExport) => glbExport.viewerUrl)
      .filter((viewerUrl): viewerUrl is string => viewerUrl !== null),
    headlessMode,
    imageArtifacts,
    imageAttachmentCount: imageArtifacts.length,
    savedVersionId,
    sceneAssetIds: scene.assets.map((asset) => asset.id),
    attempts: result.history.attempts.map((attempt, index) => ({
      glbArtifacts:
        attemptGlbArtifacts.find((entry) => entry.attemptId === attempt.id) ??
        null,
      failureCount: attempt.report.summary.failureCount,
      failureClusters: attempt.failureClusters,
      failureSignature: attempt.failureSignature,
      failureStreak: attempt.failureStreak,
      id: attempt.id,
      probeArtifact: attempt.probeReport
        ? `${artifactRoot}/attempts/${String(index + 1).padStart(2, '0')}/probe.json`
        : null,
      repeatedFailure: attempt.repeatedFailure,
      status: attempt.status,
      validationStatus: attempt.report.bundle.status,
    })),
    message: 'message' in result ? result.message : null,
  })
}

function writeCrashArtifacts({
  artifactRoot,
  error,
  events,
  exchanges,
  expectReady,
  headlessMode,
  maxRepairTurns,
  prompt,
  repairReplaySeed,
  runId,
  runStartedAt,
  runCompletedAt,
  runTimeoutMs,
  progressArtifact,
}: {
  artifactRoot: string
  error: unknown
  events: readonly AgentLoopEvent[]
  exchanges: readonly CapturedExchange[]
  expectReady: boolean
  headlessMode: HeadlessRunMode
  maxRepairTurns: number
  prompt: string
  repairReplaySeed: HeadlessRepairReplaySeed | null
  runId: string
  runStartedAt: Date
  runCompletedAt: Date
  runTimeoutMs: number
  progressArtifact: string
}) {
  writeJsonArtifact(artifactRoot, 'events.json', events)
  writeJsonArtifact(artifactRoot, 'summary.json', {
    artifactRoot,
    createdAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
    exchangeCount: exchanges.length,
    exchanges,
    expectReady,
    headlessMode,
    maxRepairTurns,
    prompt,
    repairReplay: repairReplaySeed
      ? {
          candidatePath: repairReplaySeed.path,
        }
      : null,
    resultStatus: 'crashed',
    runCompletedAt: runCompletedAt.toISOString(),
    runDurationMs: runCompletedAt.getTime() - runStartedAt.getTime(),
    runId,
    runStartedAt: runStartedAt.toISOString(),
    runTimeoutMs,
    progressArtifact,
  })
}

function logHeadlessSummary(
  artifactRoot: string,
  result: Awaited<ReturnType<typeof runManifestAgentLoop>>,
) {
  console.info(`Headless artifacts: ${artifactRoot}`)
  console.info(`Headless result: ${result.status}`)

  for (const [index, attempt] of result.history.attempts.entries()) {
    const failures = attempt.report.bundle.signals.filter(
      (signal) => signal.severity === 'failure',
    )

    console.info(
      `Attempt ${index + 1}: ${attempt.status}; failures=${failures.length}; repeated=${attempt.repeatedFailure}`,
    )

    for (const signal of failures.slice(0, 12)) {
      console.info(
        `  - [${signal.stage}/${signal.code}] ${signal.summary}${signal.details ? ` details=${signal.details}` : ''}`,
      )
    }
  }
}

function readHeadlessImageAttachments(artifactRoot: string): {
  artifacts: HeadlessImageArtifact[]
  attachments: AgentImageAttachment[]
} {
  const imagePaths = readImageAttachmentPaths()

  if (imagePaths.length === 0) {
    return {
      artifacts: [],
      attachments: [],
    }
  }

  const artifacts: HeadlessImageArtifact[] = []
  const attachments = imagePaths.map((imagePath, index) => {
    const absolutePath = resolve(process.cwd(), imagePath)
    const content = readFileSync(absolutePath)
    const mediaType = inferImageMediaType(absolutePath)
    const name = basename(absolutePath)
    const artifactPath = writeBinaryArtifact(
      artifactRoot,
      `reference-images/${String(index + 1).padStart(2, '0')}-${name}`,
      content,
    )

    artifacts.push({
      mediaType,
      name,
      path: artifactPath,
    })

    return {
      id: `headless-ref-${index + 1}`,
      imageUrl: `data:${mediaType};base64,${content.toString('base64')}`,
      mediaType,
      name,
    }
  })

  return {
    artifacts,
    attachments,
  }
}

function readHeadlessRepairReplaySeed(
  candidatePath: string | null,
): HeadlessRepairReplaySeed | null {
  if (!candidatePath) {
    return null
  }

  const resolvedPath = resolve(process.cwd(), candidatePath)

  if (!existsSync(resolvedPath)) {
    throw new Error(
      `HEADLESS_AGENT_REPAIR_FROM_CANDIDATE_PATH does not exist: ${resolvedPath}`,
    )
  }

  return {
    candidate: JSON.parse(readFileSync(resolvedPath, 'utf8')) as unknown,
    path: resolvedPath,
  }
}

function getRepairReplayPromptFallback(seed: HeadlessRepairReplaySeed | null) {
  if (!seed || !isRecord(seed.candidate)) {
    return null
  }

  return typeof seed.candidate.prompt === 'string' ? seed.candidate.prompt : null
}

function readImageAttachmentPaths() {
  const combined = [
    process.env.HEADLESS_AGENT_IMAGE_PATH,
    process.env.HEADLESS_AGENT_IMAGE_PATHS,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(',')

  if (!combined) {
    return []
  }

  return combined
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function inferImageMediaType(path: string) {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.png':
      return 'image/png'
    default:
      throw new Error(
        `Unsupported headless image extension for "${path}". Use PNG, JPEG, WEBP, or GIF.`,
      )
  }
}

async function writeHeadlessGlbExports(
  artifactRoot: string,
  asset: ManifestAsset,
  options: {
    relativeDir: string
  },
): Promise<HeadlessGlbArtifact[]> {
  const artifacts: HeadlessGlbArtifact[] = []
  const staticExport = await exportManifestAssetGlb(asset, { mode: 'static' })

  artifacts.push(
    writeHeadlessGlbArtifact(
      artifactRoot,
      options.relativeDir,
      'static',
      staticExport,
    ),
  )

  if (canExportManifestAssetAnimation(asset)) {
    const dynamicExport = await exportManifestAssetGlb(asset, { mode: 'dynamic' })

    artifacts.push(
      writeHeadlessGlbArtifact(
        artifactRoot,
        options.relativeDir,
        'dynamic',
        dynamicExport,
      ),
    )
  }

  return artifacts
}

async function writeAttemptGlbArtifacts(
  artifactRoot: string,
  attempts: readonly HeadlessAttempt[],
  progress?: HeadlessProgressLogger,
): Promise<HeadlessAttemptGlbArtifacts[]> {
  const artifacts: HeadlessAttemptGlbArtifacts[] = []

  for (const [index, attempt] of attempts.entries()) {
    const attemptIndex = index + 1
    const attemptDir = `attempts/${String(attemptIndex).padStart(2, '0')}`
    const parsed = safeParseManifestAsset(attempt.candidate)

    progress?.logGlbExportStart(attemptIndex, attempts.length)

    if (!parsed.success) {
      const artifact: HeadlessAttemptGlbArtifacts = {
        attemptId: attempt.id,
        attemptIndex,
        glbExports: [],
        message: 'Candidate did not parse as a Manifest3D asset.',
        status: 'skipped',
      }

      writeJsonArtifact(artifactRoot, `${attemptDir}/glb-exports.json`, artifact)
      artifacts.push(artifact)
      progress?.logGlbExportComplete(attemptIndex, artifact)
      continue
    }

    try {
      const glbExports = await writeHeadlessGlbExports(artifactRoot, parsed.data, {
        relativeDir: `${attemptDir}/glb`,
      })
      const artifact: HeadlessAttemptGlbArtifacts = {
        attemptId: attempt.id,
        attemptIndex,
        glbExports,
        message: null,
        status: 'exported',
      }

      writeJsonArtifact(artifactRoot, `${attemptDir}/glb-exports.json`, artifact)
      artifacts.push(artifact)
      progress?.logGlbExportComplete(attemptIndex, artifact)
    } catch (error) {
      const artifact: HeadlessAttemptGlbArtifacts = {
        attemptId: attempt.id,
        attemptIndex,
        glbExports: [],
        message: error instanceof Error ? error.message : String(error),
        status: 'failed',
      }

      writeJsonArtifact(artifactRoot, `${attemptDir}/glb-exports.json`, artifact)
      artifacts.push(artifact)
      progress?.logGlbExportComplete(attemptIndex, artifact)
    }
  }

  return artifacts
}

function createHeadlessProgressLogger({
  artifactRoot,
  headlessMode,
  maxRepairTurns,
  provider,
  runId,
  runTimeoutMs,
}: {
  artifactRoot: string
  headlessMode: HeadlessRunMode
  maxRepairTurns: number
  provider: HeadlessModelProvider
  runId: string
  runTimeoutMs: number
}): HeadlessProgressLogger {
  const startedAt = new Date()
  const maxAttempts = maxRepairTurns + 1
  const path = writeTextArtifact(artifactRoot, 'progress.jsonl', '')

  function elapsedMs(now = new Date()) {
    return now.getTime() - startedAt.getTime()
  }

  function record(type: string, data: Record<string, unknown>) {
    appendFileSync(
      path,
      `${JSON.stringify({
        at: new Date().toISOString(),
        elapsedMs: elapsedMs(),
        type,
        ...data,
      })}\n`,
      'utf8',
    )
  }

  function log(message: string, data: Record<string, unknown> = {}) {
    console.info(`[headless] +${formatDuration(elapsedMs())} ${message}`)
    record('progress', {
      message,
      ...data,
    })
  }

  log(
    `run started mode=${headlessMode} provider=${provider} maxAttempts=${maxAttempts} timeout=${formatDuration(runTimeoutMs)}`,
    {
      artifactRoot,
      headlessMode,
      maxAttempts,
      maxRepairTurns,
      provider,
      runId,
      runTimeoutMs,
    },
  )

  return {
    logEarlyStopArmed(state) {
      log(
        `headless repeated-failure stop armed signature=${state.signature} streak=${state.streak}/${state.threshold}`,
        {
          repeatedFailureStop: state,
        },
      )
    },
    logPatchApplicationStopArmed(state) {
      log(
        `headless patch-application stop armed streak=${state.streak}/${state.threshold}`,
        {
          patchApplicationStop: state,
        },
      )
    },
    logAgentEvent(event) {
      record('agent_event', { event })

      if (event.status === 'failed' && event.state !== 'validating_candidate') {
        log(`agent event failed: ${event.label}${formatDetail(event.detail)}`, {
          event,
        })
      }
    },
    logFinalResult(result) {
      log(
        `run finished status=${result.status} attempts=${result.history.attempts.length}`,
        {
          attemptCount: result.history.attempts.length,
          status: result.status,
        },
      )
    },
    logGlbExportComplete(attemptIndex, artifact) {
      log(
        `attempt ${attemptIndex} GLB export ${artifact.status} exports=${artifact.glbExports.length}`,
        {
          artifact,
          attemptIndex,
        },
      )
    },
    logGlbExportStart(attemptIndex, attemptCount) {
      log(`exporting attempt GLBs ${attemptIndex}/${attemptCount}`, {
        attemptCount,
        attemptIndex,
      })
    },
    logModelRequestFailed(index, requestStartedAt, error) {
      log(
        `exchange ${index}/${maxAttempts} model request threw after ${formatDuration(
          new Date().getTime() - requestStartedAt.getTime(),
        )}: ${error instanceof Error ? error.message : String(error)}`,
        {
          error: error instanceof Error ? error.message : String(error),
          exchangeIndex: index,
          maxAttempts,
        },
      )
    },
    logModelRequestStart(index, request, metrics) {
      log(
        `exchange ${index}/${maxAttempts} request start mode=${request.prompt.metadata.mode} input~${metrics.approximateInputTokens} tokens promptChars=${metrics.promptChars.total}`,
        {
          exchangeIndex: index,
          maxAttempts,
          metadata: request.prompt.metadata,
          request: metrics,
        },
      )
    },
    logModelRequestStillWaiting(index, requestStartedAt) {
      log(
        `exchange ${index}/${maxAttempts} still waiting modelElapsed=${formatDuration(
          new Date().getTime() - requestStartedAt.getTime(),
        )}`,
        {
          exchangeIndex: index,
          maxAttempts,
        },
      )
    },
    logModelResponse(exchange) {
      log(
        `exchange ${exchange.index}/${maxAttempts} response status=${exchange.response.status} duration=${formatDuration(exchange.response.durationMs)} output~${exchange.response.approximateOutputTokens ?? 'n/a'} tokens`,
        {
          exchange,
          maxAttempts,
        },
      )
    },
    logRunConfigured({
      headlessMode,
      imageAttachmentCount,
      prompt,
      repairReplaySeedPath,
    }) {
      log(
        `prompt configured mode=${headlessMode} chars=${prompt.length} imageAttachments=${imageAttachmentCount}${
          repairReplaySeedPath ? ' repairReplay=seeded' : ''
        }`,
        {
          headlessMode,
          imageAttachmentCount,
          prompt,
          repairReplaySeedPath,
        },
      )
    },
    logValidationAttempt(attemptIndex, report) {
      const summary = summarizeValidationReport(report)
      const topFailures = summary.topFailures
        .map((failure) => `${failure.count}x ${failure.label}`)
        .join('; ')
      const suffix = topFailures ? ` top=${topFailures}` : ''

      log(
        `attempt ${attemptIndex}/${maxAttempts} validation ${report.bundle.status} failures=${summary.failureCount} warnings=${summary.warningCount}${suffix}`,
        {
          attemptIndex,
          maxAttempts,
          validation: summary,
        },
      )
    },
    path,
  }
}

function summarizeValidationReport(report: ValidationReport) {
  const failures = report.bundle.signals.filter(
    (signal) => signal.severity === 'failure',
  )

  return {
    failureCount: report.summary.failureCount,
    noteCount: report.summary.noteCount,
    status: report.bundle.status,
    topFailures: summarizeFailureClusters(failures),
    valid: report.valid,
    warningCount: report.summary.warningCount,
  }
}

function summarizeFailureClusters(signals: readonly ValidationSignal[]) {
  const clusters = new Map<string, { count: number; label: string }>()

  for (const signal of signals) {
    const label = formatFailureClusterLabel(signal)
    const existing = clusters.get(label)

    if (existing) {
      existing.count += 1
    } else {
      clusters.set(label, { count: 1, label })
    }
  }

  return [...clusters.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 5)
}

function formatFailureClusterLabel(signal: ValidationSignal) {
  const refs = signal.refs ?? {}
  const partPair = [refs.partAId, refs.partBId]
    .filter((partId): partId is string => Boolean(partId))
    .sort()
    .join('<->')
  const refSuffix = partPair ? ` ${partPair}` : ''

  return `[${signal.stage}/${signal.code}]${refSuffix}`
}

function formatDetail(detail: string | null) {
  return detail ? ` detail=${detail}` : ''
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)

  if (hours > 0) {
    return `${hours}h${minutes}m${seconds}s`
  }

  if (minutes > 0) {
    return `${minutes}m${seconds}s`
  }

  return `${seconds}s`
}

function writeHeadlessGlbArtifact(
  artifactRoot: string,
  relativeDir: string,
  mode: GlbExportMode,
  result: Awaited<ReturnType<typeof exportManifestAssetGlb>>,
): HeadlessGlbArtifact {
  const fileName =
    mode === 'dynamic'
      ? addFileNameSuffix(result.fileName, 'dynamic')
      : result.fileName
  const path = writeBinaryArtifact(
    artifactRoot,
    `${relativeDir}/${fileName}`,
    result.arrayBuffer,
  )

  return {
    byteLength: result.arrayBuffer.byteLength,
    fileName,
    mode,
    path,
    viewerUrl: createHeadlessGlbViewerUrl(path),
  }
}

function addFileNameSuffix(fileName: string, suffix: string) {
  return fileName.endsWith('.glb')
    ? `${fileName.slice(0, -4)}.${suffix}.glb`
    : `${fileName}.${suffix}.glb`
}

function createHeadlessGlbViewerUrl(targetPath: string) {
  const serverRoot = resolve(process.cwd(), 'test/headless')
  const relativeSrc = relative(serverRoot, targetPath).replaceAll('\\', '/')

  if (relativeSrc.startsWith('../') || relativeSrc === '..') {
    return null
  }

  return `http://localhost:3000/glb_viewer.html?src=${encodeURI(relativeSrc)}`
}

function createArtifactRoot(runId: string) {
  const baseDir = readStringEnv(
    'HEADLESS_AGENT_ARTIFACT_DIR',
    'test/headless/artifacts/headless-agent',
  )
  const artifactRoot = resolve(process.cwd(), baseDir, runId.replace(/[:]/g, '-'))

  mkdirSync(artifactRoot, { recursive: true })

  return artifactRoot
}

function writeJsonArtifact(
  artifactRoot: string,
  relativePath: string,
  value: unknown,
) {
  return writeTextArtifact(
    artifactRoot,
    relativePath,
    `${JSON.stringify(value, null, 2)}\n`,
  )
}

function writeTextArtifact(
  artifactRoot: string,
  relativePath: string,
  content: string,
) {
  const targetPath = resolve(artifactRoot, relativePath)

  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, content, 'utf8')

  return targetPath
}

function writeBinaryArtifact(
  artifactRoot: string,
  relativePath: string,
  content: ArrayBuffer | Uint8Array,
) {
  const targetPath = resolve(artifactRoot, relativePath)

  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, Buffer.from(content))

  return targetPath
}

function readHeadlessModelProvider(): HeadlessModelProvider {
  const provider = readStringEnv('HEADLESS_AGENT_PROVIDER', 'openai')
    .trim()
    .toLowerCase()

  return parseModelProvider(provider)
}

function readHeadlessProviderModelSettings(
  provider: HeadlessModelProvider,
): ProviderModelSettings {
  const defaults = createDefaultHeadlessProviderModelSettings(provider)
  const providerEnvPrefix = provider.toUpperCase()
  const modelId =
    readStringEnv(`HEADLESS_${providerEnvPrefix}_MODEL_ID`, '') ||
    readStringEnv('HEADLESS_AGENT_MODEL_ID', '') ||
    defaults.modelId
  const reasoningEffort =
    readStringEnv(`HEADLESS_${providerEnvPrefix}_REASONING_EFFORT`, '') ||
    readStringEnv('HEADLESS_AGENT_REASONING_EFFORT', '') ||
    defaults.reasoningEffort

  return {
    modelId,
    reasoningEffort,
  }
}

function createDefaultHeadlessProviderModelSettings(
  provider: HeadlessModelProvider,
): ProviderModelSettings {
  if (provider === 'gemini') {
    return {
      modelId: geminiModelConfig.model,
      reasoningEffort: geminiModelConfig.thinkingLevel,
    }
  }

  if (provider === 'openrouter') {
    return {
      modelId: openRouterModelConfig.model,
      reasoningEffort: openRouterModelConfig.reasoningEffort,
    }
  }

  return {
    modelId: modelConfig.model,
    reasoningEffort: modelConfig.reasoningEffort,
  }
}

function createHeadlessProviderContext(
  provider: HeadlessModelProvider,
  settings: ProviderModelSettings,
) {
  return {
    modelId: settings.modelId,
    provider,
    reasoningEffort: settings.reasoningEffort,
  }
}

function readRequiredProviderApiKey(provider: HeadlessModelProvider) {
  const apiKey =
    provider === 'openrouter'
      ? readFirstEnvOrDotEnv(['OPENROUTER_API_KEY'])
      : provider === 'gemini'
      ? readFirstEnvOrDotEnv([
          'GEMINI_API_KEY',
          'GOOGLE_API_KEY',
          'VITE_GEMINI_API_KEY',
          'VITE_GOOGLE_API_KEY',
        ])
      : readFirstEnvOrDotEnv(['OPENAI_API_KEY', 'VITE_OPENAI_API_KEY'])

  if (!apiKey) {
    throw new Error(
      `Headless agent smoke requires a ${provider} API key in the environment or .env.`,
    )
  }

  return apiKey
}

function readFirstEnvOrDotEnv(keys: readonly string[]) {
  for (const key of keys) {
    const value = readStringEnv(key, '') || readDotEnvValue(key)

    if (value) {
      return value
    }
  }

  return ''
}

function readDotEnvValue(key: string) {
  const envPath = resolve(process.cwd(), '.env')

  if (!existsSync(envPath)) {
    return ''
  }

  const content = readFileSync(envPath, 'utf8')

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)

    if (!match || match[1] !== key) {
      continue
    }

    return unquoteEnvValue(match[2]).trim()
  }

  return ''
}

function unquoteEnvValue(value: string) {
  const trimmed = value.trim()

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function readStringEnv(key: string, fallback: string) {
  const value = process.env[key]?.trim()

  return value && value.length > 0 ? value : fallback
}

function readNumberEnv(key: string, fallback: number) {
  const value = Number(process.env[key])

  return Number.isFinite(value) && value > 0 ? value : fallback
}

function readNonNegativeNumberEnv(key: string, fallback: number) {
  const value = Number(process.env[key])

  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function readBooleanEnv(key: string, fallback: boolean) {
  const value = process.env[key]?.trim().toLowerCase()

  if (!value) {
    return fallback
  }

  return !['0', 'false', 'no', 'off'].includes(value)
}

function isHeadlessAgentEnabled() {
  return readBooleanEnv('MANIFEST3D_HEADLESS_AGENT', false)
}

function safeTimestamp() {
  return new Date().toISOString().replace(/[.]/g, '-')
}

function createHeadlessRunId() {
  return `headless:${safeTimestamp()}:${process.pid}:${randomUUID().slice(0, 8)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class HeadlessFileReader {
  onloadend: (() => void) | null = null
  result: ArrayBuffer | string | null = null

  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((arrayBuffer) => {
      this.result = arrayBuffer
      this.onloadend?.()
    })
  }

  readAsDataURL() {
    throw new Error('Headless GLB export only reads binary buffers.')
  }
}
