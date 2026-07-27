import { describe, expect, it } from 'vitest'
import { isServerEventId } from '../../src/lib/matrixIdentifiers'

describe('isServerEventId', () => {
  it('accepts server-assigned Matrix event IDs', () => {
    expect(isServerEventId('$event:example.org')).toBe(true)
    expect(isServerEventId('$opaque-event-id')).toBe(true)
  })

  it('rejects local echoes and missing IDs', () => {
    expect(isServerEventId('~local-echo')).toBe(false)
    expect(isServerEventId('')).toBe(false)
    expect(isServerEventId(undefined)).toBe(false)
  })
})
