// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'
import { fakeEvent, fakeRoom } from './support/fakeMatrix'

describe('local echo updates', () => {
  it('publishes a timeline-only refresh so a remote echo can be re-sorted without a duplicate event', () => {
    const localOptions = {
      id: '~local-echo',
      roomId: '!room:example.org',
      sender: '@me:example.org',
      ts: 300,
    }
    const localEcho = fakeEvent(localOptions)
    const otherEvent = fakeEvent({
      id: '$other',
      roomId: localOptions.roomId,
      sender: '@other:example.org',
      ts: 200,
    })
    Object.assign(localEcho, { getTxnId: () => undefined })
    Object.assign(otherEvent, { getTxnId: () => undefined })
    const room = fakeRoom({ roomId: localOptions.roomId, events: [otherEvent, localEcho] })
    const service = new MatrixClientService()
    const onEvent = vi.fn()
    let renderedOrder: string[] = []

    service.subscribe({
      onEvent,
      onLocalEchoUpdated: () => {
        renderedOrder = service
          .combinedRoomEvents(room, [otherEvent, localEcho])
          .map((event) => event.getId() ?? '')
      },
    })

    localOptions.id = '$remote-echo'
    localOptions.ts = 100
    ;(
      service as unknown as {
        publishLocalEchoUpdated: (
          client: MatrixClient,
          event: MatrixEvent,
          room: Room,
          oldEventId?: string,
        ) => void
      }
    ).publishLocalEchoUpdated({} as MatrixClient, localEcho, room, '~local-echo')

    expect(renderedOrder).toEqual(['$remote-echo', '$other'])
    expect(onEvent).not.toHaveBeenCalled()
  })
})
