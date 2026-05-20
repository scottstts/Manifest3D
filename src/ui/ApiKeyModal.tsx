import type { FormEvent, MouseEvent } from 'react'
import { useCallback, useEffect, useId, useState } from 'react'
import {
  modelProviderOptions,
  type ModelProvider,
} from '../engine/config/modelConfig'
import { getProviderLabel } from '../engine/agent/providerPreference'

type ApiKeyModalProps = {
  isOpen: boolean
  provider: ModelProvider
  showApiKeyInput: boolean
  onCancel: () => void
  onProviderChange: (provider: ModelProvider) => void
  onSubmit: (provider: ModelProvider, apiKey: string) => void
}

export function ApiKeyModal({
  isOpen,
  provider,
  showApiKeyInput,
  onCancel,
  onProviderChange,
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

    if (showApiKeyInput && trimmedApiKey) {
      onSubmit(provider, trimmedApiKey)
      setApiKey('')
    }
  }

  function handleProviderSelectChange(provider: ModelProvider) {
    setApiKey('')
    onProviderChange(provider)
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
        <h2 id={titleId}>Providers</h2>
        <label className="api-key-modal__field api-key-modal__provider-field">
          <span>Provider</span>
          <select
            autoFocus={!showApiKeyInput}
            value={provider}
            onChange={(event) =>
              handleProviderSelectChange(
                event.currentTarget.value as ModelProvider,
              )
            }
          >
            {modelProviderOptions.map((option) => (
              <option key={option} value={option}>
                {getProviderLabel(option)}
              </option>
            ))}
          </select>
        </label>
        {showApiKeyInput && (
          <>
            <label className="api-key-modal__field">
              <span className="sr-only">{getProviderLabel(provider)} API key</span>
              <input
                autoComplete="off"
                autoFocus
                placeholder="Paste API Key"
                spellCheck={false}
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
            <p className="api-key-modal__notice">
              This app is frontend-only, no backend, your API key is not stored.
              The app calls the selected provider API directly, and is not sent
              to any other parties. The key only stays in this browser
              tab&apos;s memory and is wiped when you refresh or reopen the
              site. If you prefer not to provide a key here, run the app from
              source locally:{' '}
              <a
                href="https://github.com/scottstts/Manifest3D"
                rel="noreferrer"
                target="_blank"
              >
                scottstts/Manifest3D
              </a>
              .
            </p>
          </>
        )}
        <div className="api-key-modal__actions">
          <button type="button" onClick={handleCancel}>
            {showApiKeyInput ? 'Cancel' : 'Close'}
          </button>
          {showApiKeyInput && (
            <button
              className="api-key-modal__primary"
              disabled={!trimmedApiKey}
              type="submit"
            >
              Use Key
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
