import { EventType, type MatrixEvent } from 'matrix-js-sdk'

export const GALLERY_EVENT_FIELD = 'foxchat.gallery'
export const GALLERY_MAX_IMAGES = 5

const fallbackGalleryId = () =>
  `foxchat-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`

export const createGalleryId = () => globalThis.crypto?.randomUUID?.() ?? fallbackGalleryId()

export const assignGalleryIds = <T>(
  items: readonly T[],
  isImage: (item: T) => boolean,
  makeId: () => string = createGalleryId,
) => {
  const images = items.filter(isImage)
  const assignments = new Map<T, string>()
  if (images.length < 2) return assignments

  for (let index = 0; index < images.length; index += GALLERY_MAX_IMAGES) {
    const galleryId = makeId()
    for (const image of images.slice(index, index + GALLERY_MAX_IMAGES))
      assignments.set(image, galleryId)
  }
  return assignments
}

export const eventGalleryId = (event: MatrixEvent) => {
  if (
    event.getType() !== EventType.RoomMessage ||
    event.getContent().msgtype !== 'm.image' ||
    event.isRedacted()
  )
    return undefined
  const value = event.getContent()[GALLERY_EVENT_FIELD]
  return typeof value === 'string' && value.trim() ? value : undefined
}

export type GalleryTimelineItem = {
  event: MatrixEvent
  gallery?: MatrixEvent[]
}

export const galleryTimelineItems = (events: readonly MatrixEvent[]): GalleryTimelineItem[] => {
  const chunks = new Map<string, MatrixEvent[][]>()
  const eventChunk = new Map<MatrixEvent, MatrixEvent[]>()

  for (const event of events) {
    const galleryId = eventGalleryId(event)
    if (!galleryId) continue
    const key = `${event.getSender() ?? ''}\u0000${galleryId}`
    const galleryChunks = chunks.get(key) ?? []
    let chunk = galleryChunks.at(-1)
    if (!chunk || chunk.length >= GALLERY_MAX_IMAGES) {
      chunk = []
      galleryChunks.push(chunk)
      chunks.set(key, galleryChunks)
    }
    chunk.push(event)
    eventChunk.set(event, chunk)
  }

  return events.flatMap((event) => {
    const chunk = eventChunk.get(event)
    if (!chunk || chunk.length < 2) return [{ event }]
    return chunk[0] === event ? [{ event, gallery: chunk }] : []
  })
}
