const THREE_CLOCK_DEPRECATION_WARNING =
  'THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.'

export function shouldSuppressConsoleWarning(args: readonly unknown[]) {
  return args.some((arg) =>
    typeof arg === 'string'
      ? arg.includes(THREE_CLOCK_DEPRECATION_WARNING)
      : false,
  )
}

export function installConsoleWarningFilter(targetConsole: Pick<Console, 'warn'>) {
  const originalWarn = targetConsole.warn.bind(targetConsole)

  targetConsole.warn = (...args: unknown[]) => {
    if (shouldSuppressConsoleWarning(args)) {
      return
    }

    originalWarn(...args)
  }

  return () => {
    targetConsole.warn = originalWarn
  }
}
