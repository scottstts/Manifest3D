import { describe, expect, it, vi } from 'vitest'
import {
  installConsoleWarningFilter,
  shouldSuppressConsoleWarning,
} from './consoleWarningFilter'

describe('shouldSuppressConsoleWarning', () => {
  it('suppresses only the known harmless Three Clock deprecation warning', () => {
    expect(
      shouldSuppressConsoleWarning([
        'THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.',
      ]),
    ).toBe(true)
    expect(shouldSuppressConsoleWarning(['THREE.WebGLProgram: Shader Error'])).toBe(
      false,
    )
    expect(shouldSuppressConsoleWarning([new Error('THREE.Clock')])).toBe(false)
  })
})

describe('installConsoleWarningFilter', () => {
  it('filters the Three Clock warning while preserving other warnings', () => {
    const warn = vi.fn()
    const targetConsole = { warn }
    const restore = installConsoleWarningFilter(targetConsole)

    targetConsole.warn(
      'THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.',
    )
    targetConsole.warn('real warning', { keep: true })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('real warning', { keep: true })

    restore()
    targetConsole.warn('after restore')
    expect(warn).toHaveBeenCalledWith('after restore')
  })
})
