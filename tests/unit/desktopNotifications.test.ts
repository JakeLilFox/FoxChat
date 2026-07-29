// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventType } from 'matrix-js-sdk'
import {
  listenForNotificationNavigation,
  notifyMatrixEvent,
} from '../../src/platform/notifications'
import { matrixService } from '../../src/matrix/MatrixClientService'
import { fakeClient, fakeEvent, fakeRoom } from './support/fakeMatrix'

type ServiceInternals = {
  client?: unknown
  availableAccounts: () => Array<{ id: string; userId: string; client: unknown }>
  room: (roomId: string) => unknown
}

describe('desktop notifications', () => {
  afterEach(() => {
    vi.useRealTimers()
    delete window.__TAURI__
    delete (window as typeof window & { __foxchatPendingNotificationRoom?: string })
      .__foxchatPendingNotificationRoom
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    history.replaceState({}, '', '/')
  })

  it('uses the clickable native command and plays the packaged sound', async () => {
    const room = fakeRoom({ roomId: '!desktop:example.org', name: 'Desktop room' })
    const client = fakeClient([room], '@me:example.org')
    const internals = matrixService as unknown as ServiceInternals
    internals.client = client
    internals.availableAccounts = () => [{ id: 'me', userId: '@me:example.org', client }]
    internals.room = () => undefined

    const invoke = vi.fn(async (command: string) => {
      if (command === 'plugin:notification|is_permission_granted') return true
      if (command === 'show_desktop_notification') return undefined
      throw new Error(`Unexpected command: ${command}`)
    })
    window.__TAURI__ = {
      core: {
        invoke: invoke as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
      },
    }
    const play = vi.fn(() => Promise.resolve())
    const audio = vi.fn(function Audio(this: { play: () => Promise<void> }, source: string) {
      expect(source).toBe('/notification.ogg')
      this.play = play
    })
    vi.stubGlobal('Audio', audio)

    await notifyMatrixEvent(
      fakeEvent({
        id: '$desktop-notification',
        roomId: room.roomId,
        type: EventType.RoomMessage,
        sender: '@carol:example.org',
        ts: Date.now(),
        notify: true,
        content: { msgtype: 'm.text', body: 'Open this room' },
      }),
      room,
    )

    expect(invoke).toHaveBeenCalledWith('show_desktop_notification', {
      title: '@carol:example.org in Desktop room',
      body: 'Open this room',
      roomId: room.roomId,
    })
    expect(audio).toHaveBeenCalledOnce()
    expect(play).toHaveBeenCalledOnce()
  })

  it('waits for late message keys before showing an encrypted notification', async () => {
    const room = fakeRoom({ roomId: '!encrypted:example.org', name: 'Encrypted room' })
    const client = fakeClient([room], '@me:example.org')
    const internals = matrixService as unknown as ServiceInternals
    internals.client = client
    internals.availableAccounts = () => [{ id: 'me', userId: '@me:example.org', client }]
    internals.room = () => undefined

    const invoke = vi.fn(async (command: string) => {
      if (command === 'plugin:notification|is_permission_granted') return true
      if (command === 'show_desktop_notification') return undefined
      throw new Error(`Unexpected command: ${command}`)
    })
    window.__TAURI__ = {
      core: {
        invoke: invoke as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
      },
    }
    vi.stubGlobal('Audio', function Audio(this: { play: () => Promise<void> }) {
      this.play = () => Promise.resolve()
    })
    vi.spyOn(matrixService, 'retryEventDecryption').mockResolvedValue(true)

    const content = {
      msgtype: 'm.bad.encrypted',
      body: 'Unable to decrypt: the sender has not sent us the keys',
    }
    let failed = true
    let decryptedListener: (() => void) | undefined
    const event = fakeEvent({
      id: '$late-decryption',
      roomId: room.roomId,
      type: EventType.RoomMessage,
      sender: '@carol:example.org',
      ts: Date.now(),
      notify: true,
      content,
    })
    Object.assign(event, {
      isDecryptionFailure: () => failed,
      on: (_event: unknown, listener: () => void) => {
        decryptedListener = listener
      },
      off: vi.fn(),
    })

    const notification = notifyMatrixEvent(event, room)
    await vi.waitFor(() => expect(matrixService.retryEventDecryption).toHaveBeenCalledWith(event))
    expect(invoke).not.toHaveBeenCalled()

    failed = false
    content.msgtype = 'm.text'
    content.body = 'Keys arrived in time'
    decryptedListener?.()
    await notification

    expect(invoke).toHaveBeenCalledWith('show_desktop_notification', {
      title: '@carol:example.org in Encrypted room',
      body: 'Keys arrived in time',
      roomId: room.roomId,
    })
  })

  it('uses a neutral fallback when message keys remain unavailable', async () => {
    vi.useFakeTimers()
    const room = fakeRoom({ roomId: '!missing-keys:example.org', name: 'Encrypted room' })
    const client = fakeClient([room], '@me:example.org')
    const internals = matrixService as unknown as ServiceInternals
    internals.client = client
    internals.availableAccounts = () => [{ id: 'me', userId: '@me:example.org', client }]
    internals.room = () => undefined

    const invoke = vi.fn(async (command: string) => {
      if (command === 'plugin:notification|is_permission_granted') return true
      if (command === 'show_desktop_notification') return undefined
      throw new Error(`Unexpected command: ${command}`)
    })
    window.__TAURI__ = {
      core: {
        invoke: invoke as <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
      },
    }
    vi.stubGlobal('Audio', function Audio(this: { play: () => Promise<void> }) {
      this.play = () => Promise.resolve()
    })
    vi.spyOn(matrixService, 'retryEventDecryption').mockResolvedValue(false)

    const event = fakeEvent({
      id: '$missing-keys',
      roomId: room.roomId,
      type: EventType.RoomMessage,
      sender: '@carol:example.org',
      ts: Date.now(),
      notify: true,
      content: {
        msgtype: 'm.bad.encrypted',
        body: 'Unable to decrypt: the sender has not sent us the keys',
      },
    })
    Object.assign(event, {
      isDecryptionFailure: () => true,
      on: vi.fn(),
      off: vi.fn(),
    })

    const notification = notifyMatrixEvent(event, room)
    await vi.advanceTimersByTimeAsync(5_000)
    await notification

    expect(invoke).toHaveBeenCalledWith('show_desktop_notification', {
      title: '@carol:example.org in Encrypted room',
      body: 'New encrypted message',
      roomId: room.roomId,
    })
  })

  it('opens the notified room and clears stale navigation state on activation', () => {
    history.replaceState(
      {},
      '',
      '/?room=%21old%3Aexample.org&space=%21space%3Aexample.org&roomModal=files&drawerOpen=true',
    )
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined)
    const stop = listenForNotificationNavigation()
    ;(
      window as typeof window & {
        __foxchatPendingNotificationRoom?: string
      }
    ).__foxchatPendingNotificationRoom = '!new:example.org'

    window.dispatchEvent(
      new CustomEvent('foxchat-notification-open', { detail: '!new:example.org' }),
    )

    const url = new URL(window.location.href)
    expect(url.searchParams.get('room')).toBe('!new:example.org')
    expect(url.searchParams.has('space')).toBe(false)
    expect(url.searchParams.has('roomModal')).toBe(false)
    expect(url.searchParams.has('drawerOpen')).toBe(false)
    expect(focus).toHaveBeenCalledOnce()
    expect(
      (window as typeof window & { __foxchatPendingNotificationRoom?: string })
        .__foxchatPendingNotificationRoom,
    ).toBeUndefined()
    stop()
  })
})
