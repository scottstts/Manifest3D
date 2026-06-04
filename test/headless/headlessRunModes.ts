export type HeadlessRunMode = 'full' | 'initial' | 'repair'

export type HeadlessRunConfig = {
  expectReady: boolean
  maxRepairTurns: number
  mode: HeadlessRunMode
  repairSeedPath: string | null
}

export type HeadlessRunModeEnv = Partial<
  Record<
    | 'HEADLESS_AGENT_EXPECT_READY'
    | 'HEADLESS_AGENT_MAX_REPAIR_TURNS'
    | 'HEADLESS_AGENT_REPAIR_FROM_CANDIDATE_PATH'
    | 'HEADLESS_AGENT_RUN_MODE',
    string
  >
>

export function resolveHeadlessRunConfig(
  env: HeadlessRunModeEnv,
  defaultRepairTurnCap: number,
): HeadlessRunConfig {
  const repairSeedPath =
    readTrimmedEnv(env, 'HEADLESS_AGENT_REPAIR_FROM_CANDIDATE_PATH') || null
  const modeSetting = readHeadlessRunMode(env, repairSeedPath)

  if (
    modeSetting.explicit &&
    modeSetting.mode !== 'repair' &&
    repairSeedPath !== null
  ) {
    throw new Error(
      'HEADLESS_AGENT_REPAIR_FROM_CANDIDATE_PATH is only valid with HEADLESS_AGENT_RUN_MODE=repair.',
    )
  }

  if (modeSetting.mode === 'repair' && repairSeedPath === null) {
    throw new Error(
      'HEADLESS_AGENT_RUN_MODE=repair requires HEADLESS_AGENT_REPAIR_FROM_CANDIDATE_PATH.',
    )
  }

  const maxRepairTurns =
    modeSetting.mode === 'initial'
      ? 0
      : modeSetting.mode === 'repair'
        ? 1
        : readPositiveNumberEnv(
            env,
            'HEADLESS_AGENT_MAX_REPAIR_TURNS',
            defaultRepairTurnCap,
          )

  return {
    expectReady: readBooleanEnv(
      env,
      'HEADLESS_AGENT_EXPECT_READY',
      modeSetting.mode === 'full',
    ),
    maxRepairTurns,
    mode: modeSetting.mode,
    repairSeedPath,
  }
}

function readHeadlessRunMode(
  env: HeadlessRunModeEnv,
  repairSeedPath: string | null,
): { explicit: boolean; mode: HeadlessRunMode } {
  const value = readTrimmedEnv(env, 'HEADLESS_AGENT_RUN_MODE').toLowerCase()

  if (!value) {
    return {
      explicit: false,
      mode: repairSeedPath ? 'repair' : 'full',
    }
  }

  if (value === 'full' || value === 'create' || value === 'pipeline') {
    return {
      explicit: true,
      mode: 'full',
    }
  }

  if (
    value === 'initial' ||
    value === 'init' ||
    value === 'first' ||
    value === 'first-attempt' ||
    value === 'create-only'
  ) {
    return {
      explicit: true,
      mode: 'initial',
    }
  }

  if (value === 'repair' || value === 'single-repair' || value === 'repair-only') {
    return {
      explicit: true,
      mode: 'repair',
    }
  }

  throw new Error(
    `Unsupported HEADLESS_AGENT_RUN_MODE "${value}". Use "full", "initial", or "repair".`,
  )
}

function readPositiveNumberEnv(
  env: HeadlessRunModeEnv,
  key: keyof HeadlessRunModeEnv,
  fallback: number,
) {
  const value = Number(env[key])

  return Number.isFinite(value) && value > 0 ? value : fallback
}

function readBooleanEnv(
  env: HeadlessRunModeEnv,
  key: keyof HeadlessRunModeEnv,
  fallback: boolean,
) {
  const value = readTrimmedEnv(env, key).toLowerCase()

  if (!value) {
    return fallback
  }

  return !['0', 'false', 'no', 'off'].includes(value)
}

function readTrimmedEnv(env: HeadlessRunModeEnv, key: keyof HeadlessRunModeEnv) {
  return env[key]?.trim() ?? ''
}
