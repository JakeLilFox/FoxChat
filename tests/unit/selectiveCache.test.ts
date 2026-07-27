import { describe, expect, it, vi } from 'vitest'
import { SelectiveCache } from '../../src/lib/selectiveCache'

describe('SelectiveCache', () => {
  it('reuses unaffected values while recomputing invalidated keys', () => {
    const cache = new SelectiveCache<string, number>()
    const first = vi.fn(() => 1)
    const second = vi.fn(() => 2)

    expect(cache.get('first', first)).toBe(1)
    expect(cache.get('second', second)).toBe(2)
    expect(cache.get('first', first)).toBe(1)
    cache.invalidate(['second'])
    expect(cache.get('first', first)).toBe(1)
    expect(cache.get('second', second)).toBe(2)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('drops entries that no longer belong to the current room set', () => {
    const cache = new SelectiveCache<string, number>()
    const removed = vi.fn(() => 1)

    cache.get('removed', removed)
    cache.retain(new Set(['kept']))
    cache.get('removed', removed)

    expect(removed).toHaveBeenCalledTimes(2)
  })
})
