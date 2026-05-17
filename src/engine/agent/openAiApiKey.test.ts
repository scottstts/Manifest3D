import { describe, expect, it } from 'vitest'
import {
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

describe('resolveStartupOpenAIApiKeyStatus', () => {
  it('loads and trims the Vite env key on localhost', () => {
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

  it('does not expose the Vite env key on non-localhost origins', () => {
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
