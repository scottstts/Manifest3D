import { PanelRightClose, PanelRightOpen, Plus } from 'lucide-react'
import {
  type Ref,
  type UIEvent,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
import type { AgentImageAttachment } from '../engine/agent/providerClient'
import type { AgentTimelineItem } from '../engine/agent/validationTimeline'
import type { ValidationReport } from '../engine/schema/validationTypes'
import { AgentTimeline } from './AgentTimeline'
import { PromptComposer } from './PromptComposer'

export type ChatPanelPromptMode = 'create' | 'edit'

export type ChatPanelTranscriptItem =
  | {
      id: string
      imageAttachments: readonly AgentImageAttachment[]
      role: 'user'
      text: string
    }
  | {
      id: string
      role: 'agent'
      status: string | null
      timelineItems: readonly AgentTimelineItem[]
    }

type ChatPanelProps = {
  agentStatus: string | null
  isCollapsed: boolean
  isRunning: boolean
  isWorkspaceDisabled?: boolean
  mode: ChatPanelPromptMode
  onNewAsset: () => void
  onCollapsedChange: (isCollapsed: boolean) => void
  onPromptSubmit: (
    userPrompt: string,
    imageAttachments: readonly AgentImageAttachment[],
  ) => void
  panelRef?: Ref<HTMLElement>
  timelineItems: readonly AgentTimelineItem[]
  transcriptItems: readonly ChatPanelTranscriptItem[]
  validationReports: readonly ValidationReport[]
}

export function ChatPanel({
  agentStatus,
  isCollapsed,
  isRunning,
  isWorkspaceDisabled = false,
  mode,
  onNewAsset,
  onCollapsedChange,
  onPromptSubmit,
  panelRef,
  timelineItems,
  transcriptItems,
  validationReports,
}: ChatPanelProps) {
  const threadRef = useRef<HTMLDivElement | null>(null)
  const isThreadPinnedToBottomRef = useRef(true)
  const timelineScrollKey = useMemo(
    () =>
      [
        agentStatus ?? '',
        timelineItems
          .map((item) => `${item.id}:${item.status}:${item.label}`)
          .join('|'),
        transcriptItems
          .map((item) =>
            item.role === 'user'
              ? `${item.id}:user:${item.text}:${item.imageAttachments.length}`
              : `${item.id}:agent:${item.status ?? ''}:${item.timelineItems
                  .map(
                    (timelineItem) =>
                      `${timelineItem.id}:${timelineItem.status}:${timelineItem.label}`,
                  )
                  .join(',')}`,
          )
          .join('|'),
        validationReports
          .map((report) => `${report.id}:${report.bundle.summary}`)
          .join('|'),
      ].join('::'),
    [agentStatus, timelineItems, transcriptItems, validationReports],
  )

  useLayoutEffect(() => {
    if (isCollapsed) {
      return
    }

    const thread = threadRef.current

    if (!thread) {
      return
    }

    const hasScroller = thread.scrollHeight > thread.clientHeight + 1

    if (isThreadPinnedToBottomRef.current || !hasScroller) {
      thread.scrollTop = thread.scrollHeight
      updateThreadPinState(thread, isThreadPinnedToBottomRef)
    }
  }, [isCollapsed, timelineScrollKey])

  function handleThreadScroll(event: UIEvent<HTMLDivElement>) {
    updateThreadPinState(event.currentTarget, isThreadPinnedToBottomRef)
  }

  return (
    <aside
      className={`chat-panel${isCollapsed ? ' is-collapsed' : ''}${isWorkspaceDisabled ? ' is-disabled' : ''}`}
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
      {!isCollapsed && !isWorkspaceDisabled && (
        <div className="chat-panel__mode-bar">
          <span className={`chat-panel__mode-pill is-${mode}`}>{mode}</span>
          <button
            aria-label="Start new asset"
            className="chat-panel__new-asset"
            disabled={isRunning}
            title="Start new asset"
            type="button"
            onClick={onNewAsset}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
      )}
      <div
        className="chat-thread"
        aria-label="Conversation"
        ref={threadRef}
        onScroll={handleThreadScroll}
      >
        {!isCollapsed && (
          <>
            {transcriptItems.length > 0 && !isWorkspaceDisabled ? (
              <ChatTranscript items={transcriptItems} />
            ) : (
              <>
                {(agentStatus || isWorkspaceDisabled) && (
                  <p className="agent-status" role="status">
                    {isWorkspaceDisabled
                      ? 'Compose uses saved assets only. Switch to Create to prompt or edit.'
                      : agentStatus}
                  </p>
                )}
                <AgentTimeline
                  items={timelineItems.length > 0 ? timelineItems : undefined}
                  reports={validationReports}
                />
              </>
            )}
          </>
        )}
      </div>
      {!isCollapsed && (
        <PromptComposer
          disabled={isRunning || isWorkspaceDisabled}
          disabledReason={isWorkspaceDisabled ? 'Compose mode' : null}
          isSubmitting={isRunning}
          onSubmit={onPromptSubmit}
        />
      )}
    </aside>
  )
}

function ChatTranscript({
  items,
}: {
  items: readonly ChatPanelTranscriptItem[]
}) {
  return (
    <div className="chat-transcript">
      {items.map((item) =>
        item.role === 'user' ? (
          <article className="chat-message is-user" key={item.id}>
            {item.imageAttachments.length > 0 && (
              <div className="chat-message__thumbs" aria-label="Prompt images">
                {item.imageAttachments.map((attachment) => (
                  <img
                    alt={attachment.name ?? 'Prompt reference'}
                    key={attachment.id}
                    src={attachment.imageUrl}
                  />
                ))}
              </div>
            )}
            <p>{item.text}</p>
          </article>
        ) : (
          <article className="chat-message is-agent" key={item.id}>
            {item.status && (
              <p className="chat-message__status" role="status">
                {item.status}
              </p>
            )}
            <AgentTimeline
              items={
                item.timelineItems.length > 0 ? item.timelineItems : undefined
              }
            />
          </article>
        ),
      )}
    </div>
  )
}

function updateThreadPinState(
  thread: HTMLDivElement,
  pinnedRef: { current: boolean },
) {
  const hasScroller = thread.scrollHeight > thread.clientHeight + 1

  pinnedRef.current =
    !hasScroller ||
    thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 12
}
