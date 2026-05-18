export const desktopOnlyMessage =
  'For better experience, visit on desktop browser.'

type NavigatorLike = {
  maxTouchPoints?: number
  userAgent?: string
  userAgentData?: {
    mobile?: boolean
  }
}

type MediaQueryMatcher = (query: string) => boolean

const mobileUserAgentPattern =
  /Android|BlackBerry|iPhone|iPad|iPod|IEMobile|Mobile|Opera Mini/i

export function isMobileBrowser(
  navigatorLike: NavigatorLike,
  matchesMediaQuery: MediaQueryMatcher,
) {
  if (navigatorLike.userAgentData?.mobile) {
    return true
  }

  const userAgent = navigatorLike.userAgent ?? ''

  if (mobileUserAgentPattern.test(userAgent)) {
    return true
  }

  if (isIpadOsDesktopUserAgent(userAgent, navigatorLike.maxTouchPoints ?? 0)) {
    return true
  }

  return (
    matchesMediaQuery('(pointer: coarse)') &&
    matchesMediaQuery('(hover: none)')
  )
}

function isIpadOsDesktopUserAgent(userAgent: string, maxTouchPoints: number) {
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1
}
