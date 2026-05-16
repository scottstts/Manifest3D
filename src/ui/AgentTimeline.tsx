import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  XCircle,
} from 'lucide-react'
import { createValidationTimeline } from '../engine/agent/validationTimeline'
import type { ValidationReport } from '../engine/schema/validationTypes'

type AgentTimelineProps = {
  reports: readonly ValidationReport[]
}

export function AgentTimeline({ reports }: AgentTimelineProps) {
  const timelineItems = reports.flatMap(createValidationTimeline)

  if (timelineItems.length === 0) {
    return null
  }

  return (
    <ol className="agent-timeline" aria-label="Agent timeline">
      {timelineItems.map((item) => (
        <li className={`agent-timeline__item is-${item.status}`} key={item.id}>
          <span className="agent-timeline__icon" aria-hidden="true">
            {item.status === 'passed' && <CheckCircle2 />}
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
      ))}
    </ol>
  )
}
