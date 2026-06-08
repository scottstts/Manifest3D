import { describe, expect, it } from 'vitest'
import { getProviderLabel, parseModelProvider } from './providerPreference'

describe('parseModelProvider', () => {
  it('keeps known providers', () => {
    expect(parseModelProvider('openai')).toBe('openai')
    expect(parseModelProvider('gemini')).toBe('gemini')
  })

  it('falls back to OpenAI for missing or unknown providers', () => {
    expect(parseModelProvider(null)).toBe('openai')
    expect(parseModelProvider('anthropic')).toBe('openai')
  })
})

describe('getProviderLabel', () => {
  it('formats provider labels for UI copy', () => {
    expect(getProviderLabel('openai')).toBe('OpenAI')
    expect(getProviderLabel('gemini')).toBe('Gemini')
  })
})
