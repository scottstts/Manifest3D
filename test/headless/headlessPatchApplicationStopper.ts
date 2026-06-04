import type { AgentLoopEvent } from '../../src/engine/agent/agentLoop'

export type HeadlessPatchApplicationStopState = {
  reason: string
  streak: number
  threshold: number
}

export function createHeadlessPatchApplicationStopper(threshold: number) {
  let stopState: HeadlessPatchApplicationStopState | null = null
  let streak = 0

  return {
    getStopReason() {
      return stopState?.reason ?? null
    },
    recordAgentEvent(
      event: AgentLoopEvent,
    ): HeadlessPatchApplicationStopState | null {
      if (threshold <= 0) {
        return null
      }

      if (isPatchApplicationErrorEvent(event)) {
        streak += 1
      } else if (
        event.state === 'parsing_candidate' &&
        event.label === 'Parse candidate JSON' &&
        event.status === 'passed'
      ) {
        streak = 0
      } else {
        return null
      }

      if (stopState || streak < threshold) {
        return null
      }

      stopState = {
        reason: [
          `Headless patch-application stop: repair patch application failed ${streak} consecutive times.`,
          'Use a seeded repair replay after improving patch feedback instead of spending another live repair request.',
          'Set HEADLESS_AGENT_PATCH_ERROR_STOP_STREAK=0 to disable this headless-only stop.',
        ].join(' '),
        streak,
        threshold,
      }

      return stopState
    },
  }
}

function isPatchApplicationErrorEvent(event: AgentLoopEvent) {
  if (
    event.state !== 'parsing_candidate' ||
    event.label !== 'Parse candidate JSON' ||
    event.status !== 'failed' ||
    !event.detail
  ) {
    return false
  }

  return (
    event.detail.startsWith('Patched candidate does not satisfy') ||
    event.detail.startsWith('Patch operation ') ||
    event.detail.startsWith('No current candidate JSON exists')
  )
}
