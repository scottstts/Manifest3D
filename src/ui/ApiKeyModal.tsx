import type { FormEvent, MouseEvent } from 'react'
import { useCallback, useEffect, useId, useState } from 'react'
import {
  getProviderReasoningEffortOptions,
  isProviderReasoningEffortFreeform,
  modelProviderOptions,
  type ModelProvider,
} from '../engine/config/modelConfig'
import { getProviderLabel } from '../engine/agent/providerPreference'
import type { ProviderModelSettings } from '../engine/agent/providerModelSettings'

type ApiKeyModalProps = {
  isOpen: boolean
  modelSettings: ProviderModelSettings
  provider: ModelProvider
  showApiKeyInput: boolean
  onCancel: () => void
  onModelIdChange: (provider: ModelProvider, modelId: string) => void
  onProviderChange: (provider: ModelProvider) => void
  onReasoningEffortChange: (
    provider: ModelProvider,
    reasoningEffort: string,
  ) => void
  onResetModelId: (provider: ModelProvider) => void
  onResetReasoningEffort: (provider: ModelProvider) => void
  onSubmit: (provider: ModelProvider, apiKey: string) => void
}

export function ApiKeyModal({
  isOpen,
  modelSettings,
  provider,
  showApiKeyInput,
  onCancel,
  onModelIdChange,
  onProviderChange,
  onReasoningEffortChange,
  onResetModelId,
  onResetReasoningEffort,
  onSubmit,
}: ApiKeyModalProps) {
  const [apiKey, setApiKey] = useState('')
  const titleId = useId()
  const trimmedApiKey = apiKey.trim()
  const reasoningEffortOptions = getProviderReasoningEffortOptions(provider)
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

  function handleReasoningEffortSelectChange(reasoningEffort: string) {
    onReasoningEffortChange(provider, reasoningEffort)
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
                {getProviderLabel(option).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <div className="api-key-modal__settings">
          <div className="api-key-modal__setting-row">
            <input
              aria-label="Model ID"
              autoComplete="off"
              spellCheck={false}
              type="text"
              value={modelSettings.modelId}
              onChange={(event) =>
                onModelIdChange(provider, event.currentTarget.value)
              }
            />
            <button
              className="api-key-modal__default-button"
              type="button"
              onClick={() => onResetModelId(provider)}
            >
              Use Default
            </button>
          </div>
          <div className="api-key-modal__setting-row">
            {isProviderReasoningEffortFreeform(provider) ? (
              <input
                aria-label="Reasoning Effort"
                autoComplete="off"
                spellCheck={false}
                type="text"
                value={modelSettings.reasoningEffort}
                onChange={(event) =>
                  handleReasoningEffortSelectChange(event.currentTarget.value)
                }
              />
            ) : (
              <select
                aria-label="Reasoning Effort"
                value={modelSettings.reasoningEffort}
                onChange={(event) =>
                  handleReasoningEffortSelectChange(event.currentTarget.value)
                }
              >
                {reasoningEffortOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
            <button
              className="api-key-modal__default-button"
              type="button"
              onClick={() => onResetReasoningEffort(provider)}
            >
              Use Default
            </button>
          </div>
        </div>
        {showApiKeyInput && (
          <>
            <div className="api-key-modal__section-rule" aria-hidden="true" />
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
