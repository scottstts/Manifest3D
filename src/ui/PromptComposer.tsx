import { Paperclip, Send } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import type { AgentImageAttachment } from '../engine/agent/providerClient'

type PromptComposerProps = {
  disabled?: boolean
  onSubmit: (
    userPrompt: string,
    imageAttachments: readonly AgentImageAttachment[],
  ) => void
}

export function PromptComposer({
  disabled = false,
  onSubmit,
}: PromptComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [attachments, setAttachments] = useState<AgentImageAttachment[]>([])
  const [prompt, setPrompt] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedPrompt = prompt.trim()

    if (!trimmedPrompt || disabled) {
      return
    }

    onSubmit(trimmedPrompt, attachments)
    setPrompt('')
    setAttachments([])
  }

  async function handleFiles(files: FileList | null) {
    if (!files || disabled) {
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
      <textarea
        disabled={disabled}
        id="scene-prompt"
        placeholder="What to create?"
        rows={1}
        value={prompt}
        onChange={(event) => setPrompt(event.currentTarget.value)}
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
          disabled={disabled}
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip aria-hidden="true" />
        </button>
        {attachments.length > 0 && (
          <span className="prompt-composer__attachment-count">
            {attachments.length}
          </span>
        )}
        <button
          aria-label="Send prompt"
          className="send-button"
          disabled={disabled || prompt.trim().length === 0}
          type="submit"
        >
          <Send aria-hidden="true" />
        </button>
      </div>
    </form>
  )
}

async function readImageAttachment(file: File): Promise<AgentImageAttachment> {
  const imageUrl = await readFileAsDataUrl(file)
  const dimensions = await readImageDimensions(imageUrl)

  return {
    height: dimensions.height,
    id: createImageAttachmentId(file),
    imageUrl,
    mediaType: file.type || 'application/octet-stream',
    name: file.name,
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

function createImageAttachmentId(file: File) {
  const baseName = file.name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `ref-${baseName || 'image'}-${file.size}-${file.lastModified}`
}
