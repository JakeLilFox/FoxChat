// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchAndroidRoomSnapshot } from '../../src/matrix/MatrixClientService'

describe('Android room snapshot', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns the bounded snapshot and authenticates the request', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ next_batch: 'next' }),
    })

    await expect(
      fetchAndroidRoomSnapshot(
        'https://matrix.example/_matrix/client/v3/sync',
        'token',
        1_000,
        fetcher,
      ),
    ).resolves.toEqual({ next_batch: 'next' })
    expect(fetcher).toHaveBeenCalledWith(
      'https://matrix.example/_matrix/client/v3/sync',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token' },
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('aborts instead of leaving Android startup pending forever', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(
      (_url, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted', 'AbortError')),
          )
        }),
    )
    const snapshot = fetchAndroidRoomSnapshot(
      'https://matrix.example/_matrix/client/v3/sync',
      'token',
      250,
      fetcher as typeof fetch,
    )
    const rejection = expect(snapshot).rejects.toThrow(
      'Android room snapshot timed out after 250 ms',
    )

    await vi.advanceTimersByTimeAsync(250)
    await rejection
  })

  it('preserves a homeserver HTTP failure', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 401 })

    await expect(
      fetchAndroidRoomSnapshot(
        'https://matrix.example/_matrix/client/v3/sync',
        'token',
        1_000,
        fetcher,
      ),
    ).rejects.toThrow('Android room snapshot failed with HTTP 401')
  })
})
