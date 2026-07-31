// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { VerificationPhase, VerificationRequestEvent } from 'matrix-js-sdk/lib/crypto-api'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'

class FakeVerificationRequest {
  pending = false
  phase = VerificationPhase.Unsent
  private listeners = new Set<() => void>()

  on(event: VerificationRequestEvent, listener: () => void) {
    if (event === VerificationRequestEvent.Change) this.listeners.add(listener)
  }

  off(event: VerificationRequestEvent, listener: () => void) {
    if (event === VerificationRequestEvent.Change) this.listeners.delete(listener)
  }

  change(phase: VerificationPhase, pending: boolean) {
    this.phase = phase
    this.pending = pending
    for (const listener of [...this.listeners]) listener()
  }
}

describe('incoming verification request delivery', () => {
  it('replays a non-terminal request received before the desktop UI subscribes', () => {
    const service = new MatrixClientService()
    const request = new FakeVerificationRequest()
    ;(
      service as unknown as {
        publishVerificationRequest(value: FakeVerificationRequest): void
      }
    ).publishVerificationRequest(request)

    const received = vi.fn()
    service.subscribe({ onVerificationRequest: received })

    expect(received).toHaveBeenCalledWith(request)
  })

  it('publishes a cached request when it becomes pending and removes it only when terminal', () => {
    const service = new MatrixClientService()
    const request = new FakeVerificationRequest()
    const received = vi.fn()
    service.subscribe({ onVerificationRequest: received })
    ;(
      service as unknown as {
        publishVerificationRequest(value: FakeVerificationRequest): void
      }
    ).publishVerificationRequest(request)

    received.mockClear()
    request.change(VerificationPhase.Requested, true)
    expect(received).toHaveBeenCalledWith(request)

    request.change(VerificationPhase.Cancelled, false)
    const lateSubscriber = vi.fn()
    service.subscribe({ onVerificationRequest: lateSubscriber })
    expect(lateSubscriber).not.toHaveBeenCalled()
  })
})
