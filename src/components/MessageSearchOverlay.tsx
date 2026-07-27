import { eventBody } from '../lib/eventHelpers'
import { clearSearchUrl, type SearchScope } from '../lib/urlState'
import { SearchResultsList } from '../styles'
import { useEffect, useRef, useState } from 'react'
import { Empty, Input, Modal, Spin, App as AntApp } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { type ISearchResults, type SearchResult } from 'matrix-js-sdk'
import { matrixService } from '../matrix/MatrixClientService'

export function MessageSearchOverlay({
  open,
  scope,
  roomId,
  accountId,
  onClose,
}: {
  open: boolean
  scope: SearchScope
  roomId?: string
  accountId?: string
  onClose: () => void
}) {
  const { message } = AntApp.useApp()
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<ISearchResults>()
  const [loading, setLoading] = useState(false)
  const generationRef = useRef(0)

  useEffect(() => {
    if (!open) {
      setTerm('')
      setResults(undefined)
    }
  }, [open])

  useEffect(() => {
    if (!open || !accountId || !term.trim()) {
      setResults(undefined)
      return
    }
    const timer = window.setTimeout(async () => {
      generationRef.current++
      const generation = generationRef.current
      setLoading(true)
      try {
        const response = await matrixService.searchMessages(
          accountId,
          term.trim(),
          scope === 'room' ? roomId : undefined,
        )
        if (generationRef.current === generation) setResults(response)
      } catch (error) {
        message.error(error instanceof Error ? error.message : 'Search failed')
      } finally {
        if (generationRef.current === generation) setLoading(false)
      }
    }, 350)
    return () => window.clearTimeout(timer)
  }, [open, term, accountId, scope, roomId, message])

  const loadMore = async () => {
    if (!accountId || !results?.next_batch || loading) return
    setLoading(true)
    try {
      const next = await matrixService.searchMore(accountId, results)
      setResults({ ...next })
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not load more results')
    } finally {
      setLoading(false)
    }
  }

  const openResult = (result: SearchResult) => {
    const event = result.context.ourEvent
    const targetRoomId = event.getRoomId()
    const eventId = event.getId()
    if (!targetRoomId || !eventId) return
    clearSearchUrl()
    window.dispatchEvent(new CustomEvent('foxchat-open-room', { detail: targetRoomId }))
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('foxchat-jump-to-event', {
          detail: { eventId, roomId: targetRoomId },
        }),
      )
    }, 260)
  }

  return (
    <Modal
      title={scope === 'room' ? 'Search this room' : 'Search all messages'}
      open={open}
      footer={null}
      onCancel={onClose}
    >
      <Input
        autoFocus
        allowClear
        prefix={<SearchOutlined />}
        placeholder="Search messages"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      <SearchResultsList
        onScroll={(event) => {
          const target = event.currentTarget
          if (target.scrollHeight - target.scrollTop - target.clientHeight < 160) void loadMore()
        }}
      >
        {(results?.results ?? []).map((result) => {
          const event = result.context.ourEvent
          const eventRoomId = event.getRoomId()
          const eventRoom = eventRoomId
            ? matrixService.clientForRoom(eventRoomId)?.getRoom(eventRoomId)
            : undefined
          return (
            <button
              key={event.getId()}
              type="button"
              className="item"
              onClick={() => openResult(result)}
            >
              <div className="sender">
                {event.sender?.name || event.getSender()}
                {scope === 'all' && eventRoom && <span className="room"> · {eventRoom.name}</span>}
              </div>
              <div className="body">{eventBody(event)}</div>
              <div className="ts">{new Date(event.getTs()).toLocaleString()}</div>
            </button>
          )
        })}
        {!loading && term.trim() && !results?.results.length && (
          <Empty description="No messages found" />
        )}
        {loading && (
          <div style={{ textAlign: 'center', padding: 16 }}>
            <Spin size="small" />
          </div>
        )}
      </SearchResultsList>
    </Modal>
  )
}
