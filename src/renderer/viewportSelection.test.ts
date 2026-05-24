import { describe, expect, it } from 'vitest'
import {
  createSelectionFocusRequestKey,
  shouldSelectAssetFromViewportClick,
} from './viewportSelection'

describe('shouldSelectAssetFromViewportClick', () => {
  it('accepts stationary clicks and rejects drag-sized pointer movement', () => {
    expect(shouldSelectAssetFromViewportClick(0)).toBe(true)
    expect(shouldSelectAssetFromViewportClick(3)).toBe(true)
    expect(shouldSelectAssetFromViewportClick(3.1)).toBe(false)
  })

  it('rejects non-finite pointer deltas', () => {
    expect(shouldSelectAssetFromViewportClick(Number.NaN)).toBe(false)
    expect(shouldSelectAssetFromViewportClick(Number.POSITIVE_INFINITY)).toBe(
      false,
    )
  })
})

describe('createSelectionFocusRequestKey', () => {
  it('is stable across rerenders and changes only for real focus requests', () => {
    const request = {
      selectedTargetId: 'asset-1',
      selectionRevision: 7,
      snapImmediately: true,
    }

    expect(createSelectionFocusRequestKey(request)).toBe(
      createSelectionFocusRequestKey({ ...request }),
    )
    expect(createSelectionFocusRequestKey(request)).not.toBe(
      createSelectionFocusRequestKey({
        ...request,
        selectionRevision: request.selectionRevision + 1,
      }),
    )
    expect(createSelectionFocusRequestKey(request)).not.toBe(
      createSelectionFocusRequestKey({
        ...request,
        snapImmediately: false,
      }),
    )
  })
})
