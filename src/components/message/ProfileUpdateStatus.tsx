import { isAvatarChange, isDisplayNameChange } from '../../lib/eventHelpers'
import { MembershipLine } from '../../styles'
import { MatrixEvent } from 'matrix-js-sdk'

export function ProfileUpdateStatus({
  event,
  showDisplayName,
  showAvatar,
}: {
  event: MatrixEvent
  showDisplayName: boolean
  showAvatar: boolean
}) {
  const nameChanged = showDisplayName && isDisplayNameChange(event)
  const avatarChanged = showAvatar && isAvatarChange(event)
  const previousName = String(
    event.getPrevContent().displayname || event.getStateKey() || 'Someone',
  )
  const currentName = String(event.getContent().displayname || event.getStateKey() || 'Someone')
  return (
    <MembershipLine>
      {nameChanged && avatarChanged
        ? `${previousName} changed their display name to ${currentName} and updated their profile picture`
        : nameChanged
          ? `${previousName} changed their display name to ${currentName}`
          : `${currentName} updated their profile picture`}
    </MembershipLine>
  )
}
