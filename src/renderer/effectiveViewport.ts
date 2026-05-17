export type RectLike = {
  height: number
  left: number
  width: number
}

export type ProjectionViewOffset = {
  fullHeight: number
  fullWidth: number
  height: number
  offsetX: number
  offsetY: number
  width: number
}

export function getLeftSidePanelOcclusionWidth(
  panelRect: RectLike,
  viewportWidth: number,
) {
  if (viewportWidth <= 0 || panelRect.width <= 0) {
    return 0
  }

  const isLeftSidePanel = panelRect.left < viewportWidth * 0.45

  if (!isLeftSidePanel) {
    return 0
  }

  return Math.min(panelRect.left + panelRect.width, viewportWidth * 0.75)
}

export function getRightSidePanelOcclusionWidth(
  panelRect: RectLike,
  viewportWidth: number,
) {
  if (viewportWidth <= 0 || panelRect.width <= 0) {
    return 0
  }

  const isRightSidePanel = panelRect.left > viewportWidth * 0.45

  if (!isRightSidePanel) {
    return 0
  }

  return Math.min(viewportWidth - panelRect.left, viewportWidth * 0.75)
}

export function getEffectiveViewportCenterX(
  viewportWidth: number,
  rightOcclusionWidth: number,
  leftOcclusionWidth = 0,
) {
  const rightWidth = clampHorizontalOcclusionWidth(
    viewportWidth,
    rightOcclusionWidth,
  )
  const leftWidth = clampHorizontalOcclusionWidth(
    viewportWidth,
    leftOcclusionWidth,
  )

  return leftWidth + (viewportWidth - leftWidth - rightWidth) / 2
}

export function getProjectionViewOffset(
  viewportWidth: number,
  viewportHeight: number,
  rightOcclusionWidth: number,
  leftOcclusionWidth = 0,
): ProjectionViewOffset | null {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return null
  }

  const rightWidth = clampHorizontalOcclusionWidth(
    viewportWidth,
    rightOcclusionWidth,
  )
  const leftWidth = clampHorizontalOcclusionWidth(
    viewportWidth,
    leftOcclusionWidth,
  )
  const offsetX = (rightWidth - leftWidth) / 2

  if (Math.abs(offsetX) <= 0.5) {
    return null
  }

  return {
    fullHeight: viewportHeight,
    fullWidth: viewportWidth,
    height: viewportHeight,
    offsetX,
    offsetY: 0,
    width: viewportWidth,
  }
}

function clampHorizontalOcclusionWidth(
  viewportWidth: number,
  occlusionWidth: number,
) {
  return Math.max(0, Math.min(occlusionWidth, viewportWidth * 0.75))
}
