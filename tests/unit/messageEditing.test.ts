// @vitest-environment jsdom

import { EventType, MatrixEvent, type MatrixClient } from 'matrix-js-sdk'
import { describe, expect, it, vi } from 'vitest'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'

const ROOM_ID = '!room:example.org'
const EVENT_ID = '$original'
const TXN_ID = 'edit-transaction'

describe('message editing', () => {
  it('applies the accepted local replacement even when its device timestamp is older', async () => {
    const target = new MatrixEvent({
      event_id: EVENT_ID,
      room_id: ROOM_ID,
      sender: '@alice:example.org',
      origin_server_ts: 2_000,
      type: EventType.RoomMessage,
      content: { msgtype: 'm.text', body: 'First edit' },
    })
    const previousReplacement = new MatrixEvent({
      event_id: '$first-edit',
      room_id: ROOM_ID,
      sender: '@alice:example.org',
      origin_server_ts: 4_000,
      type: EventType.RoomMessage,
      content: {
        msgtype: 'm.text',
        body: '* First edit',
        'm.new_content': { msgtype: 'm.text', body: 'First edit' },
        'm.relates_to': { rel_type: 'm.replace', event_id: EVENT_ID },
      },
    })
    const nextReplacement = new MatrixEvent({
      event_id: '~local-edit',
      room_id: ROOM_ID,
      sender: '@alice:example.org',
      origin_server_ts: 3_000,
      type: EventType.RoomMessage,
      content: {
        msgtype: 'm.text',
        body: '* Second edit',
        'm.new_content': { msgtype: 'm.text', body: 'Second edit' },
        'm.relates_to': { rel_type: 'm.replace', event_id: EVENT_ID },
      },
    })
    target.makeReplaced(previousReplacement)

    const room = {
      hasEncryptionStateEvent: () => false,
      getEventForTxnId: (txnId: string) => (txnId === TXN_ID ? nextReplacement : undefined),
    }
    const sendEvent = vi.fn().mockResolvedValue({ event_id: '$second-edit' })
    const client = {
      makeTxnId: () => TXN_ID,
      getRoom: () => room,
      sendEvent,
    } as unknown as MatrixClient
    const service = new MatrixClientService()
    const onEvent = vi.fn()
    service.subscribe({ onEvent })
    const internals = service as unknown as {
      roomAccounts: () => Array<{ userId: string; client: MatrixClient }>
    }
    internals.roomAccounts = () => [{ userId: '@alice:example.org', client }]

    await service.editMessage(target, 'Second edit')

    expect(sendEvent).toHaveBeenCalledWith(
      ROOM_ID,
      EventType.RoomMessage,
      {
        msgtype: 'm.text',
        body: '* Second edit',
        'm.new_content': { msgtype: 'm.text', body: 'Second edit' },
        'm.relates_to': { rel_type: 'm.replace', event_id: EVENT_ID },
      },
      TXN_ID,
    )
    expect(target.replacingEvent()).toBe(nextReplacement)
    expect(target.getContent().body).toBe('Second edit')
    expect(onEvent).toHaveBeenCalledWith(target, room)
  })

  it('resolves to the true original when handed a previous edit event, instead of chaining onto it', async () => {
    const original = new MatrixEvent({
      event_id: EVENT_ID,
      room_id: ROOM_ID,
      sender: '@alice:example.org',
      origin_server_ts: 1_000,
      type: EventType.RoomMessage,
      content: { msgtype: 'm.text', body: 'Original' },
    })
    const firstEdit = new MatrixEvent({
      event_id: '$first-edit',
      room_id: ROOM_ID,
      sender: '@alice:example.org',
      origin_server_ts: 2_000,
      type: EventType.RoomMessage,
      content: {
        msgtype: 'm.text',
        body: '* First edit',
        'm.new_content': { msgtype: 'm.text', body: 'First edit' },
        'm.relates_to': { rel_type: 'm.replace', event_id: EVENT_ID },
      },
    })
    original.makeReplaced(firstEdit)

    const secondEditLocalEcho = new MatrixEvent({
      event_id: '~local-second-edit',
      room_id: ROOM_ID,
      sender: '@alice:example.org',
      origin_server_ts: 3_000,
      type: EventType.RoomMessage,
      content: {
        msgtype: 'm.text',
        body: '* Second edit',
        'm.new_content': { msgtype: 'm.text', body: 'Second edit' },
        'm.relates_to': { rel_type: 'm.replace', event_id: EVENT_ID },
      },
    })

    const room = {
      hasEncryptionStateEvent: () => false,
      getEventForTxnId: (txnId: string) => (txnId === TXN_ID ? secondEditLocalEcho : undefined),
      findEventById: (id: string) =>
        id === EVENT_ID ? original : id === '$first-edit' ? firstEdit : undefined,
    }
    const sendEvent = vi.fn().mockResolvedValue({ event_id: '$second-edit' })
    const client = {
      makeTxnId: () => TXN_ID,
      getRoom: () => room,
      sendEvent,
    } as unknown as MatrixClient
    const service = new MatrixClientService()
    const onEvent = vi.fn()
    service.subscribe({ onEvent })
    const internals = service as unknown as {
      roomAccounts: () => Array<{ userId: string; client: MatrixClient }>
    }
    internals.roomAccounts = () => [{ userId: '@alice:example.org', client }]

    // Pass the previous edit event itself (e.g. what a "last message" scan that doesn't
    // exclude m.replace relations could pick), not the true original.
    await service.editMessage(firstEdit, 'Second edit')

    expect(sendEvent).toHaveBeenCalledWith(
      ROOM_ID,
      EventType.RoomMessage,
      {
        msgtype: 'm.text',
        body: '* Second edit',
        'm.new_content': { msgtype: 'm.text', body: 'Second edit' },
        'm.relates_to': { rel_type: 'm.replace', event_id: EVENT_ID },
      },
      TXN_ID,
    )
    expect(original.replacingEvent()).toBe(secondEditLocalEcho)
    expect(original.getContent().body).toBe('Second edit')
    expect(onEvent).toHaveBeenCalledWith(original, room)
  })
})
