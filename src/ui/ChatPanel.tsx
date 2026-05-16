import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { Ref } from 'react'
import type { AgentImageAttachment } from '../engine/agent/providerClient'
import type { AgentTimelineItem } from '../engine/agent/validationTimeline'
import type { ValidationReport } from '../engine/schema/validationTypes'
import { AgentTimeline } from './AgentTimeline'
import { PromptComposer } from './PromptComposer'

type ChatPanelProps = {
  agentStatus: string | null
  isCollapsed: boolean
  isRunning: boolean
  onCollapsedChange: (isCollapsed: boolean) => void
  onPromptSubmit: (
    userPrompt: string,
    imageAttachments: readonly AgentImageAttachment[],
  ) => void
  panelRef?: Ref<HTMLElement>
  timelineItems: readonly AgentTimelineItem[]
  validationReports: readonly ValidationReport[]
}

export function ChatPanel({
  agentStatus,
  isCollapsed,
  isRunning,
  onCollapsedChange,
  onPromptSubmit,
  panelRef,
  timelineItems,
  validationReports,
}: ChatPanelProps) {
  return (
    <aside
      className={`chat-panel${isCollapsed ? ' is-collapsed' : ''}`}
      aria-label="Agent conversation"
      ref={panelRef}
    >
      <button
        aria-expanded={!isCollapsed}
        aria-label={isCollapsed ? 'Expand side panel' : 'Collapse side panel'}
        className="chat-panel__toggle"
        type="button"
        onClick={() => onCollapsedChange(!isCollapsed)}
      >
        {isCollapsed ? (
          <PanelRightOpen aria-hidden="true" />
        ) : (
          <PanelRightClose aria-hidden="true" />
        )}
      </button>
      <div className="chat-thread" aria-label="Conversation">
        {!isCollapsed && agentStatus && (
          <p className="agent-status" role="status">
            {agentStatus}
          </p>
        )}
        {!isCollapsed && (
          <AgentTimeline
            items={timelineItems.length > 0 ? timelineItems : undefined}
            reports={validationReports}
          />
        )}
      </div>
      {!isCollapsed && (
        <PromptComposer
          disabled={isRunning}
          onSubmit={onPromptSubmit}
        />
      )}
    </aside>
  )
}
