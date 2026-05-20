import { describe, expect, it } from 'vitest'
import {
  stopPlayingAnimationPreview,
  stopPlayingAnimationPreviewsForInstance,
  togglePlayingAnimationPreview,
  type PlayingAnimationPreview,
} from './animationPreviewState'

describe('animation preview playback state', () => {
  const lid: PlayingAnimationPreview = {
    controlId: 'lid',
    instanceId: 'asset-1',
    kind: 'joint',
  }
  const slider: PlayingAnimationPreview = {
    controlId: 'slider',
    instanceId: 'asset-1',
    kind: 'joint',
  }
  const beacon: PlayingAnimationPreview = {
    controlId: 'beacon',
    instanceId: 'asset-1',
    kind: 'material',
  }
  const otherInstance: PlayingAnimationPreview = {
    controlId: 'lid',
    instanceId: 'asset-2',
    kind: 'joint',
  }

  it('adds independent playbacks instead of replacing the current one', () => {
    expect(togglePlayingAnimationPreview([lid], slider)).toEqual([lid, slider])
    expect(togglePlayingAnimationPreview([lid, slider], beacon)).toEqual([
      lid,
      slider,
      beacon,
    ])
  })

  it('pauses only the matching playback when toggled again', () => {
    expect(togglePlayingAnimationPreview([lid, slider, beacon], slider)).toEqual([
      lid,
      beacon,
    ])
  })

  it('stops only the reset playback', () => {
    expect(stopPlayingAnimationPreview([lid, slider, beacon], lid)).toEqual([
      slider,
      beacon,
    ])
  })

  it('stops every playback for an instance on reset all', () => {
    expect(
      stopPlayingAnimationPreviewsForInstance([lid, slider, otherInstance], 'asset-1'),
    ).toEqual([otherInstance])
  })
})
