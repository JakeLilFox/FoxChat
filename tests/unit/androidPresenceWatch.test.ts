// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { matrixService } from '../../src/matrix/MatrixClientService'

describe('Android presence watches', () => {
  const originalUserAgent = navigator.userAgent

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete window.__TAURI_INTERNALS__
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent,
    })
  })

  it('deduplicates avatar polling and publishes native presence through Matrix User events', async () => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36',
    })
    const invoke = vi.fn().mockResolvedValue({
      available: true,
      presence: 'online',
      currently_active: true,
      last_active_ago: 0,
      fetched_at: 123_000,
    })
    window.__TAURI_INTERNALS__ = { invoke: invoke as never }
    const setPresenceEvent = vi.fn()
    const account = {
      id: 'account',
      userId: '@me:example.org',
      client: { getUser: () => ({ setPresenceEvent }) },
    }
    vi.spyOn(matrixService, 'availableAccounts').mockReturnValue([account] as never)
    vi.spyOn(matrixService, 'activeAccountId').mockReturnValue('account')

    const releaseFirst = matrixService.watchUserPresence('@friend:example.org')
    const releaseSecond = matrixService.watchUserPresence('@friend:example.org')
    await vi.waitFor(() => expect(setPresenceEvent).toHaveBeenCalledOnce())

    expect(invoke).toHaveBeenCalledOnce()
    expect(setPresenceEvent.mock.calls[0][0].getContent()).toMatchObject({
      presence: 'online',
      currently_active: true,
    })

    await vi.advanceTimersByTimeAsync(15_000)
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    releaseFirst()
    releaseSecond()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})
