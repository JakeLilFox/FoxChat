// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addPluginListener: vi.fn(),
  registerMatrixPush: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tauri-apps/api/core', () => ({ addPluginListener: mocks.addPluginListener }))
vi.mock('../../src/platform/push', () => ({
  clearMatrixPushRoom: vi.fn(),
  registerMatrixPush: mocks.registerMatrixPush,
  scheduleNativeCryptoSync: vi.fn(),
  scheduleNativeCryptoSyncForEvent: vi.fn(),
}))

import { MatrixClientService } from '../../src/matrix/MatrixClientService'

describe('Android push token rotation', () => {
  afterEach(() => {
    mocks.addPluginListener.mockReset()
    mocks.registerMatrixPush.mockClear()
    delete window.__TAURI_INTERNALS__
  })

  it('refreshes the Matrix pusher for every loaded account', async () => {
    const listeners = new Map<string, (payload: unknown) => void>()
    mocks.addPluginListener.mockImplementation(
      (_plugin: string, event: string, listener: (payload: unknown) => void) => {
        listeners.set(event, listener)
        return Promise.resolve(() => undefined)
      },
    )
    window.__TAURI_INTERNALS__ = { invoke: vi.fn() }
    const service = new MatrixClientService()
    const firstClient = { id: 'first' }
    const secondClient = { id: 'second' }
    vi.spyOn(service, 'availableAccounts').mockReturnValue([
      { id: 'first', userId: '@first:example.org', client: firstClient as never },
      { id: 'second', userId: '@second:example.org', client: secondClient as never },
    ])

    await service.listenForNotificationDecryptRequests()
    listeners.get('token-received')?.({ token: 'rotated-firebase-token' })

    await vi.waitFor(() => expect(mocks.registerMatrixPush).toHaveBeenCalledTimes(2))
    expect(mocks.registerMatrixPush).toHaveBeenCalledWith(firstClient)
    expect(mocks.registerMatrixPush).toHaveBeenCalledWith(secondClient)
  })

  it('applies Matrix credentials refreshed by the closed-app Android job', async () => {
    const invoke = vi.fn().mockResolvedValue({
      accessToken: 'native-access',
      refreshToken: 'native-refresh',
      accessTokenExpiresAt: 4_000_000,
      refreshedAt: 3_000_000,
    })
    window.__TAURI_INTERNALS__ = { invoke }
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('FoxChat Android')
    const service = new MatrixClientService()
    const session = {
      baseUrl: 'https://matrix.example.org',
      accessToken: 'web-access',
      refreshToken: 'web-refresh',
      accessTokenExpiresAt: undefined as number | undefined,
      userId: '@fox:example.org',
      deviceId: 'FOXDEVICE',
    }

    await (
      service as unknown as {
        applyNativeSessionTokens(value: typeof session): Promise<void>
      }
    ).applyNativeSessionTokens(session)

    expect(invoke).toHaveBeenCalledWith('plugin:remote-push|native_session_tokens', {
      userId: '@fox:example.org',
    })
    expect(session).toMatchObject({
      accessToken: 'native-access',
      refreshToken: 'native-refresh',
      accessTokenExpiresAt: 4_000_000,
    })
  })
})
