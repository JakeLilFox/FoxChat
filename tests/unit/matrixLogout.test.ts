// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

const sdkMocks = vi.hoisted(() => ({
  logout: vi.fn(),
  stopClient: vi.fn(),
}))

vi.mock('matrix-js-sdk', async (importOriginal) => {
  const original = await importOriginal<typeof import('matrix-js-sdk')>()
  return {
    ...original,
    createClient: vi.fn(() => ({
      logout: sdkMocks.logout,
      stopClient: sdkMocks.stopClient,
    })),
  }
})

import { MatrixClientService, type MatrixSession } from '../../src/matrix/MatrixClientService'

const session: MatrixSession = {
  baseUrl: 'https://matrix.example.org',
  accessToken: 'access-token',
  userId: '@alice:example.org',
  deviceId: 'DEVICE',
}

describe('Matrix logout', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    sdkMocks.logout.mockReset()
    sdkMocks.stopClient.mockReset()
  })

  it('clears the local account when remote session revocation stalls', async () => {
    vi.useFakeTimers()
    sdkMocks.logout.mockImplementation(() => new Promise(() => undefined))
    const accountId = `${session.baseUrl}|${session.userId}|${session.deviceId}`
    const serialized = JSON.stringify(session)
    localStorage.setItem('foxchat.matrix.accounts', JSON.stringify([session]))
    localStorage.setItem('foxchat.matrix.activeAccount', accountId)
    localStorage.setItem('foxchat.matrix.session', serialized)
    sessionStorage.setItem('foxchat.matrix.session', serialized)
    const service = new MatrixClientService()

    const loggingOut = service.logout()
    const rejection = expect(loggingOut).rejects.toThrow(
      'Timed out while revoking the Matrix session',
    )
    await vi.advanceTimersByTimeAsync(15_000)
    await rejection

    expect(sdkMocks.stopClient).toHaveBeenCalledOnce()
    expect(localStorage.getItem('foxchat.matrix.accounts')).toBe('[]')
    expect(localStorage.getItem('foxchat.matrix.activeAccount')).toBeNull()
    expect(localStorage.getItem('foxchat.matrix.session')).toBeNull()
    expect(sessionStorage.getItem('foxchat.matrix.session')).toBeNull()
  })
})
