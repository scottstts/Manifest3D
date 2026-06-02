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

  return (
    normalizedMessage.includes('model') ||
    normalizedMessage.includes('not found') ||
    normalizedMessage.includes('not supported')
  )
}

function formatModelId(modelId: string) {
  return modelId.trim() || '(blank)'
}
