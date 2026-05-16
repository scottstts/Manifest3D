import { describe, expect, it } from 'vitest'
import {
  getEffectiveViewportCenterX,
  getProjectionViewOffset,
  getRightSidePanelOcclusionWidth,
} from './effectiveViewport'

describe('effective viewport helpers', () => {
  it('uses everything from the right-side panel left edge as horizontal occlusion', () => {
    expect(
      getRightSidePanelOcclusionWidth(
        { height: 680, left: 866, width: 420 },
        1300,
      ),
    ).toBe(434)
  })

  it('ignores bottom-sheet layouts that span from the left edge', () => {
    expect(
      getRightSidePanelOcclusionWidth(
        { height: 240, left: 8, width: 784 },
        800,
      ),
    ).toBe(0)
  })

  it('centers selection inside the visible viewport when a side panel overlaps', () => {
    expect(getEffectiveViewportCenterX(1200, 360)).toBe(420)
  })

  it('converts right occlusion into a left-shifted perspective view offset', () => {
    expect(getProjectionViewOffset(1200, 800, 360)).toEqual({
      fullHeight: 800,
      fullWidth: 1200,
      height: 800,
      offsetX: 180,
      offsetY: 0,
      width: 1200,
    })
  })
})
