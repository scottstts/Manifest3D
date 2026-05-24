export type SelectionFocusRequest = {
  selectedTargetId: string
  selectionRevision: number
  snapImmediately: boolean
}

const viewportAssetClickMaxDelta = 3

export function createSelectionFocusRequestKey({
  selectedTargetId,
  selectionRevision,
  snapImmediately,
}: SelectionFocusRequest) {
  return [
    selectedTargetId,
    selectionRevision,
    snapImmediately ? 'snap' : 'smooth',
  ].join(':')
}

export function shouldSelectAssetFromViewportClick(pointerDelta: number) {
  return (
    Number.isFinite(pointerDelta) && pointerDelta <= viewportAssetClickMaxDelta
  )
}
