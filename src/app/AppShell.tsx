import { useState } from 'react'
import { ChatPanel } from '../ui/ChatPanel'
import { FrameChrome } from '../ui/FrameChrome'
import { WebGPUCanvas } from '../renderer/WebGPUCanvas'

export function AppShell() {
  const [isSidePanelCollapsed, setIsSidePanelCollapsed] = useState(false)

  return (
    <div className="app-shell">
      <WebGPUCanvas isSidePanelCollapsed={isSidePanelCollapsed} />
      <FrameChrome />
      <main className="app-overlays" aria-label="Manifest3D creation workspace">
        <ChatPanel
          isCollapsed={isSidePanelCollapsed}
          onCollapsedChange={setIsSidePanelCollapsed}
        />
      </main>
    </div>
  )
}
