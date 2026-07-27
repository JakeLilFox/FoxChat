import { RoomGalleryModal } from './RoomGalleryModal'
import { RoomFilesModal } from './RoomFilesModal'
import { RoomLinksModal } from './RoomLinksModal'
import { type RoomModalView } from '../../lib/urlState'
import { Room } from 'matrix-js-sdk'

export function RoomInfoModals({
  room,
  view,
  onView,
}: {
  room: Room
  view?: RoomModalView
  onView: (view?: RoomModalView) => void
}) {
  return (
    <>
      <RoomGalleryModal room={room} open={view === 'gallery'} onClose={() => onView(undefined)} />
      <RoomLinksModal room={room} open={view === 'links'} onClose={() => onView(undefined)} />
      <RoomFilesModal room={room} open={view === 'files'} onClose={() => onView(undefined)} />
    </>
  )
}
