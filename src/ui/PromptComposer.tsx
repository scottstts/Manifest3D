import { LoaderCircle, Paperclip, Send, X } from 'lucide-react'
import {
  type ClipboardEvent,
  type FormEvent,
  type ChangeEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { AgentImageAttachment } from '../engine/agent/provider/providerClient'

type PromptComposerProps = {
  disabled?: boolean
  disabledReason?: string | null
  isSubmitting?: boolean
  onImagePreviewRequested?: (attachment: AgentImageAttachment) => void
  onStop?: () => void
  onSubmit: (
    userPrompt: string,
    imageAttachments: readonly AgentImageAttachment[],
  ) => void
}

export function PromptComposer({
  disabled = false,
  disabledReason = null,
  isSubmitting = false,
  onImagePreviewRequested,
  onStop,
  onSubmit,
}: PromptComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [attachments, setAttachments] = useState<AgentImageAttachment[]>([])
  const [prompt, setPrompt] = useState('')

  useLayoutEffect(() => {
    resizeTextarea(textareaRef.current)
  }, [prompt])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedPrompt = prompt.trim()

    if (isSubmitting) {
      onStop?.()
      return
    }

    if (!trimmedPrompt || disabled) {
      return
    }

    onSubmit(trimmedPrompt, attachments)
    setPrompt('')
    setAttachments([])
  }

  function handlePromptChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setPrompt(event.currentTarget.value)
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((currentAttachments) =>
      currentAttachments.filter((attachment) => attachment.id !== attachmentId),
    )
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (disabled || isSubmitting) {
      return
    }

    const imageFiles = [...event.clipboardData.items]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))

    if (imageFiles.length === 0) {
      return
    }

    const nextAttachments = await Promise.all(
      imageFiles.map((file, index) =>
        readImageAttachment(
          file,
          `pasted-image-${Date.now().toString(36)}-${index + 1}`,
        ),
      ),
    )

    setAttachments((currentAttachments) => [
      ...currentAttachments,
      ...nextAttachments,
    ])
  }

  async function handleFiles(files: FileList | null) {
    if (!files || disabled || isSubmitting) {
      return
    }

    const imageFiles = [...files].filter((file) =>
      file.type.startsWith('image/'),
    )
    const nextAttachments = await Promise.all(
      imageFiles.map((file) => readImageAttachment(file)),
    )

    setAttachments((currentAttachments) => [
      ...currentAttachments,
      ...nextAttachments,
    ])

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <form
      className="prompt-composer"
      aria-label="Prompt composer"
      onSubmit={handleSubmit}
    >
      <label className="sr-only" htmlFor="scene-prompt">
        Prompt
      </label>
      {attachments.length > 0 && (
        <div className="prompt-composer__previews" aria-label="Attached images">
          {attachments.map((attachment) => (
            <div className="prompt-composer__preview" key={attachment.id}>
              <button
                aria-label={`Preview ${attachment.name ?? 'attached reference'}`}
                className="prompt-composer__preview-open"
                type="button"
                onClick={() => onImagePreviewRequested?.(attachment)}
              >
                <img
                  alt={attachment.name ?? 'Attached reference'}
                  src={attachment.imageUrl}
                />
              </button>
              <button
                aria-label={`Remove ${attachment.name ?? 'attached image'}`}
                className="prompt-composer__preview-remove"
                type="button"
                onClick={() => removeAttachment(attachment.id)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        disabled={disabled || isSubmitting}
        id="scene-prompt"
        placeholder={disabledReason ?? 'What to create?'}
        ref={textareaRef}
        rows={1}
        value={prompt}
        onChange={handlePromptChange}
        onPaste={(event) => void handlePaste(event)}
      />
      <input
        accept="image/*"
        aria-label="Reference images"
        className="prompt-composer__file-input"
        multiple
        ref={fileInputRef}
        type="file"
        onChange={(event) => void handleFiles(event.currentTarget.files)}
      />
      <div className="prompt-composer__actions">
        <button
          aria-label="Attach reference file"
          disabled={disabled || isSubmitting}
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip aria-hidden="true" />
        </button>
        <button
          aria-label={isSubmitting ? 'Stop generation' : 'Send prompt'}
          className={`send-button${isSubmitting ? ' is-running' : ''}`}
          disabled={isSubmitting ? false : disabled || prompt.trim().length === 0}
          title={isSubmitting ? 'Stop generation' : 'Send prompt'}
          type={isSubmitting ? 'button' : 'submit'}
          onClick={isSubmitting ? onStop : undefined}
        >
          {isSubmitting ? (
            <span className="send-button__running" aria-hidden="true">
              <LoaderCircle />
              <span className="send-button__stop-square" />
            </span>
          ) : (
            <Send aria-hidden="true" />
          )}
        </button>
      </div>
    </form>
  )
}

async function readImageAttachment(
  file: File,
  fallbackName?: string,
): Promise<AgentImageAttachment> {
  const imageUrl = await readFileAsDataUrl(file)
  const dimensions = await readImageDimensions(imageUrl)
  const name = file.name || fallbackName || 'pasted-image'

  return {
    height: dimensions.height,
    id: createImageAttachmentId(file, fallbackName),
    imageUrl,
    mediaType: file.type || 'application/octet-stream',
    name,
    width: dimensions.width,
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.addEventListener('load', () => {
      resolve(String(reader.result))
    })
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('Reference image could not be read.'))
    })
    reader.readAsDataURL(file)
  })
}

function readImageDimensions(
  imageUrl: string,
): Promise<{ height: number | undefined; width: number | undefined }> {
  return new Promise((resolve) => {
    const image = new Image()

    image.addEventListener('load', () => {
      resolve({
        height: image.naturalHeight || undefined,
        width: image.naturalWidth || undefined,
      })
    })
    image.addEventListener('error', () => {
      resolve({
        height: undefined,
        width: undefined,
      })
    })
    image.src = imageUrl
  })
}

function createImageAttachmentId(file: File, fallbackName?: string) {
  const baseName = (file.name || fallbackName || 'pasted-image')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const uniqueSuffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

  return `ref-${
    baseName || 'image'
  }-${file.size}-${file.lastModified || Date.now()}-${uniqueSuffix}`
}

function resizeTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) {
    return
  }

  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}
