// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { EventStatus, MatrixEvent } from 'matrix-js-sdk'
import { useMatrixEventStatus } from '../../src/lib/hooks'

const roots: Array<ReturnType<typeof createRoot>> = []

function Status({ event }: { event: MatrixEvent }) {
  return <span>{useMatrixEventStatus(event) ?? 'remote'}</span>
}

afterEach(() => {
  while (roots.length) act(() => roots.pop()?.unmount())
})

describe('useMatrixEventStatus', () => {
  it('rerenders when a local echo becomes a remote echo', () => {
    const event = new MatrixEvent({
      event_id: '~local',
      room_id: '!room:example.org',
      sender: '@me:example.org',
      type: 'm.room.message',
      content: { msgtype: 'm.text', body: 'Hello' },
    })
    event.setStatus(EventStatus.SENDING)
    const container = document.createElement('div')
    const root = createRoot(container)
    roots.push(root)

    act(() => root.render(<Status event={event} />))
    expect(container.textContent).toBe(EventStatus.SENDING)

    act(() => event.setStatus(null))
    expect(container.textContent).toBe('remote')
  })
})
