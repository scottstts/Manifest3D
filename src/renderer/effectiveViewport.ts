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
) {
  const occlusionWidth = clampRightOcclusionWidth(
    viewportWidth,
    rightOcclusionWidth,
  )

  return (viewportWidth - occlusionWidth) / 2
}

export function getProjectionViewOffset(
  viewportWidth: number,
  viewportHeight: number,
  rightOcclusionWidth: number,
): ProjectionViewOffset | null {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return null
  }

  const occlusionWidth = clampRightOcclusionWidth(
    viewportWidth,
    rightOcclusionWidth,
  )

  if (occlusionWidth <= 0.5) {
    return null
  }

  return {
    fullHeight: viewportHeight,
    fullWidth: viewportWidth,
    height: viewportHeight,
    offsetX: occlusionWidth / 2,
    offsetY: 0,
    width: viewportWidth,
  }
}

function clampRightOcclusionWidth(
  viewportWidth: number,
  rightOcclusionWidth: number,
) {
  return Math.max(0, Math.min(rightOcclusionWidth, viewportWidth * 0.75))
}
