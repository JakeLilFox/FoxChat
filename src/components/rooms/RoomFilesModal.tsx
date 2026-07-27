import { formatFileSize } from '../../lib/format'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DownloadOutlined, FileOutlined } from '@ant-design/icons'
import { App as AntApp, Button, Empty, Modal, Spin } from 'antd'
import { Attachment, EncryptedAttachment } from '@matrix-org/matrix-sdk-crypto-wasm'
import { EventType, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

function RoomFile({ event, client }: { event: MatrixEvent; client?: MatrixClient }) {
  const { message } = AntApp.useApp()
  const content = event.getContent()
  const [downloading, setDownloading] = useState(false)
  const filename = String(content.filename || content.body || 'Attachment')
  const senderId = event.getSender()
  const sender =
    (senderId
      ? event.getRoomId() && client?.getRoom(event.getRoomId())?.getMember(senderId)?.name
      : undefined) ||
    senderId ||
    'Unknown sender'
  const size = Number(content.info?.size)
  const mime = String(content.info?.mimetype || 'File')
  const download = async () => {
    if (!client || downloading) return
    const encrypted = content.file
    const uri = content.url ?? encrypted?.url
    if (!uri) {
      message.error('This file has no download address')
      return
    }
    setDownloading(true)
    try {
      const authenticated = client.mxcUrlToHttp(
        uri,
        undefined,
        undefined,
        undefined,
        false,
        true,
        true,
      )
      const legacy = client.mxcUrlToHttp(uri)
      let response: Response | undefined
      if (authenticated) {
        try {
          const candidate = await fetch(authenticated, {
            headers: client.getAccessToken()
              ? { Authorization: `Bearer ${client.getAccessToken()}` }
              : {},
          })
          if (candidate.ok) response = candidate
        } catch {
          // Try the legacy media endpoint below.
        }
      }
      if (!response && legacy) {
        const candidate = await fetch(legacy)
        if (candidate.ok) response = candidate
      }
      if (!response) throw new Error('Media download failed')
      const downloaded = await response.arrayBuffer()
      let bytes = downloaded
      if (encrypted?.url) {
        const attachment = new EncryptedAttachment(
          new Uint8Array(downloaded),
          JSON.stringify(encrypted),
        )
        const clear = Attachment.decrypt(attachment)
        attachment.free()
        bytes = clear.buffer.slice(
          clear.byteOffset,
          clear.byteOffset + clear.byteLength,
        ) as ArrayBuffer
      }
      const objectUrl = URL.createObjectURL(
        new Blob([bytes], {
          type:
            content.info?.mimetype ??
            response.headers.get('content-type') ??
            'application/octet-stream',
        }),
      )
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = filename
      link.rel = 'noreferrer'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not download file')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 10px',
        borderBottom: '1px solid var(--ant-color-border-secondary)',
      }}
    >
      <FileOutlined style={{ flex: '0 0 auto', fontSize: 24 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          title={filename}
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontWeight: 600,
          }}
        >
          {filename}
        </div>
        <div style={{ fontSize: 12, opacity: 0.65 }}>
          {sender} · {new Date(event.getTs()).toLocaleString()}
          {Number.isFinite(size) && size > 0 ? ` · ${formatFileSize(size)}` : ''}
          {mime && mime !== 'File' ? ` · ${mime}` : ''}
        </div>
      </div>
      <Button
        type="text"
        shape="circle"
        icon={<DownloadOutlined />}
        loading={downloading}
        disabled={!client}
        onClick={() => void download()}
        aria-label={`Download ${filename}`}
        title={`Download ${filename}`}
      />
    </div>
  )
}

export function RoomFilesModal({
  room,
  open,
  onClose,
}: {
  room: Room
  open: boolean
  onClose: () => void
}) {
  const client = matrixService.clientForRoomInstance(room)
  const [limit, setLimit] = useState(40)
  const [loading, setLoading] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [status, setStatus] = useState('')
  const limitRef = useRef(40)
  const exhaustedRef = useRef(false)
  const loadingRef = useRef(false)
  const fillingRef = useRef(false)
  const errorCountRef = useRef(0)
  const generationRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    generationRef.current++
    fillingRef.current = false
    loadingRef.current = false
    limitRef.current = 40
    exhaustedRef.current = false
    errorCountRef.current = 0
    setLoading(false)
    setLimit(40)
    setExhausted(false)
    setStatus('')
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [room.roomId, open])

  const roomFiles = useCallback(
    () =>
      [...room.getLiveTimeline().getEvents()].filter(
        (event) =>
          event.getType() === EventType.RoomMessage &&
          event.getContent().msgtype === 'm.file' &&
          !event.isRedacted(),
      ),
    [room],
  )
  const visible = roomFiles().reverse().slice(0, limit)

  const fill = useCallback(async () => {
    if (fillingRef.current) return
    fillingRef.current = true
    const generation = generationRef.current
    try {
      while (generationRef.current === generation) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        if (generationRef.current !== generation) return
        const target = scrollRef.current
        if (!target) continue
        const hasScrollbar = target.scrollHeight > target.clientHeight + 1
        const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 240
        if (hasScrollbar && !nearBottom) return
        if (exhaustedRef.current) return
        const current = roomFiles()
        if (current.length > limitRef.current) {
          limitRef.current += 40
          setLimit(limitRef.current)
          continue
        }
        if (loadingRef.current) return
        loadingRef.current = true
        setLoading(true)
        try {
          const before = current.length
          const hasMore = await matrixService.loadOlderMessages(room, 100)
          if (generationRef.current !== generation) return
          if (!hasMore) {
            exhaustedRef.current = true
            setExhausted(true)
            setStatus("Reached the start of this room's history")
            return
          }
          errorCountRef.current = 0
          limitRef.current += 40
          setLimit(limitRef.current)
          const after = roomFiles().length
          setStatus(`${after} loaded so far (+${after - before} that page)`)
        } catch (error) {
          console.error('[files] Could not load older room history', error)
          errorCountRef.current++
          if (errorCountRef.current > 5) {
            exhaustedRef.current = true
            if (generationRef.current === generation) {
              setExhausted(true)
              setStatus(
                `Stopped after a repeated error: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
            return
          }
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(1000 * 2 ** (errorCountRef.current - 1), 8000)),
          )
        } finally {
          loadingRef.current = false
          setLoading(false)
        }
      }
    } finally {
      fillingRef.current = false
    }
  }, [room, roomFiles])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let observer: ResizeObserver | undefined
    const attachObserver = () => {
      if (cancelled || observer) return
      const target = scrollRef.current
      if (!target) {
        requestAnimationFrame(attachObserver)
        return
      }
      observer = new ResizeObserver(() => void fill())
      observer.observe(target)
    }
    attachObserver()
    void fill()
    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [open, fill])

  return (
    <Modal
      title={`${room.name} · Shared files`}
      open={open}
      footer={null}
      width={620}
      onCancel={onClose}
      destroyOnHidden
      styles={{ body: { padding: 8 } }}
    >
      <div
        ref={scrollRef}
        style={{
          maxHeight: '72dvh',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
        }}
        onScroll={(event) => {
          const target = event.currentTarget
          if (target.scrollHeight - target.scrollTop - target.clientHeight < 240) {
            void fill()
          }
        }}
      >
        {visible.map((event) => (
          <RoomFile key={event.getId() ?? event.getTs()} event={event} client={client} />
        ))}
        {loading && (
          <div style={{ display: 'grid', placeItems: 'center', padding: 20 }}>
            <Spin />
          </div>
        )}
        {!visible.length && !loading && exhausted && (
          <Empty description="No files shared in this room yet" />
        )}
        {status && (
          <div
            style={{
              textAlign: 'center',
              padding: '6px 4px 2px',
              fontSize: 11,
              opacity: 0.55,
            }}
          >
            {status}
          </div>
        )}
      </div>
    </Modal>
  )
}
