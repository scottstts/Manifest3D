import { describe, expect, it } from 'vitest'
import {
  loadStartupOpenAIApiKeyStatus,
  resolveStartupOpenAIApiKeyStatus,
  shouldUseLocalEnvApiKey,
} from './openAiApiKey'

describe('shouldUseLocalEnvApiKey', () => {
  it('allows local development hostnames', () => {
    expect(shouldUseLocalEnvApiKey('localhost')).toBe(true)
    expect(shouldUseLocalEnvApiKey('127.0.0.1')).toBe(true)
    expect(shouldUseLocalEnvApiKey('::1')).toBe(true)
    expect(shouldUseLocalEnvApiKey('[::1]')).toBe(true)
  })

  it('rejects deployed and LAN hostnames', () => {
    expect(shouldUseLocalEnvApiKey('manifest3d.example')).toBe(false)
    expect(shouldUseLocalEnvApiKey('192.168.1.20')).toBe(false)
  })
})

describe('loadStartupOpenAIApiKeyStatus', () => {
  it('loads and trims the local dev server key on localhost', async () => {
    await expect(
      loadStartupOpenAIApiKeyStatus({
        fetchLocalEnvApiKey: async () => '  sk-local-test  ',
        hostname: 'localhost',
      }),
    ).resolves.toEqual({
      apiKey: 'sk-local-test',
      source: 'local_env',
    })
  })

  it('does not fetch the local dev server key on non-localhost origins', async () => {
    let didFetch = false

    await expect(
      loadStartupOpenAIApiKeyStatus({
        fetchLocalEnvApiKey: async () => {
          didFetch = true

          return 'sk-should-not-load'
        },
        hostname: 'manifest3d.example',
      }),
    ).resolves.toEqual({
      apiKey: '',
      source: 'none',
    })
    expect(didFetch).toBe(false)
  })
})

describe('resolveStartupOpenAIApiKeyStatus', () => {
  it('loads and trims a provided local env key on localhost', () => {
    expect(
      resolveStartupOpenAIApiKeyStatus({
        envApiKey: '  sk-local-test  ',
        hostname: 'localhost',
      }),
    ).toEqual({
      apiKey: 'sk-local-test',
      source: 'local_env',
    })
  })

  it('does not expose a provided local env key on non-localhost origins', () => {
    expect(
      resolveStartupOpenAIApiKeyStatus({
        envApiKey: 'sk-should-not-load',
        hostname: 'manifest3d.example',
      }),
    ).toEqual({
      apiKey: '',
      source: 'none',
    })
  })

  it('treats blank env keys as missing', () => {
    expect(
      resolveStartupOpenAIApiKeyStatus({
        envApiKey: '   ',
        hostname: 'localhost',
      }),
    ).toEqual({
      apiKey: '',
      source: 'none',
    })
  })
})
