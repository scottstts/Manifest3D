import { describe, expect, it } from 'vitest'
import { isMobileBrowser } from './desktopGate'

describe('isMobileBrowser', () => {
  it('blocks common mobile user agents', () => {
    expect(
      isMobileBrowser(
        {
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148',
        },
        () => false,
      ),
    ).toBe(true)
  })

  it('blocks iPadOS desktop-style Safari user agents', () => {
    expect(
      isMobileBrowser(
        {
          maxTouchPoints: 5,
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15',
        },
        () => false,
      ),
    ).toBe(true)
  })

  it('blocks coarse touch browsers without hover support', () => {
    expect(
      isMobileBrowser({ userAgent: 'Desktop shell' }, (query) =>
        ['(pointer: coarse)', '(hover: none)'].includes(query),
      ),
    ).toBe(true)
  })

  it('allows desktop browsers with fine pointer behavior', () => {
    expect(
      isMobileBrowser(
        {
          maxTouchPoints: 0,
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        () => false,
      ),
    ).toBe(false)
  })
})
