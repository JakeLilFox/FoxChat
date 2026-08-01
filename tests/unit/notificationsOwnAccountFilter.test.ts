// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventType } from 'matrix-js-sdk'
import { notifyMatrixEvent } from '../../src/platform/notifications'
import { matrixService } from '../../src/matrix/MatrixClientService'
import { fakeClient, fakeEvent, fakeRoom } from './support/fakeMatrix'

type ServiceInternals = {
  client?: unknown
  availableAccounts: () => Array<{ id: string; userId: string; client: unknown }>
  room: (roomId: string) => unknown
}

describe('notifyMatrixEvent own-account filtering (bug 3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const setUpService = () => {
    const room = fakeRoom({ roomId: '!room:example.org' })
    const client = fakeClient([room], '@me:example.org')
    const internals = matrixService as unknown as ServiceInternals
    internals.client = client
    internals.availableAccounts = () => [
      { id: 'me', userId: '@me:example.org', client },
      { id: 'other-own', userId: '@other-own:example.org', client },
    ]
    internals.room = () => undefined
    return { room, client }
  }

  const stubNotificationConstructor = () => {
    const notificationSpy = vi.fn(function Notification(this: unknown) {
      return this
    }) as unknown as {
      new (title: string, options?: unknown): { onclick: unknown }
      permission: string
    }
    notificationSpy.permission = 'granted'
    vi.stubGlobal('Notification', notificationSpy)

    vi.stubGlobal('Audio', function Audio(this: { play: () => Promise<void> }) {
      this.play = () => Promise.resolve()
    })
    return notificationSpy as unknown as ReturnType<typeof vi.fn>
  }

  it("does not notify for a message sent by the user's own other account", async () => {
    const { room } = setUpService()
    const notificationSpy = stubNotificationConstructor()

    const event = fakeEvent({
      id: '$own-1',
      roomId: room.roomId,
      type: EventType.RoomMessage,
      sender: '@other-own:example.org',
      ts: Date.now(),
      notify: true,
      content: { msgtype: 'm.text', body: 'hi from my other account' },
    })

    await notifyMatrixEvent(event, room)

    expect(notificationSpy).not.toHaveBeenCalled()
  })

  it('does notify for a genuine message from someone else', async () => {
    const { room } = setUpService()
    const notificationSpy = stubNotificationConstructor()

    const event = fakeEvent({
      id: '$carol-1',
      roomId: room.roomId,
      type: EventType.RoomMessage,
      sender: '@carol:example.org',
      ts: Date.now(),
      notify: true,
      content: { msgtype: 'm.text', body: 'hi' },
    })

    await notifyMatrixEvent(event, room)

    expect(notificationSpy).toHaveBeenCalled()
  })

  it('only notifies for an actual mention when the room is set to mentions only', async () => {
    const { room, client } = setUpService()
    ;(client as unknown as { getRoomPushRule: () => undefined }).getRoomPushRule = () => undefined
    const notificationSpy = stubNotificationConstructor()

    await notifyMatrixEvent(
      fakeEvent({
        id: '$ordinary-mentions-only',
        roomId: room.roomId,
        type: EventType.RoomMessage,
        sender: '@carol:example.org',
        ts: Date.now(),
        notify: true,
        content: { msgtype: 'm.text', body: 'ordinary message' },
      }),
      room,
    )

    expect(notificationSpy).not.toHaveBeenCalled()

    await notifyMatrixEvent(
      fakeEvent({
        id: '$actual-mention',
        roomId: room.roomId,
        type: EventType.RoomMessage,
        sender: '@carol:example.org',
        ts: Date.now(),
        notify: true,
        content: {
          msgtype: 'm.text',
          body: 'hello @me:example.org',
          'm.mentions': { user_ids: ['@me:example.org'] },
        },
      }),
      room,
    )

    expect(notificationSpy).toHaveBeenCalledOnce()
  })

  it('accepts mentions of any logged-in account but rejects room and unrelated mentions', async () => {
    const { room, client } = setUpService()
    ;(client as unknown as { getRoomPushRule: () => undefined }).getRoomPushRule = () => undefined
    const notificationSpy = stubNotificationConstructor()

    for (const [id, mentions] of [
      ['$unrelated-mention', { user_ids: ['@someone-else:example.org'] }],
      ['$room-mention', { room: true }],
    ] as const) {
      await notifyMatrixEvent(
        fakeEvent({
          id,
          roomId: room.roomId,
          type: EventType.RoomMessage,
          sender: '@carol:example.org',
          ts: Date.now(),
          notify: true,
          content: { msgtype: 'm.text', body: 'not for my accounts', 'm.mentions': mentions },
        }),
        room,
      )
    }
    expect(notificationSpy).not.toHaveBeenCalled()

    await notifyMatrixEvent(
      fakeEvent({
        id: '$other-own-account-mention',
        roomId: room.roomId,
        type: EventType.RoomMessage,
        sender: '@carol:example.org',
        ts: Date.now(),
        notify: true,
        content: {
          msgtype: 'm.text',
          body: 'hello @other-own:example.org',
          'm.mentions': { user_ids: ['@other-own:example.org'] },
        },
      }),
      room,
    )

    expect(notificationSpy).toHaveBeenCalledOnce()
  })
})
