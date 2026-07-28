// @vitest-environment jsdom

import { EventType, type MatrixClient } from 'matrix-js-sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  assignGalleryIds,
  GALLERY_EVENT_FIELD,
  GALLERY_MAX_IMAGES,
  galleryTimelineItems,
} from '../../src/lib/gallery'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'
import { fakeEvent } from './support/fakeMatrix'

describe('message galleries', () => {
  it('assigns one UUID per five images while retaining a marker on a lone final chunk', () => {
    const images = Array.from({ length: 6 }, (_, index) => ({ index, image: true }))
    const ids = ['gallery-one', 'gallery-two']
    const assignments = assignGalleryIds(
      images,
      (item) => item.image,
      () => ids.shift()!,
    )

    expect(GALLERY_MAX_IMAGES).toBe(5)
    expect(images.slice(0, 5).map((image) => assignments.get(image))).toEqual(
      Array(5).fill('gallery-one'),
    )
    expect(assignments.get(images[5])).toBe('gallery-two')
  })

  it('does not add gallery metadata to a single-image upload', () => {
    const image = { image: true }
    expect(assignGalleryIds([image], (item) => item.image).size).toBe(0)
  })

  it('groups marked image events defensively in chunks of at most five', () => {
    const events = Array.from({ length: 6 }, (_, index) =>
      fakeEvent({
        id: `$image-${index}`,
        roomId: '!gallery:example.org',
        sender: '@alice:example.org',
        ts: index,
        content: {
          msgtype: 'm.image',
          body: `${index}.png`,
          [GALLERY_EVENT_FIELD]: 'shared-gallery',
        },
      }),
    )

    const rendered = galleryTimelineItems(events)
    expect(rendered).toHaveLength(2)
    expect(rendered[0].gallery).toEqual(events.slice(0, 5))
    expect(rendered[1]).toEqual({ event: events[5] })
  })

  it('sends one normal image event with the gallery marker', async () => {
    const sendEvent = vi.fn().mockResolvedValue({ event_id: '$image' })
    const client = {
      getRoom: () => ({ hasEncryptionStateEvent: () => false }),
      uploadContent: vi.fn().mockResolvedValue({ content_uri: 'mxc://example.org/image' }),
      sendEvent,
    } as unknown as MatrixClient
    const service = new MatrixClientService()
    const internals = service as unknown as {
      clientForRoomAccount: () => MatrixClient
    }
    internals.clientForRoomAccount = () => client
    const image = new File(['image'], 'gallery.png', { type: 'image/png' })

    await service.sendFile(
      '!gallery:example.org',
      image,
      'txn',
      undefined,
      undefined,
      false,
      undefined,
      'gallery-id',
    )

    expect(sendEvent).toHaveBeenCalledTimes(1)
    expect(sendEvent).toHaveBeenCalledWith(
      '!gallery:example.org',
      EventType.RoomMessage,
      expect.objectContaining({
        msgtype: 'm.image',
        body: 'gallery.png',
        url: 'mxc://example.org/image',
        [GALLERY_EVENT_FIELD]: 'gallery-id',
      }),
      'txn',
    )
  })
})
