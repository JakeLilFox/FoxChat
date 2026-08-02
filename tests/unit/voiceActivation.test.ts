import { describe, expect, it } from 'vitest'

import { voiceActivityDecision } from '../../src/components/calls/VoiceActivation'

describe('voiceActivityDecision', () => {
  it('opens speech-shaped audio after the short attack', () => {
    expect(voiceActivityDecision(0, true, false)).toEqual({
      candidate: true,
      active: false,
      voiceLike: true,
    })
    expect(voiceActivityDecision(110, true, false).active).toBe(true)
  })

  it('falls back to sustained energy when the shape classifier misses a voice', () => {
    expect(voiceActivityDecision(179, false, false)).toEqual({
      candidate: false,
      active: false,
      voiceLike: false,
    })
    expect(voiceActivityDecision(180, false, false)).toEqual({
      candidate: true,
      active: true,
      voiceLike: true,
    })
  })

  it('keeps an established voice active while it remains above threshold', () => {
    expect(voiceActivityDecision(0, false, true)).toEqual({
      candidate: true,
      active: true,
      voiceLike: false,
    })
  })

  it('never activates below the level threshold', () => {
    expect(voiceActivityDecision(undefined, true, true)).toEqual({
      candidate: false,
      active: false,
      voiceLike: true,
    })
  })
})
