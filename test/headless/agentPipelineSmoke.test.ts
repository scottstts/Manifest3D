import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, relative, resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  defaultRepairTurnCap,
  runManifestAgentLoop,
  type AgentLoopEvent,
} from '../../src/engine/agent/agentLoop'
import { createManifestProviderClient } from '../../src/engine/agent/manifestProviderClient'
import { parseModelProvider } from '../../src/engine/agent/providerPreference'
import type {
  AgentImageAttachment,
  AgentRequest,
  AgentResponse,
  ManifestProviderClient,
} from '../../src/engine/agent/providerClient'
import type { ModelProvider } from '../../src/engine/config/modelConfig'
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
import { safeParseManifestAsset } from '../../src/engine/schema/manifestSchema'

type HeadlessAgentResult = Awaited<ReturnType<typeof runManifestAgentLoop>>
type HeadlessAttempt = HeadlessAgentResult['history']['attempts'][number]

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
  provider: ModelProvider
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
      const prompt = readStringEnv('HEADLESS_AGENT_PROMPT', defaultPrompt)
      const runId = `headless:${safeTimestamp()}`
      const artifactRoot = createArtifactRoot(runId)
      const runTimeoutMs = readNumberEnv(
        'HEADLESS_AGENT_RUN_TIMEOUT_MS',
        defaultRunTimeoutMs,
      )
      const abortController = new AbortController()
      const runTimeout = setTimeout(() => {
        abortController.abort()
      }, runTimeoutMs)
      const provider = readHeadlessModelProvider()
      const apiKey = readRequiredProviderApiKey(provider)
      const events: AgentLoopEvent[] = []
      const { artifacts: imageArtifacts, attachments: imageAttachments } =
        readHeadlessImageAttachments(artifactRoot)
      const sceneStore = createSceneStore(emptyScene)
      const assetLibraryStore = createAssetLibraryStore(
        createMemoryAssetLibraryRepository(),
      )
      const { client, exchanges } = createCapturedClient({
        apiKey,
        artifactRoot,
        provider,
      })
      const runStartedAt = new Date()

      await assetLibraryStore.load()

      let result: Awaited<ReturnType<typeof runManifestAgentLoop>>

      try {
        result = await runManifestAgentLoop(
          {
            maxRepairTurns: readNumberEnv(
              'HEADLESS_AGENT_MAX_REPAIR_TURNS',
              defaultRepairTurnCap,
            ),
            imageAttachments,
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
          runTimeoutMs,
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
      )

      if (result.status === 'ready') {
        const savedVersion = await assetLibraryStore.saveValidatedVersion({
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
        prompt,
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
      })

      logHeadlessSummary(artifactRoot, result)

      if (readBooleanEnv('HEADLESS_AGENT_EXPECT_READY', true)) {
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
  provider,
}: {
  apiKey: string
  artifactRoot: string
  provider: ModelProvider
}) {
  const realClient = createManifestProviderClient({
    apiKey,
    provider,
  })
  const exchanges: CapturedExchange[] = []
  const client: ManifestProviderClient = {
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
        provider,
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
  attemptGlbArtifacts,
  events,
  exchanges,
  prompt,
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
}: {
  artifactRoot: string
  attemptGlbArtifacts: readonly HeadlessAttemptGlbArtifacts[]
  events: readonly AgentLoopEvent[]
  exchanges: readonly CapturedExchange[]
  prompt: string
  provider: ModelProvider
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
    provider,
    runCompletedAt: runCompletedAt.toISOString(),
    runDurationMs: runCompletedAt.getTime() - runStartedAt.getTime(),
    resultStatus: result.status,
    runId,
    runStartedAt: runStartedAt.toISOString(),
    runTimeoutMs,
    glbExports,
    glbViewerUrls: glbExports
      .map((glbExport) => glbExport.viewerUrl)
      .filter((viewerUrl): viewerUrl is string => viewerUrl !== null),
    imageArtifacts,
    imageAttachmentCount: imageArtifacts.length,
    savedVersionId,
    sceneAssetIds: scene.assets.map((asset) => asset.id),
    attempts: result.history.attempts.map((attempt) => ({
      glbArtifacts:
        attemptGlbArtifacts.find((entry) => entry.attemptId === attempt.id) ??
        null,
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
): Promise<HeadlessAttemptGlbArtifacts[]> {
  const artifacts: HeadlessAttemptGlbArtifacts[] = []

  for (const [index, attempt] of attempts.entries()) {
    const attemptIndex = index + 1
    const attemptDir = `attempts/${String(attemptIndex).padStart(2, '0')}`
    const parsed = safeParseManifestAsset(attempt.candidate)

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
    }
  }

  return artifacts
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

function readHeadlessModelProvider(): ModelProvider {
  return parseModelProvider(readStringEnv('HEADLESS_AGENT_PROVIDER', 'openai'))
}

function readRequiredProviderApiKey(provider: ModelProvider) {
  const apiKey =
    provider === 'gemini'
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
