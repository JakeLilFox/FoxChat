import { describe, expect, it, vi } from 'vitest'
import {
  marketingMatrixFetch,
  settleMatrixRequests,
} from '../../scripts/marketing-matrix-fetch.mjs'

const url = 'https://matrix.example.org/_matrix/client/v3/rooms/room/state/m.room.avatar/'
const networkError = () =>
  new TypeError('fetch failed', {
    cause: Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }),
  })
const setup = () => ({
  fetchImpl: vi.fn(),
  wait: vi.fn().mockResolvedValue(undefined),
  warn: vi.fn(),
})

describe('marketing Matrix requests', () => {
  it('retries the same PUT after a transient socket error with a fresh timeout', async () => {
    const config = setup()
    config.fetchImpl
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(Response.json({ event_id: '$ok' }))
    const options = {
      method: 'PUT',
      body: '{"url":"mxc://example/avatar"}',
      headers: { Authorization: 'Bearer secret' },
    }
    const response = await marketingMatrixFetch(url, options, config)
    expect(await response.json()).toEqual({ event_id: '$ok' })
    expect(config.wait).toHaveBeenCalledWith(1_000)
    expect(config.fetchImpl.mock.calls[1][1]).toMatchObject(options)
    expect(config.fetchImpl.mock.calls[0][1].signal).not.toBe(
      config.fetchImpl.mock.calls[1][1].signal,
    )
    expect(config.warn.mock.calls[0][0]).toContain('ECONNRESET')
    expect(config.warn.mock.calls[0][0]).not.toContain('secret')
  })

  it('retries a dropped response body', async () => {
    const config = setup()
    config.fetchImpl
      .mockResolvedValueOnce({ text: () => Promise.reject(networkError()) })
      .mockResolvedValueOnce(Response.json({ ok: true }))
    expect(await (await marketingMatrixFetch(url, { method: 'PUT' }, config)).json()).toEqual({
      ok: true,
    })
  })

  it('limits retries and identifies the failing endpoint and root cause', async () => {
    const config = setup()
    config.fetchImpl.mockRejectedValue(networkError())
    await expect(marketingMatrixFetch(url, { method: 'PUT' }, config)).rejects.toThrow(
      `Matrix PUT ${url} failed after 4 attempt(s): fetch failed; ECONNRESET: socket closed`,
    )
    expect(config.fetchImpl).toHaveBeenCalledTimes(4)
    expect(config.wait.mock.calls).toEqual([[1_000], [2_000], [4_000]])
  })

  it('does not repeat room creation after an ambiguous transport failure', async () => {
    const config = setup()
    config.fetchImpl.mockRejectedValue(networkError())
    await expect(marketingMatrixFetch(url, { method: 'POST' }, config)).rejects.toThrow(
      'after 1 attempt(s)',
    )
    expect(config.fetchImpl).toHaveBeenCalledOnce()
  })

  it('honors rate limits even for a rejected POST', async () => {
    const config = setup()
    config.fetchImpl
      .mockResolvedValueOnce(
        Response.json({ retry_after_ms: 2_500 }, { status: 429, headers: { 'Retry-After': '2' } }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }))
    await marketingMatrixFetch(url, { method: 'POST' }, config)
    expect(config.wait).toHaveBeenCalledWith(2_500)
  })

  it.each([401, 403, 404])(
    'returns HTTP %s to the existing authentication/error handling',
    async (status) => {
      const config = setup()
      config.fetchImpl.mockResolvedValueOnce(Response.json({ errcode: 'failure' }, { status }))
      expect((await marketingMatrixFetch(url, { method: 'PUT' }, config)).status).toBe(status)
      expect(config.fetchImpl).toHaveBeenCalledOnce()
    },
  )

  it('retries temporary gateway failures', async () => {
    const config = setup()
    config.fetchImpl
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect((await marketingMatrixFetch(url, { method: 'PUT' }, config)).status).toBe(204)
    expect(config.fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not retry sooner than an excessive server retry delay', async () => {
    const config = setup()
    config.fetchImpl.mockResolvedValueOnce(
      Response.json({ retry_after_ms: 180_000 }, { status: 429 }),
    )
    expect((await marketingMatrixFetch(url, { method: 'PUT' }, config)).status).toBe(429)
    expect(config.wait).not.toHaveBeenCalled()
  })

  it('waits for other setup mutations before propagating a failure to cleanup', async () => {
    let resolve
    const outstanding = new Promise((done) => {
      resolve = done
    })
    const caught = vi.fn()
    const batch = settleMatrixRequests([Promise.reject(new Error('failed')), outstanding]).catch(
      caught,
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(caught).not.toHaveBeenCalled()
    resolve('finished')
    await batch
    expect(caught).toHaveBeenCalledWith(expect.objectContaining({ message: 'failed' }))
  })
})
