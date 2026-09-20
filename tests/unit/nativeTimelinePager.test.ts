import { describe, expect, it, vi } from 'vitest'
import { NativeTimelinePager, type NativeTimelinePage } from '../../src/lib/nativeTimelinePager'

const page = (ids: string[], hasNewer = false): NativeTimelinePage => ({
  events: ids.map((eventId) => ({ eventId, rawEvent: eventId })),
  hasNewer,
})

describe('native timeline page fetching', () => {
  it('defers live notifications in history and fetches every missed page on return', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page(['b', 'c'], true))
      .mockResolvedValueOnce(page(['d']))
      .mockResolvedValueOnce(page(['c', 'd']))
    const apply = vi.fn().mockResolvedValue(undefined)
    const pager = new NativeTimelinePager(fetch, apply)
    pager.seed(page(['a']))
    await pager.refresh()
    await pager.refresh()
    expect(fetch).not.toHaveBeenCalled()
    pager.follow(true)
    await pager.refresh()
    expect(fetch.mock.calls).toEqual([['a'], ['c'], []])
    expect(
      apply.mock.calls.map(([result]) =>
        result.events.map((event: { eventId: string }) => event.eventId),
      ),
    ).toEqual([['b', 'c'], ['d'], ['c', 'd']])
  })

  it('does not apply a response that arrives after scrolling into history', async () => {
    let resolve!: (result: NativeTimelinePage) => void
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<NativeTimelinePage>((done) => {
            resolve = done
          }),
      )
      .mockResolvedValueOnce(page(['b']))
      .mockResolvedValueOnce(page(['b']))
    const apply = vi.fn().mockResolvedValue(undefined)
    const pager = new NativeTimelinePager(fetch, apply)
    pager.seed(page(['a']))
    pager.follow(true)
    const request = pager.refresh()
    pager.follow(false)
    resolve(page(['b']))
    await request
    expect(apply).not.toHaveBeenCalled()
    pager.follow(true)
    await pager.refresh()
    expect(fetch.mock.calls).toEqual([['a'], ['a'], []])
  })

  it('refreshes existing event IDs for decryption and edits', async () => {
    const updated = { events: [{ eventId: 'a', rawEvent: 'decrypted' }] }
    const fetch = vi.fn().mockResolvedValueOnce(page([])).mockResolvedValueOnce(updated)
    const apply = vi.fn().mockResolvedValue(undefined)
    const pager = new NativeTimelinePager(fetch, apply)
    pager.seed(page(['a']))
    pager.follow(true)
    await pager.refresh()
    expect(apply).toHaveBeenLastCalledWith(updated)
  })

  it('fetches arrivals during a live-window refresh using the cursor instead of skipping a gap', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page(['d']))
      .mockResolvedValueOnce(page(['b', 'c'], true))
      .mockResolvedValueOnce(page(['d']))
      .mockResolvedValueOnce(page(['d']))
    const apply = vi.fn().mockResolvedValue(undefined)
    const pager = new NativeTimelinePager(fetch, apply)
    pager.seed(page(['a']))
    pager.follow(true)
    await pager.refresh()
    expect(fetch.mock.calls).toEqual([['a'], [], ['a'], ['c'], []])
    expect(apply.mock.calls[1][0]).toEqual(page(['b', 'c'], true))
  })

  it('retries failed requests from the last applied cursor', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page(['b']))
      .mockResolvedValueOnce(page(['b']))
    const pager = new NativeTimelinePager(fetch, vi.fn().mockResolvedValue(undefined))
    pager.seed(page(['a']))
    pager.follow(true)
    await expect(pager.refresh()).rejects.toThrow('offline')
    await pager.refresh()
    expect(fetch.mock.calls).toEqual([['a'], ['a'], []])
  })
})
