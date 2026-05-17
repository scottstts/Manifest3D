export const modelConfig = {
  provider: 'openai',
  model: 'gpt-5.5',
  reasoningEffort: 'high',
  temperature: 1.0,
  maxOutputTokens: 64_000,
} as const

export type ModelConfig = typeof modelConfig
