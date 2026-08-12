import { describe, expect, it } from 'vitest'

import {
  reconcileElementCallMedia,
  sameElementCallMediaList,
  type ElementCallMedia,
} from '../../src/components/calls/elementCallMedia'

const media = (id: string, userId: string | undefined, screen: boolean): ElementCallMedia => ({
  id,
  userId,
  screen,
  stream: { id } as MediaStream,
  label: id,
  muted: false,
  own: false,
})

describe('Element Call media reconciliation', () => {
  it('keeps the newest duplicate per participant and media kind', () => {
    const aliceOld = media('alice-old', '@alice:example.org', true)
    const aliceNew = media('alice-new', '@alice:example.org', true)
    const aliceCamera = media('alice-camera', '@alice:example.org', false)
    const bobScreen = media('bob-screen', '@bob:example.org', true)

    expect(reconcileElementCallMedia([aliceOld, aliceCamera, bobScreen, aliceNew])).toEqual([
      aliceCamera,
      bobScreen,
      aliceNew,
    ])
  })

  it('deduplicates anonymous layout copies by stream id', () => {
    const firstCopy = media('anonymous-screen', undefined, true)
    const secondCopy = { ...firstCopy, label: 'newest layout copy' }

    expect(reconcileElementCallMedia([firstCopy, secondCopy])).toEqual([secondCopy])
  })

  it('detects identity and source metadata learned after a stream first appears', () => {
    const unidentified = media('late-membership', undefined, true)
    const identified = { ...unidentified, userId: '@alice:example.org' }

    expect(sameElementCallMediaList([unidentified], [identified])).toBe(false)
    expect(sameElementCallMediaList([identified], [{ ...identified }])).toBe(true)
  })
})
