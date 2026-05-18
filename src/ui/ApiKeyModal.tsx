import type { FormEvent, MouseEvent } from 'react'
import { useCallback, useEffect, useId, useState } from 'react'

type ApiKeyModalProps = {
  isOpen: boolean
  onCancel: () => void
  onSubmit: (apiKey: string) => void
}

export function ApiKeyModal({
  isOpen,
  onCancel,
  onSubmit,
}: ApiKeyModalProps) {
  const [apiKey, setApiKey] = useState('')
  const titleId = useId()
  const trimmedApiKey = apiKey.trim()
  const handleCancel = useCallback(() => {
    setApiKey('')
    onCancel()
  }, [onCancel])

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        handleCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleCancel, isOpen])

  if (!isOpen) {
    return null
  }

  function handleOverlayMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      handleCancel()
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (trimmedApiKey) {
      onSubmit(trimmedApiKey)
      setApiKey('')
    }
  }

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="api-key-modal"
      role="dialog"
      onMouseDown={handleOverlayMouseDown}
    >
      <form className="api-key-modal__surface" onSubmit={handleSubmit}>
        <h2 id={titleId}>OpenAI API Key</h2>
        <label className="api-key-modal__field">
          <span className="sr-only">OpenAI API key</span>
          <input
            autoComplete="off"
            autoFocus
            placeholder="Paste OpenAI API key"
            spellCheck={false}
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <p className="api-key-modal__notice">
          This app is frontend-only, no backend, your API key is not stored.
          The app calls OpenAI API directly, and is not sent to any other parties. 
          The key only stays in this browser tab&apos;s memory and is wiped when
          you refresh or reopen the site. If you prefer not to provide a key
          here, run the app from source locally:{' '}
          <a
            href="https://github.com/scottstts/Manifest3D"
            rel="noreferrer"
            target="_blank"
          >
            scottstts/Manifest3D
          </a>
          .
        </p>
        <div className="api-key-modal__actions">
          <button type="button" onClick={handleCancel}>
            Cancel
          </button>
          <button
            className="api-key-modal__primary"
            disabled={!trimmedApiKey}
            type="submit"
          >
            Use Key
          </button>
        </div>
      </form>
    </div>
  )
}
