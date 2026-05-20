import { describe, expect, it } from 'vitest'
import {
  canUseInAppProviderApiKeyInput,
  createEmptyProviderApiKeys,
  getProviderApiKey,
  isProviderApiKeyLoaded,
  loadStartupProviderApiKeyStatus,
  resolveStartupProviderApiKeyStatus,
  shouldUseLocalEnvApiKey,
} from './providerApiKey'

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

describe('canUseInAppProviderApiKeyInput', () => {
  it('hides the in-app API key input on localhost', () => {
    expect(canUseInAppProviderApiKeyInput('localhost')).toBe(false)
    expect(canUseInAppProviderApiKeyInput('127.0.0.1')).toBe(false)
    expect(canUseInAppProviderApiKeyInput('[::1]')).toBe(false)
  })

  it('shows the in-app API key input on deployed origins', () => {
    expect(canUseInAppProviderApiKeyInput('manifest3d.example')).toBe(true)
    expect(canUseInAppProviderApiKeyInput('192.168.1.20')).toBe(true)
  })
})

describe('loadStartupProviderApiKeyStatus', () => {
  it('loads and trims local dev server provider keys on localhost', async () => {
    await expect(
      loadStartupProviderApiKeyStatus({
        fetchLocalEnvApiKeys: async () => ({
          gemini: '  gemini-local-test  ',
          openai: '  sk-local-test  ',
        }),
        hostname: 'localhost',
      }),
    ).resolves.toEqual({
      apiKeys: {
        gemini: 'gemini-local-test',
        openai: 'sk-local-test',
      },
      source: 'local_env',
    })
  })

  it('does not fetch the local dev server keys on non-localhost origins', async () => {
    let didFetch = false

    await expect(
      loadStartupProviderApiKeyStatus({
        fetchLocalEnvApiKeys: async () => {
          didFetch = true

          return {
            gemini: 'gemini-should-not-load',
            openai: 'sk-should-not-load',
          }
        },
        hostname: 'manifest3d.example',
      }),
    ).resolves.toEqual({
      apiKeys: createEmptyProviderApiKeys(),
      source: 'none',
    })
    expect(didFetch).toBe(false)
  })
})

describe('resolveStartupProviderApiKeyStatus', () => {
  it('loads any provided local env key on localhost', () => {
    expect(
      resolveStartupProviderApiKeyStatus({
        envApiKeys: {
          gemini: '',
          openai: '  sk-local-test  ',
        },
        hostname: 'localhost',
      }),
    ).toEqual({
      apiKeys: {
        gemini: '',
        openai: 'sk-local-test',
      },
      source: 'local_env',
    })
  })

  it('does not expose provided local env keys on non-localhost origins', () => {
    expect(
      resolveStartupProviderApiKeyStatus({
        envApiKeys: {
          gemini: 'gemini-should-not-load',
          openai: 'sk-should-not-load',
        },
        hostname: 'manifest3d.example',
      }),
    ).toEqual({
      apiKeys: createEmptyProviderApiKeys(),
      source: 'none',
    })
  })

  it('treats blank env keys as missing', () => {
    expect(
      resolveStartupProviderApiKeyStatus({
        envApiKeys: {
          gemini: '   ',
          openai: '',
        },
        hostname: 'localhost',
      }),
    ).toEqual({
      apiKeys: createEmptyProviderApiKeys(),
      source: 'none',
    })
  })
})

describe('provider API key readiness', () => {
  it('is ready on localhost when at least one local env key loaded', () => {
    const startupStatus = {
      apiKeys: {
        gemini: '',
        openai: 'sk-local-test',
      },
      source: 'local_env' as const,
    }

    expect(
      isProviderApiKeyLoaded('gemini', startupStatus, createEmptyProviderApiKeys()),
    ).toBe(true)
  })

  it('uses the current provider session key outside localhost', () => {
    expect(
      isProviderApiKeyLoaded(
        'gemini',
        {
          apiKeys: createEmptyProviderApiKeys(),
          source: 'none',
        },
        {
          gemini: 'gemini-session',
          openai: '',
        },
      ),
    ).toBe(true)
    expect(
      isProviderApiKeyLoaded(
        'openai',
        {
          apiKeys: createEmptyProviderApiKeys(),
          source: 'none',
        },
        {
          gemini: 'gemini-session',
          openai: '',
        },
      ),
    ).toBe(false)
  })

  it('resolves the selected provider key from local env before session memory', () => {
    expect(
      getProviderApiKey(
        'gemini',
        {
          apiKeys: {
            gemini: 'gemini-local',
            openai: 'sk-local',
          },
          source: 'local_env',
        },
        {
          gemini: 'gemini-session',
          openai: '',
        },
      ),
    ).toBe('gemini-local')
  })
})
