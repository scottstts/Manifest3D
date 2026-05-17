import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runManifestAgentLoop, type AgentLoopEvent } from '../../src/engine/agent/agentLoop'
import { createOpenAIManifestClient } from '../../src/engine/agent/openAiManifestClient'
import type {
  AgentRequest,
  AgentResponse,
  OpenAIManifestClient,
} from '../../src/engine/agent/providerClient'
import { createAssetLibraryStore } from '../../src/engine/persistence/assetLibraryStore'
import { createMemoryAssetLibraryRepository } from '../../src/engine/persistence/assetLibraryRepository'
import { createSceneStore } from '../../src/engine/scene/sceneStore'
import type { ManifestScene } from '../../src/engine/schema/manifestTypes'

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
  response: {
    responseId: string | null
    status: AgentResponse['status']
    statusCode?: number
  }
}

// intentionally use a more difficult prompt to stress test the pipeline
const defaultPrompt =
  'a silver boxy pickup truck with spinning wheels and front wheels that can turn left and right'
const emptyScene: ManifestScene = {
  assets: [],
  schemaVersion: 1,
  units: 'meters',
}
const describeLiveHeadless = isHeadlessAgentEnabled() ? describe : describe.skip

describeLiveHeadless('headless agent pipeline smoke', () => {
  it(
    'runs the real create pipeline and captures every candidate attempt',
    async () => {
      const prompt = readStringEnv('HEADLESS_AGENT_PROMPT', defaultPrompt)
      const runId = `headless:${safeTimestamp()}`
      const artifactRoot = createArtifactRoot(runId)
      const runTimeoutMs = readNumberEnv('HEADLESS_AGENT_RUN_TIMEOUT_MS', 540_000)
      const abortController = new AbortController()
      const runTimeout = setTimeout(() => {
        abortController.abort()
      }, runTimeoutMs)
      const apiKey = readRequiredOpenAIApiKey()
      const events: AgentLoopEvent[] = []
      const sceneStore = createSceneStore(emptyScene)
      const assetLibraryStore = createAssetLibraryStore(
        createMemoryAssetLibraryRepository(),
      )
      const { client, exchanges } = createCapturedClient({
        apiKey,
        artifactRoot,
      })

      await assetLibraryStore.load()

      let result: Awaited<ReturnType<typeof runManifestAgentLoop>>

      try {
        result = await runManifestAgentLoop(
          {
            maxRepairTurns: readNumberEnv('HEADLESS_AGENT_MAX_REPAIR_TURNS', 4),
            mode: 'create',
            runId,
            scene: emptyScene,
            signal: abortController.signal,
            userPrompt: prompt,
          },
          {
            client,
            onEvent: (event) => {
              events.push(event)
            },
            sceneStore,
          },
        )
      } catch (error) {
        writeCrashArtifacts({
          artifactRoot,
          error,
          events,
          exchanges,
          prompt,
          runId,
          runTimeoutMs,
        })
        throw error
      } finally {
        clearTimeout(runTimeout)
      }

      let savedVersionId: string | null = null

      if (result.status === 'ready') {
        const savedVersion = await assetLibraryStore.saveValidatedVersion({
          asset: result.asset,
          history: result.history,
          parentVersionId: null,
          validationReport: result.report,
        })

        savedVersionId = savedVersion.versionId
        sceneStore.setCreateAsset(result.asset, savedVersion.versionId)
      }

      writeHeadlessArtifacts({
        artifactRoot,
        events,
        exchanges,
        prompt,
        result,
        runId,
        runTimeoutMs,
        savedVersionId,
        scene: sceneStore.getSnapshot().scene,
        library: assetLibraryStore.getSnapshot().library,
      })

      logHeadlessSummary(artifactRoot, result)

      if (readBooleanEnv('HEADLESS_AGENT_EXPECT_READY', true)) {
        expect(result.status).toBe('ready')
      }
    },
    readNumberEnv(
      'HEADLESS_AGENT_TIMEOUT_MS',
      readNumberEnv('HEADLESS_AGENT_RUN_TIMEOUT_MS', 540_000) + 60_000,
    ),
  )
})

function createCapturedClient({
  apiKey,
  artifactRoot,
}: {
  apiKey: string
  artifactRoot: string
}) {
  const realClient = createOpenAIManifestClient({ apiKey })
  const exchanges: CapturedExchange[] = []
  const client: OpenAIManifestClient = {
    async generateAsset(request) {
      const index = exchanges.length + 1
      const exchangeDir = `exchanges/${String(index).padStart(2, '0')}`
      const requestJson = writeJsonArtifact(
        artifactRoot,
        `${exchangeDir}/request.json`,
        {
          imageAttachmentCount: request.imageAttachments?.length ?? 0,
          metadata: request.prompt.metadata,
          promptChars: {
            system: request.prompt.system.length,
            user: request.prompt.user.length,
          },
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
      const response = await realClient.generateAsset(request)
      const captured: CapturedExchange = {
        artifacts: {
          requestJson,
          systemPrompt,
          userPrompt,
        },
        index,
        metadata: request.prompt.metadata,
        response: {
          responseId: 'responseId' in response ? response.responseId : null,
          status: response.status,
          ...('statusCode' in response && response.statusCode
            ? { statusCode: response.statusCode }
            : {}),
        },
      }

      if (response.status === 'ok') {
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
      } else {
        captured.artifacts.errorJson = writeJsonArtifact(
          artifactRoot,
          `${exchangeDir}/error.json`,
          response,
        )
      }

      exchanges.push(captured)

      return response
    },
  }

  return {
    client,
    exchanges,
  }
}

function writeHeadlessArtifacts({
  artifactRoot,
  events,
  exchanges,
  prompt,
  result,
  runId,
  runTimeoutMs,
  savedVersionId,
  scene,
  library,
}: {
  artifactRoot: string
  events: readonly AgentLoopEvent[]
  exchanges: readonly CapturedExchange[]
  prompt: string
  result: Awaited<ReturnType<typeof runManifestAgentLoop>>
  runId: string
  runTimeoutMs: number
  savedVersionId: string | null
  scene: ManifestScene
  library: unknown
}) {
  writeJsonArtifact(artifactRoot, 'events.json', events)
  writeJsonArtifact(artifactRoot, 'scene.json', scene)
  writeJsonArtifact(artifactRoot, 'asset-library.json', library)
  writeJsonArtifact(artifactRoot, 'history.json', result.history)

  result.history.attempts.forEach((attempt, index) => {
    const attemptDir = `attempts/${String(index + 1).padStart(2, '0')}`

    writeJsonArtifact(artifactRoot, `${attemptDir}/candidate.json`, attempt.candidate)
    writeJsonArtifact(artifactRoot, `${attemptDir}/report.json`, attempt.report)
    writeJsonArtifact(
      artifactRoot,
      `${attemptDir}/signals.json`,
      attempt.report.bundle.signals,
    )
  })

  writeJsonArtifact(artifactRoot, 'summary.json', {
    artifactRoot,
    createdAt: new Date().toISOString(),
    exchanges,
    prompt,
    resultStatus: result.status,
    runId,
    runTimeoutMs,
    savedVersionId,
    sceneAssetIds: scene.assets.map((asset) => asset.id),
    attempts: result.history.attempts.map((attempt) => ({
      failureCount: attempt.report.summary.failureCount,
      failureSignature: attempt.failureSignature,
      failureStreak: attempt.failureStreak,
      id: attempt.id,
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
  prompt,
  runId,
  runTimeoutMs,
}: {
  artifactRoot: string
  error: unknown
  events: readonly AgentLoopEvent[]
  exchanges: readonly CapturedExchange[]
  prompt: string
  runId: string
  runTimeoutMs: number
}) {
  writeJsonArtifact(artifactRoot, 'events.json', events)
  writeJsonArtifact(artifactRoot, 'summary.json', {
    artifactRoot,
    createdAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
    exchanges,
    prompt,
    resultStatus: 'crashed',
    runId,
    runTimeoutMs,
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

function createArtifactRoot(runId: string) {
  const baseDir = readStringEnv(
    'HEADLESS_AGENT_ARTIFACT_DIR',
    'test/artifacts/headless-agent',
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

function readRequiredOpenAIApiKey() {
  const apiKey =
    readStringEnv('OPENAI_API_KEY', '') ||
    readStringEnv('VITE_OPENAI_API_KEY', '') ||
    readDotEnvValue('OPENAI_API_KEY') ||
    readDotEnvValue('VITE_OPENAI_API_KEY')

  if (!apiKey) {
    throw new Error(
      'Headless agent smoke requires OPENAI_API_KEY or VITE_OPENAI_API_KEY in the environment or .env.',
    )
  }

  return apiKey
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
