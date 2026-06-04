import { describe, expect, it } from 'vitest'
import type { AgentLoopEvent } from '../../src/engine/agent/agentLoop'
import { createHeadlessPatchApplicationStopper } from './headlessPatchApplicationStopper'

describe('createHeadlessPatchApplicationStopper', () => {
  it('arms after consecutive patch application errors', () => {
    const stopper = createHeadlessPatchApplicationStopper(2)

    expect(stopper.recordAgentEvent(patchErrorEvent('bad geometry'))).toBeNull()

    const state = stopper.recordAgentEvent(
      patchErrorEvent('Patch operation 7 failed: Path "/checks/43" does not exist.'),
    )

    expect(state).toMatchObject({
      streak: 2,
      threshold: 2,
    })
    expect(stopper.getStopReason()).toContain('patch application failed 2')
  })

  it('resets after a successful parse', () => {
    const stopper = createHeadlessPatchApplicationStopper(2)

    stopper.recordAgentEvent(patchErrorEvent('bad geometry'))
    stopper.recordAgentEvent({
      ...patchErrorEvent(''),
      detail: null,
      status: 'passed',
    })

    expect(stopper.recordAgentEvent(patchErrorEvent('bad limits'))).toBeNull()
    expect(stopper.getStopReason()).toBeNull()
  })

  it('can be disabled with a zero threshold', () => {
    const stopper = createHeadlessPatchApplicationStopper(0)

    stopper.recordAgentEvent(patchErrorEvent('bad geometry'))
    stopper.recordAgentEvent(patchErrorEvent('bad limits'))

    expect(stopper.getStopReason()).toBeNull()
  })
})

function patchErrorEvent(detail: string): AgentLoopEvent {
  return {
    detail: detail.startsWith('Patch operation ')
      ? detail
      : `Patched candidate does not satisfy the Manifest3D asset schema.\n${detail}`,
    id: 'event',
    label: 'Parse candidate JSON',
    state: 'parsing_candidate',
    status: 'failed',
    timestamp: new Date(0).toISOString(),
  }
}
