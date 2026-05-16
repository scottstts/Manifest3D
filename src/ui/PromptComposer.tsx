import { Paperclip, Send } from 'lucide-react'

export function PromptComposer() {
  return (
    <form className="prompt-composer" aria-label="Prompt composer">
      <label className="sr-only" htmlFor="scene-prompt">
        Prompt
      </label>
      <textarea
        id="scene-prompt"
        placeholder="What to create?"
        rows={1}
      />
      <div className="prompt-composer__actions">
        <button aria-label="Attach reference file" type="button">
          <Paperclip aria-hidden="true" />
        </button>
        <button aria-label="Send prompt" className="send-button" type="button">
          <Send aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}
