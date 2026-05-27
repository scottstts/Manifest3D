import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  LoaderCircle,
  XCircle,
} from 'lucide-react'
import {
  createValidationTimeline,
  type AgentTimelineItem,
} from '../engine/agent/validationTimeline'
import type { ValidationReport } from '../engine/schema/validationTypes'

type AgentTimelineProps = {
  items?: readonly AgentTimelineItem[]
  reports?: readonly ValidationReport[]
}

export function AgentTimeline({ items, reports = [] }: AgentTimelineProps) {
  const timelineItems = items ?? reports.flatMap(createValidationTimeline)

  if (timelineItems.length === 0) {
    return null
  }

  return (
    <ol className="agent-timeline" aria-label="Agent timeline">
      {timelineItems.map((item) => (
        <AgentTimelineRow item={item} key={item.id} />
      ))}
    </ol>
  )
}

function AgentTimelineRow({ item }: { item: AgentTimelineItem }) {
  if (item.kind === 'attempt_header') {
    return (
      <li className="agent-timeline__attempt-header">
        <span>{item.label}</span>
      </li>
    )
  }

  if (item.kind === 'attempt_footer') {
    return <li className="agent-timeline__attempt-footer" aria-hidden="true" />
  }

  return (
    <li className={`agent-timeline__item is-${item.status}`}>
      <span className="agent-timeline__icon" aria-hidden="true">
        {item.status === 'passed' && <CheckCircle2 />}
        {item.status === 'running' && <LoaderCircle />}
        {item.status === 'warning' && <AlertTriangle />}
        {item.status === 'failed' && <XCircle />}
        {item.status === 'skipped' && <CircleDashed />}
      </span>
      <span className="agent-timeline__copy">
        <span className="agent-timeline__label">{item.label}</span>
        {item.detail && (
          <span className="agent-timeline__detail">{item.detail}</span>
        )}
      </span>
    </li>
  )
}
