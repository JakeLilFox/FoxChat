import { roomIdFromUrl } from '../../lib/urlState'
import { showUserProfile } from '../../lib/userProfile'
import { UserProfileAnchor } from '../../styles'
import { Room } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

export function UserProfileTrigger({
  userId,
  name,
  avatarUrl,
  room,
  block = false,
  hover = false,
  children,
}: {
  userId: string
  name?: string
  avatarUrl?: string
  room?: Room
  block?: boolean
  hover?: boolean
  children: React.ReactNode
}) {
  return (
    <UserProfileAnchor
      $block={block}
      role="button"
      tabIndex={0}
      onMouseEnter={(event) => {
        if (hover && window.matchMedia('(hover:hover)').matches)
          showUserProfile(userId, event.currentTarget, name, avatarUrl)
      }}
      onClick={(event) => {
        event.stopPropagation()
        showUserProfile(userId, event.currentTarget, name, avatarUrl)
      }}
      onContextMenu={(event) => {
        const targetRoom = room ?? matrixService.room(roomIdFromUrl() ?? '')
        if (!targetRoom) return
        event.preventDefault()
        event.stopPropagation()
        window.dispatchEvent(
          new CustomEvent('foxchat-assign-role', {
            detail: {
              userId,
              name,
              avatarUrl,
              room: targetRoom,
              x: event.clientX,
              y: event.clientY,
            },
          }),
        )
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          showUserProfile(userId, event.currentTarget, name, avatarUrl)
        }
      }}
    >
      {children}
    </UserProfileAnchor>
  )
}
