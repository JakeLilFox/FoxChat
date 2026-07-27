import { GalleryImage } from '../media'
import { GalleryGrid } from '../../styles'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Empty, Modal, Spin } from 'antd'
import { EventType, Room } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

export function RoomGalleryModal({
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
  const roomImages = useCallback(
    () =>
      [...room.getLiveTimeline().getEvents()].filter(
        (event) =>
          event.getType() === EventType.RoomMessage &&
          event.getContent().msgtype === 'm.image' &&
          !event.isRedacted(),
      ),
    [room],
  )
  const images = roomImages().reverse()
  const visible = images.slice(0, limit)
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
        const current = roomImages()
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
          const after = roomImages().length
          setStatus(`${after} loaded so far (+${after - before} that page)`)
        } catch (error) {
          console.error('[gallery] Could not load older room history', error)
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
  }, [room, roomImages])
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
      title={`${room.name} · Gallery`}
      open={open}
      footer={null}
      width={820}
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
          const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 240
          if (nearBottom) void fill()
        }}
      >
        <GalleryGrid>
          {visible.map((event) => (
            <GalleryImage key={event.getId() ?? event.getTs()} event={event} client={client} />
          ))}
          {loading && (
            <div className="galleryLoading">
              <Spin />
            </div>
          )}
          {!visible.length && !loading && exhausted && (
            <Empty description="No pictures in this room yet" />
          )}
        </GalleryGrid>
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
