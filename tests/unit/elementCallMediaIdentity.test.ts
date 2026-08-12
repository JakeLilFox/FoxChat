import { describe, expect, it } from 'vitest'

import { injectElementCallMediaIdentity } from '../../scripts/element-call-media-identity.mts'

describe('Element Call media identity injection', () => {
  it('adds the LiveKit participant identity to the shared audio/video track props', () => {
    const source =
      'before;{"data-lk-local-participant":e.participant.isLocal,"data-lk-source":n?.source};after'

    const transformed = injectElementCallMediaIdentity(source)

    expect(transformed.replacements).toBe(1)
    expect(transformed.source).toContain(
      '"data-foxchat-participant-identity":e.participant.identity',
    )
  })

  it('leaves unrelated assets unchanged', () => {
    expect(injectElementCallMediaIdentity('unrelated')).toEqual({
      source: 'unrelated',
      replacements: 0,
    })
  })
})
