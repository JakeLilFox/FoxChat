// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'

const account = (userId: string) => ({
  baseUrl: 'https://matrix.example.org',
  accessToken: `token-${userId}`,
  userId,
  deviceId: `device-${userId}`,
})

describe('saved account parsing', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('parses unchanged account storage only once and detects storage updates', () => {
    localStorage.setItem('foxchat.matrix.accounts', JSON.stringify([account('@a:example.org')]))
    const parse = vi.spyOn(JSON, 'parse')
    const service = new MatrixClientService()

    expect(service.savedAccounts()[0]?.userId).toBe('@a:example.org')
    expect(service.savedAccounts()[0]?.userId).toBe('@a:example.org')
    expect(parse).toHaveBeenCalledTimes(1)

    localStorage.setItem('foxchat.matrix.accounts', JSON.stringify([account('@b:example.org')]))
    expect(service.savedAccounts()[0]?.userId).toBe('@b:example.org')
    expect(parse).toHaveBeenCalledTimes(2)
  })
})
