export const modelConfig = {
  model: 'gpt-5.5',
  reasoningEffort: 'high',
  temperature: 1.0,
  maxOutputTokens: 64_000,
  agentRunTimeoutMs: 3_600_000,
} as const

export const geminiModelConfig = {
  model: 'gemini-flash-latest',
  thinkingLevel: 'high',
  temperature: 1.0,
  maxOutputTokens: 64_000,
  agentRunTimeoutMs: 3_600_000,
} as const

export const modelProviderOptions = ['openai', 'gemini'] as const

export type ModelProvider = (typeof modelProviderOptions)[number]
export type ModelConfig = typeof modelConfig
export type GeminiModelConfig = typeof geminiModelConfig
