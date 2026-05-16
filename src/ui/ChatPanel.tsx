import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { Ref } from 'react'
import { PromptComposer } from './PromptComposer'

type ChatPanelProps = {
  isCollapsed: boolean
  onCollapsedChange: (isCollapsed: boolean) => void
  panelRef?: Ref<HTMLElement>
}

export function ChatPanel({
  isCollapsed,
  onCollapsedChange,
  panelRef,
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
      <div className="chat-thread" aria-label="Conversation" />
      {!isCollapsed && <PromptComposer />}
    </aside>
  )
}
