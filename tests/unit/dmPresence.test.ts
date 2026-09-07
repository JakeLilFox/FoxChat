import { describe, expect, it } from 'vitest'
import { dmPresenceLabel } from '../../src/lib/presence'

describe('DM presence labels', () => {
  const now = Date.UTC(2026, 8, 7, 12, 0, 0)

  it('shows online for explicit or currently-active presence', () => {
    expect(dmPresenceLabel({ presence: 'online' }, now)).toBe('Online')
    expect(dmPresenceLabel({ presence: 'unavailable', currentlyActive: true }, now)).toBe('Online')
  })

  it('formats the elapsed last-active time', () => {
    expect(dmPresenceLabel({ lastActiveAt: now - 20_000 }, now)).toBe('Last seen just now')
    expect(dmPresenceLabel({ lastActiveAt: now - 5 * 60_000 }, now)).toBe(
      'Last seen 5 minutes ago',
    )
    expect(dmPresenceLabel({ lastActiveAt: now - 2 * 60 * 60_000 }, now)).toBe(
      'Last seen 2 hours ago',
    )
  })

  it('uses honest fallbacks when last-active data is hidden', () => {
    expect(dmPresenceLabel({ presence: 'unavailable' }, now)).toBe('Away')
    expect(dmPresenceLabel({ presence: 'offline' }, now)).toBe('Offline')
    expect(dmPresenceLabel({ available: false }, now)).toBe('Presence unavailable')
  })
})
