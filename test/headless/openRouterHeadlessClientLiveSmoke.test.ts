import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileManifestPrompt } from '../../src/engine/agent/promptCompiler'
import { safeParseManifestAsset } from '../../src/engine/schema/manifestSchema'
import type { ManifestScene } from '../../src/engine/schema/manifestTypes'
import {
  createOpenRouterHeadlessManifestClient,
  runOpenRouterHeadlessSmokeRequest,
} from './openRouterHeadlessClient'

const describeLiveOpenRouterSmoke = readBooleanEnv(
  'HEADLESS_OPENROUTER_CLIENT_SMOKE',
)
  ? describe
  : describe.skip
const describeLiveOpenRouterManifestSmoke = readBooleanEnv(
  'HEADLESS_OPENROUTER_MANIFEST_CLIENT_SMOKE',
)
  ? describe
  : describe.skip
const emptyScene: ManifestScene = {
  assets: [],
  schemaVersion: 1,
  units: 'meters',
}

describeLiveOpenRouterSmoke('openRouterHeadlessClient live smoke', () => {
  it(
    'completes small structured Responses API requests',
    async () => {
      const apiKey = readOpenRouterApiKey()
      const prompts = [
        {
          label: 'client-smoke-1',
          prompt: 'Return JSON with ok true and label client-smoke-1.',
        },
        {
          label: 'client-smoke-2',
          prompt: 'Return JSON with ok true and label client-smoke-2.',
        },
      ]

      for (const item of prompts) {
        const response = await runOpenRouterHeadlessSmokeRequest({
          apiKey,
          label: item.label,
          prompt: item.prompt,
        })

        expect(response.status).toBe('ok')

        if (response.status !== 'ok') {
          continue
        }

        expect(response.responseId).toEqual(expect.any(String))
        expect(response.candidate).toEqual({
          label: item.label,
          ok: true,
        })
      }
    },
    180_000,
  )
})

describeLiveOpenRouterManifestSmoke(
  'openRouterHeadlessClient manifest live smoke',
  () => {
    it(
      'gets one full Manifest3D structured-output response',
      async () => {
        const apiKey = readOpenRouterApiKey()
        const client = createOpenRouterHeadlessManifestClient({ apiKey })
        const prompt = compileManifestPrompt({
          mode: 'create',
          scene: emptyScene,
          userPrompt:
            'Create a simple static asset: a red cube seated on a small gray base. Keep it compact.',
        })
        const response = await client.generateAsset({ prompt })

        expect(response.status).toBe('ok')

        if (response.status !== 'ok') {
          throw new Error(
            `OpenRouter manifest smoke returned ${response.status}: ${response.message}`,
          )
        }

        const parsed = safeParseManifestAsset(response.candidate)

        expect(parsed.success).toBe(true)

        if (!parsed.success) {
          throw new Error(parsed.error.message)
        }

        console.info(
          [
            '[openrouter manifest smoke]',
            `responseId=${response.responseId ?? 'null'}`,
            `assetId=${parsed.data.id}`,
            `parts=${parsed.data.parts.length}`,
            `materials=${parsed.data.materials.length}`,
            `joints=${parsed.data.joints.length}`,
            `rawTextChars=${response.rawText.length}`,
          ].join(' '),
        )
      },
      240_000,
    )
  },
)

function readOpenRouterApiKey() {
  const apiKey =
    readStringEnv('OPENROUTER_API_KEY', '') ||
    readDotEnvValue('OPENROUTER_API_KEY')

  if (!apiKey) {
    throw new Error(
      'OpenRouter client live smoke requires OPENROUTER_API_KEY in the environment or .env.',
    )
  }

  return apiKey
}

function readBooleanEnv(key: string) {
  const value = readStringEnv(key, '').trim().toLowerCase()

  return value === '1' || value === 'true' || value === 'yes'
}

function readStringEnv(key: string, fallback: string) {
  return process.env[key]?.trim() || fallback
}

function readDotEnvValue(key: string) {
  const path = '.env'

  if (!existsSync(path)) {
    return ''
  }

  const raw = readFileSync(path, 'utf8')

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separator = trimmed.indexOf('=')

    if (separator < 0 || trimmed.slice(0, separator).trim() !== key) {
      continue
    }

    return trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^"|"$/g, '')
  }

  return ''
}
