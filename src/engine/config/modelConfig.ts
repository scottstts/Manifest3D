export const openAIReasoningEffortOptions = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
] as const
export const geminiThinkingLevelOptions = [
  'minimal',
  'low',
  'medium',
  'high',
] as const
export const openRouterDefaultReasoningEffort = 'high'

export type OpenAIReasoningEffort =
  (typeof openAIReasoningEffortOptions)[number]
export type GeminiThinkingLevel = (typeof geminiThinkingLevelOptions)[number]
export type ReasoningEffort = string

export type ModelConfig = {
  agentRunTimeoutMs: number
  maxOutputTokens: number
  model: string
  reasoningEffort: string
  temperature: number
}

export type GeminiModelConfig = {
  agentRunTimeoutMs: number
  maxOutputTokens: number
  model: string
  temperature: number
  thinkingLevel: GeminiThinkingLevel
}

export const modelConfig: ModelConfig = {
  model: 'gpt-5.5',
  reasoningEffort: 'high',
  temperature: 1.0,
  maxOutputTokens: 64_000,
  agentRunTimeoutMs: 3_600_000,
}

export const geminiModelConfig: GeminiModelConfig = {
  model: 'gemini-flash-latest',
  thinkingLevel: 'high',
  temperature: 1.0,
  maxOutputTokens: 64_000,
  agentRunTimeoutMs: 3_600_000,
}

export const openRouterModelConfig: ModelConfig = {
  ...modelConfig,
  model: 'openai/gpt-5.5',
  reasoningEffort: openRouterDefaultReasoningEffort,
}

export const modelProviderOptions = ['openai', 'gemini', 'openrouter'] as const

export type ModelProvider = (typeof modelProviderOptions)[number]

export function getProviderReasoningEffortOptions(
  provider: ModelProvider,
): readonly string[] {
  return provider === 'openrouter'
    ? []
    : provider === 'gemini'
    ? geminiThinkingLevelOptions
    : openAIReasoningEffortOptions
}

export function isProviderReasoningEffortFreeform(provider: ModelProvider) {
  return provider === 'openrouter'
}
