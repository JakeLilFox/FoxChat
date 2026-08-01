import { Message } from '../message'
import { eventBody } from '../../lib/eventHelpers'
import { openThreadUrl } from '../../lib/urlState'
import { ThreadComposer, ThreadDrawerHead, ThreadListItem, ThreadPanelBox } from '../../styles'
import { useEffect, useState } from 'react'
import { Button, Drawer, Empty, Input, App as AntApp } from 'antd'
import { ArrowLeftOutlined, CloseOutlined, SendOutlined } from '@ant-design/icons'
import { type Room, type Thread, ThreadEvent } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

function ThreadRow({ thread, onOpen }: { thread: Thread; onOpen: () => void }) {
  const [, render] = useState(0)
  useEffect(() => {
    const refresh = () => render((x) => x + 1)
    thread.on(ThreadEvent.Update, refresh)
    thread.on(ThreadEvent.NewReply, refresh)
    return () => {
      thread.off(ThreadEvent.Update, refresh)
      thread.off(ThreadEvent.NewReply, refresh)
    }
  }, [thread])
  const replies = Math.max(0, thread.events.length - 1)
  const last = thread.events.at(-1) ?? thread.rootEvent
  return (
    <ThreadListItem type="button" onClick={onOpen}>
      <div className="root">{eventBody(thread.rootEvent)}</div>
      <div className="meta">
        {replies} repl{replies === 1 ? 'y' : 'ies'}
        {last && ` · ${last.sender?.name || last.getSender()}`}
      </div>
    </ThreadListItem>
  )
}

function ThreadReplyPanel({
  room,
  threadRootId,
  revision,
  onBack,
}: {
  room: Room
  threadRootId: string
  revision?: number | string
  onBack: () => void
}) {
  const { message } = AntApp.useApp()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [, render] = useState(0)
  const thread = room.getThread(threadRootId) ?? undefined
  useEffect(() => {
    if (!thread) return
    const refresh = () => render((x) => x + 1)
    thread.on(ThreadEvent.Update, refresh)
    thread.on(ThreadEvent.NewReply, refresh)
    return () => {
      thread.off(ThreadEvent.Update, refresh)
      thread.off(ThreadEvent.NewReply, refresh)
    }
  }, [thread])
  const rootEvent = thread?.rootEvent ?? room.findEventById(threadRootId)
  const replies = thread?.events.filter((event) => event.getId() !== rootEvent?.getId()) ?? []

  const send = async () => {
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    try {
      const accountId = matrixService.selectedRoomAccountId(room.roomId)
      if (!accountId) throw new Error('No account available')
      await matrixService.sendThreadReply(room.roomId, accountId, threadRootId, body)
      setDraft('')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not send reply')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ThreadPanelBox>
      <div className="head">
        <button type="button" onClick={onBack} aria-label="Back to threads">
          <ArrowLeftOutlined />
        </button>
        <b>Thread</b>
      </div>
      <div className="body">
        {rootEvent && <Message event={rootEvent} revision={revision} />}
        {replies.map((event) => (
          <Message key={event.getId()} event={event} revision={revision} />
        ))}
      </div>
      <ThreadComposer>
        <Input.TextArea
          autoFocus
          autoSize={{ minRows: 1, maxRows: 5 }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder="Reply in thread"
        />
        <Button
          type="primary"
          shape="circle"
          icon={<SendOutlined />}
          loading={busy}
          onClick={() => void send()}
        />
      </ThreadComposer>
    </ThreadPanelBox>
  )
}

export function ThreadHost({
  room,
  view,
  revision,
  onClose,
}: {
  room?: Room
  view?: string
  revision?: number | string
  onClose: () => void
}) {
  if (!room || !view) return null
  const threads = matrixService.roomThreads(room)
  return (
    <Drawer open placement="right" width={380} closable={false} onClose={onClose}>
      {view === 'list' ? (
        <>
          <ThreadDrawerHead>
            <b>Threads</b>
            <button type="button" onClick={onClose} aria-label="Close threads">
              <CloseOutlined />
            </button>
          </ThreadDrawerHead>
          {threads.length ? (
            threads.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} onOpen={() => openThreadUrl(thread.id)} />
            ))
          ) : (
            <Empty description="No threads yet" />
          )}
        </>
      ) : (
        <ThreadReplyPanel
          room={room}
          threadRootId={view}
          revision={revision}
          onBack={() => openThreadUrl('list')}
        />
      )}
    </Drawer>
  )
}
