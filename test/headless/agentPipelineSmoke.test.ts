import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'
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
      const fetchTimeoutMs = readNumberEnv(
        'HEADLESS_AGENT_FETCH_TIMEOUT_MS',
        runTimeoutMs + 30_000,
      )
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
        fetchTimeoutMs,
      })
      const runStartedAt = new Date()

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
          runStartedAt,
          runCompletedAt: new Date(),
          fetchTimeoutMs,
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
        runStartedAt,
        runCompletedAt: new Date(),
        fetchTimeoutMs,
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
  fetchTimeoutMs,
}: {
  apiKey: string
  artifactRoot: string
  fetchTimeoutMs: number
}) {
  const realClient = createOpenAIManifestClient({
    apiKey,
    fetcher: createHeadlessHttpsFetcher(fetchTimeoutMs),
  })
  const exchanges: CapturedExchange[] = []
  const client: OpenAIManifestClient = {
    async generateAsset(request) {
      const index = exchanges.length + 1
      const exchangeDir = `exchanges/${String(index).padStart(2, '0')}`
      const startedAt = new Date()
      const requestMetrics = createRequestMetrics(request)
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
      const response = await realClient.generateAsset(request)
      const completedAt = new Date()
      const captured: CapturedExchange = {
        artifacts: {
          requestJson,
          systemPrompt,
          userPrompt,
        },
        index,
        metadata: request.prompt.metadata,
        request: requestMetrics,
        response: {
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - startedAt.getTime(),
          responseId: 'responseId' in response ? response.responseId : null,
          startedAt: startedAt.toISOString(),
          status: response.status,
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
  events,
  exchanges,
  prompt,
  result,
  runId,
  runStartedAt,
  runCompletedAt,
  fetchTimeoutMs,
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
  runStartedAt: Date
  runCompletedAt: Date
  fetchTimeoutMs: number
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
    attemptCount: result.history.attempts.length,
    createdAt: new Date().toISOString(),
    exchangeCount: exchanges.length,
    exchanges,
    prompt,
    runCompletedAt: runCompletedAt.toISOString(),
    runDurationMs: runCompletedAt.getTime() - runStartedAt.getTime(),
    resultStatus: result.status,
    runId,
    runStartedAt: runStartedAt.toISOString(),
    fetchTimeoutMs,
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
  runStartedAt,
  runCompletedAt,
  fetchTimeoutMs,
  runTimeoutMs,
}: {
  artifactRoot: string
  error: unknown
  events: readonly AgentLoopEvent[]
  exchanges: readonly CapturedExchange[]
  prompt: string
  runId: string
  runStartedAt: Date
  runCompletedAt: Date
  fetchTimeoutMs: number
  runTimeoutMs: number
}) {
  writeJsonArtifact(artifactRoot, 'events.json', events)
  writeJsonArtifact(artifactRoot, 'summary.json', {
    artifactRoot,
    createdAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
    exchangeCount: exchanges.length,
    exchanges,
    prompt,
    resultStatus: 'crashed',
    runCompletedAt: runCompletedAt.toISOString(),
    runDurationMs: runCompletedAt.getTime() - runStartedAt.getTime(),
    runId,
    runStartedAt: runStartedAt.toISOString(),
    fetchTimeoutMs,
    runTimeoutMs,
  })
}

function createHeadlessHttpsFetcher(timeoutMs: number) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    new Promise((resolve, reject) => {
      const url = new URL(String(input))
      const body = normalizeRequestBody(init?.body)
      const request = httpsRequest(
        url,
        {
          headers: headersToObject(init?.headers),
          method: init?.method ?? 'GET',
        },
        (response) => {
          const chunks: Buffer[] = []

          response.on('data', (chunk: Buffer) => {
            chunks.push(chunk)
          })
          response.on('end', () => {
            resolve(
              new Response(Buffer.concat(chunks), {
                headers: responseHeadersToHeaders(response.headers),
                status: response.statusCode ?? 500,
                statusText: response.statusMessage,
              }),
            )
          })
        },
      )

      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error(`Headless OpenAI request timed out after ${timeoutMs}ms.`))
      })

      request.on('error', reject)

      if (init?.signal) {
        if (init.signal.aborted) {
          request.destroy(new Error('This operation was aborted'))
          return
        }

        init.signal.addEventListener(
          'abort',
          () => {
            request.destroy(new Error('This operation was aborted'))
          },
          { once: true },
        )
      }

      if (body) {
        request.write(body)
      }

      request.end()
    })
}

function normalizeRequestBody(body: BodyInit | null | undefined) {
  if (body === undefined || body === null) {
    return null
  }

  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    return body
  }

  throw new Error('Headless fetcher only supports string or Buffer request bodies.')
}

function headersToObject(headers: HeadersInit | undefined) {
  if (!headers) {
    return undefined
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries())
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }

  return headers
}

function responseHeadersToHeaders(headers: import('node:http').IncomingHttpHeaders) {
  const responseHeaders = new Headers()

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        responseHeaders.append(key, entry)
      }
    } else if (value !== undefined) {
      responseHeaders.set(key, value)
    }
  }

  return responseHeaders
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
