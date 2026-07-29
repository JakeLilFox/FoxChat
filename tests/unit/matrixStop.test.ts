// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'

describe('Matrix client shutdown', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not let a stalled background decryption block sign-out forever', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const stopClient = vi.fn()
    const service = new MatrixClientService()
    const internals = service as unknown as {
      client: { stopClient: () => void }
      cryptoRetryInFlight: Promise<unknown>
    }
    internals.client = { stopClient }
    internals.cryptoRetryInFlight = new Promise(() => undefined)

    const stopping = service.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    await stopping

    expect(stopClient).toHaveBeenCalledOnce()
    expect(console.warn).toHaveBeenCalledWith(
      '[crypto] Timed out waiting for background decryption before stopping',
    )
  })
})
