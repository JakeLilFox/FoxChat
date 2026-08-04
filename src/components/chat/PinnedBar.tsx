import { eventBody } from '../../lib/eventHelpers'
import { PinnedBar as PinnedBarBox, PinnedListItem } from '../../styles'
import { useEffect, useRef, useState } from 'react'
import { Popover, App as AntApp } from 'antd'
import { CloseOutlined, DownOutlined, PushpinOutlined } from '@ant-design/icons'
import { EventType, MatrixEvent, Room } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

const jumpToEvent = (roomId: string, eventId: string) => {
  window.dispatchEvent(new CustomEvent('foxchat-jump-to-event', { detail: { eventId, roomId } }))
}

export function PinnedBar({ room }: { room: Room }) {
  const { message } = AntApp.useApp()
  const client = matrixService.clientForRoomInstance(room)
  const userId = client?.getUserId()
  const canPin =
    !!userId && room.currentState.maySendStateEvent(EventType.RoomPinnedEvents, userId) === true
  const pinnedIds =
    room.currentState
      .getStateEvents(EventType.RoomPinnedEvents, '')
      ?.getContent<{ pinned?: string[] }>()?.pinned ?? []
  const pinnedKey = pinnedIds.join(',')
  const [resolved, setResolved] = useState<Map<string, MatrixEvent | null>>(() => new Map())
  const resolvedRef = useRef(resolved)
  resolvedRef.current = resolved
  const [index, setIndex] = useState(0)
  const [listOpen, setListOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    setIndex(0)
  }, [pinnedKey])
  useEffect(
    () =>
      matrixService.subscribe({
        onEvent: (_event, changedRoom) => {
          if (changedRoom?.roomId === room.roomId) setRevision((value) => value + 1)
        },
      }),
    [room],
  )
  useEffect(() => {
    let cancelled = false
    for (const id of pinnedKey ? pinnedKey.split(',') : []) {
      if (resolvedRef.current.has(id)) continue
      const local = room.findEventById(id)
      if (local) {
        setResolved((current) => new Map(current).set(id, local))
        continue
      }
      void matrixService.loadReplyEvent(room.roomId, id).then((value) => {
        if (!cancelled) setResolved((current) => new Map(current).set(id, value ?? null))
      })
    }
    return () => {
      cancelled = true
    }
  }, [room, pinnedKey, revision])
  if (!pinnedIds.length) return null
  const currentId = pinnedIds[index % pinnedIds.length]!
  const currentEvent = resolved.get(currentId)
  const advance = () => {
    jumpToEvent(room.roomId, currentId)
    setIndex((value) => (value + 1) % pinnedIds.length)
  }
  const unpin = async (id: string) => {
    const target = resolved.get(id) ?? room.findEventById(id)
    if (!target) return
    try {
      await matrixService.setPinned(target, false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not unpin message')
    }
  }
  const previewFor = (evt: MatrixEvent | null | undefined) =>
    evt ? eventBody(evt) : evt === null ? 'Message unavailable' : 'Loading…'
  const list = (
    <div>
      {pinnedIds.map((id) => {
        const evt = resolved.get(id)
        return (
          <PinnedListItem key={id}>
            <button
              type="button"
              className="jump"
              onClick={() => {
                setListOpen(false)
                jumpToEvent(room.roomId, id)
              }}
            >
              <span className="pinAuthor">
                {evt ? evt.sender?.name || evt.getSender() : 'Pinned message'}
              </span>
              <span className="pinSnippet">{previewFor(evt)}</span>
            </button>
            {canPin && (
              <button
                type="button"
                className="unpin"
                aria-label="Unpin message"
                onClick={() => void unpin(id)}
              >
                <CloseOutlined />
              </button>
            )}
          </PinnedListItem>
        )
      })}
    </div>
  )
  return (
    <PinnedBarBox>
      <PushpinOutlined className="pinIcon" />
      <button type="button" className="pinPreview" onClick={advance} title="Jump to pinned message">
        <span className="pinLabel">
          Pinned message
          {pinnedIds.length > 1 ? ` · ${(index % pinnedIds.length) + 1}/${pinnedIds.length}` : ''}
        </span>
        <span className="pinBody">{previewFor(currentEvent)}</span>
      </button>
      <div className="pinActions">
        {pinnedIds.length > 1 && (
          <Popover
            content={list}
            trigger="click"
            open={listOpen}
            onOpenChange={setListOpen}
            placement="bottomRight"
          >
            <button type="button" aria-label="Show all pinned messages">
              <DownOutlined />
            </button>
          </Popover>
        )}
        {canPin && (
          <button type="button" aria-label="Unpin message" onClick={() => void unpin(currentId)}>
            <CloseOutlined />
          </button>
        )}
      </div>
    </PinnedBarBox>
  )
}
