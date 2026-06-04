import { describe, expect, it } from 'vitest'
import { resolveHeadlessRunConfig } from './headlessRunModes'

describe('resolveHeadlessRunConfig', () => {
  it('defaults to a full run with the default repair cap and ready expectation', () => {
    expect(resolveHeadlessRunConfig({}, 10)).toEqual({
      expectReady: true,
      maxRepairTurns: 10,
      mode: 'full',
      repairSeedPath: null,
    })
  })

  it('uses zero repairs and no ready expectation for initial-only runs', () => {
    expect(
      resolveHeadlessRunConfig(
        {
          HEADLESS_AGENT_MAX_REPAIR_TURNS: '10',
          HEADLESS_AGENT_RUN_MODE: 'initial',
        },
        10,
      ),
    ).toEqual({
      expectReady: false,
      maxRepairTurns: 0,
      mode: 'initial',
      repairSeedPath: null,
    })
  })

  it('uses exactly one repair turn for explicit repair runs', () => {
    expect(
      resolveHeadlessRunConfig(
        {
          HEADLESS_AGENT_REPAIR_FROM_CANDIDATE_PATH:
            'test/headless/artifacts/run/attempts/01/candidate.json',
          HEADLESS_AGENT_RUN_MODE: 'repair',
        },
        10,
      ),
    ).toEqual({
      expectReady: false,
      maxRepairTurns: 1,
      mode: 'repair',
      repairSeedPath: 'test/headless/artifacts/run/attempts/01/candidate.json',
    })
  })

  it('infers repair mode when a seed candidate path is provided', () => {
    expect(
      resolveHeadlessRunConfig(
        {
          HEADLESS_AGENT_REPAIR_FROM_CANDIDATE_PATH:
            'test/headless/artifacts/run/attempts/02/candidate.json',
        },
        10,
      ).mode,
    ).toBe('repair')
  })

  it('lets explicit ready expectation override the mode default', () => {
    expect(
      resolveHeadlessRunConfig(
        {
          HEADLESS_AGENT_EXPECT_READY: '1',
          HEADLESS_AGENT_REPAIR_FROM_CANDIDATE_PATH: 'candidate.json',
          HEADLESS_AGENT_RUN_MODE: 'repair',
        },
        10,
      ).expectReady,
    ).toBe(true)
    expect(
      resolveHeadlessRunConfig(
        {
          HEADLESS_AGENT_EXPECT_READY: '0',
          HEADLESS_AGENT_RUN_MODE: 'full',
        },
        10,
      ).expectReady,
    ).toBe(false)
  })

  it('rejects repair mode without a seed candidate path', () => {
    expect(() =>
      resolveHeadlessRunConfig(
        {
          HEADLESS_AGENT_RUN_MODE: 'repair',
        },
        10,
      ),
    ).toThrow('requires HEADLESS_AGENT_REPAIR_FROM_CANDIDATE_PATH')
  })

  it('rejects seed candidate paths outside repair mode', () => {
    expect(() =>
      resolveHeadlessRunConfig(
        {
          HEADLESS_AGENT_REPAIR_FROM_CANDIDATE_PATH: 'candidate.json',
          HEADLESS_AGENT_RUN_MODE: 'initial',
        },
        10,
      ),
    ).toThrow('only valid with HEADLESS_AGENT_RUN_MODE=repair')
  })
})
