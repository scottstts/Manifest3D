export type PreviewControlKind = 'joint' | 'material'

export type PlayingAnimationPreview = {
  controlId: string
  instanceId: string
  kind: PreviewControlKind
}

export function getPlayingAnimationPreviewKey(preview: PlayingAnimationPreview) {
  return `${preview.instanceId}:${preview.kind}:${preview.controlId}`
}

export function isSamePlayingAnimationPreview(
  left: PlayingAnimationPreview,
  right: PlayingAnimationPreview,
) {
  return getPlayingAnimationPreviewKey(left) === getPlayingAnimationPreviewKey(right)
}

export function togglePlayingAnimationPreview(
  currentPlaying: readonly PlayingAnimationPreview[],
  preview: PlayingAnimationPreview,
) {
  const isAlreadyPlaying = currentPlaying.some((candidate) =>
    isSamePlayingAnimationPreview(candidate, preview),
  )

  if (isAlreadyPlaying) {
    return stopPlayingAnimationPreview(currentPlaying, preview)
  }

  return [...currentPlaying, preview]
}

export function stopPlayingAnimationPreview(
  currentPlaying: readonly PlayingAnimationPreview[],
  preview: PlayingAnimationPreview,
) {
  return currentPlaying.filter(
    (candidate) => !isSamePlayingAnimationPreview(candidate, preview),
  )
}

export function stopPlayingAnimationPreviewsForInstance(
  currentPlaying: readonly PlayingAnimationPreview[],
  instanceId: string,
) {
  return currentPlaying.filter((preview) => preview.instanceId !== instanceId)
}
