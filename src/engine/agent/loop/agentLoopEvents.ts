import type { AgentLoopEvent, AgentLoopState, AgentLoopStatus } from '../agentLoop'

export function emit(
  publishEvent: (event: AgentLoopEvent) => void,
  runId: string,
  nextEventIndex: () => number,
  state: AgentLoopState,
  label: string,
  detail: string | null,
  status: AgentLoopStatus,
) {
  publishEvent({
    detail,
    id: `${runId}:${nextEventIndex()}:${state}`,
    label,
    state,
    status,
  })
}

export function beginAgentLoopStep(
  publishEvent: (event: AgentLoopEvent) => void,
  runId: string,
  nextEventIndex: () => number,
  state: AgentLoopState,
  label: string,
  detail: string | null,
) {
  const id = `${runId}:${nextEventIndex()}:${state}`

  publishEvent({
    detail,
    id,
    label,
    state,
    status: 'running',
  })

  return (status: Exclude<AgentLoopStatus, 'running'>, nextDetail = detail) => {
    publishEvent({
      detail: nextDetail,
      id,
      label,
      state,
      status,
    })
  }
}

export function upsertAgentLoopEvent(
  events: readonly AgentLoopEvent[],
  event: AgentLoopEvent,
) {
  const existingEventIndex = events.findIndex(
    (currentEvent) => currentEvent.id === event.id,
  )

  if (existingEventIndex < 0) {
    return [...events, event]
  }

  const nextEvents = [...events]

  nextEvents[existingEventIndex] = event

  return nextEvents
}

export function createRunId(now?: () => string) {
  const timestamp = now ? now() : new Date().toISOString()

  return `agent:${timestamp}`
}
