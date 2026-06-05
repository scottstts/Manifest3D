export function createProviderModelHttpErrorMessage({
  message,
  modelId,
  providerLabel,
  statusCode,
}: {
  message: string | null
  modelId: string
  providerLabel: string
  statusCode: number
}) {
  if (!isLikelyModelHttpError(statusCode, message)) {
    return null
  }

  return `${providerLabel} could not use model "${formatModelId(modelId)}". Check the Model ID in Providers and try again.`
}

function isLikelyModelHttpError(
  statusCode: number,
  message: string | null,
) {
  if (statusCode !== 400 && statusCode !== 404) {
    return false
  }

  const normalizedMessage = message?.toLowerCase() ?? ''

  if (statusCode === 404) {
    return (
      normalizedMessage.includes('model') ||
      normalizedMessage.includes('not found') ||
      normalizedMessage.includes('not supported')
    )
  }

  return (
    normalizedMessage.includes('model') &&
    (normalizedMessage.includes('not found') ||
      normalizedMessage.includes('does not exist') ||
      normalizedMessage.includes('invalid') ||
      normalizedMessage.includes('not supported') ||
      normalizedMessage.includes('unsupported'))
  )
}

function formatModelId(modelId: string) {
  return modelId.trim() || '(blank)'
}
