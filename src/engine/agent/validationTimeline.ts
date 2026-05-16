import type {
  ValidationReport,
  ValidationSignal,
  ValidationStepStatus,
} from '../schema/validationTypes'

export type AgentTimelineItemKind =
  | 'agent_step'
  | 'validation_warning'
  | 'validation_failure'
  | 'validation_success'

export type AgentTimelineItem = {
  detail: string | null
  id: string
  kind: AgentTimelineItemKind
  label: string
  status: ValidationStepStatus
}

export function createValidationTimeline(
  report: ValidationReport,
): AgentTimelineItem[] {
  return report.steps.map((step) => {
    const primarySignal = findPrimarySignal(report.bundle.signals, step.signalIds)

    return {
      detail: primarySignal ? formatSignalDetail(primarySignal) : null,
      id: `${report.id}:${step.id}`,
      kind: getTimelineKind(step.status),
      label: step.label,
      status: step.status,
    }
  })
}

function findPrimarySignal(
  signals: readonly ValidationSignal[],
  signalIds: readonly string[],
) {
  const signalIdSet = new Set(signalIds)

  return signals.find(
    (signal) =>
      signalIdSet.has(signal.id) && signal.severity === 'failure',
  ) ?? signals.find((signal) => signalIdSet.has(signal.id))
}

function formatSignalDetail(signal: ValidationSignal) {
  const location = signal.path ? ` (${signal.path})` : ''

  return signal.details
    ? `${signal.summary}${location}: ${signal.details}`
    : `${signal.summary}${location}`
}

function getTimelineKind(
  status: ValidationStepStatus,
): AgentTimelineItemKind {
  switch (status) {
    case 'failed':
      return 'validation_failure'
    case 'warning':
      return 'validation_warning'
    case 'passed':
      return 'validation_success'
    case 'skipped':
      return 'agent_step'
    default:
      return assertNever(status)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported validation timeline status: ${value}`)
}
