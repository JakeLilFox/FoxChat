import { PresenceAvatar } from './PresenceAvatar'
import { colorFor, initials } from '../../lib/constants'
import { useMediaUrl } from '../../lib/hooks'
import { Avatar } from 'antd'

export function MemberAvatar({
  userId,
  name,
  url,
  size = 32,
  showPresenceTooltip = true,
}: {
  userId: string
  name: string
  url?: string
  size?: number
  showPresenceTooltip?: boolean
}) {
  const avatarUrl = useMediaUrl({ url })
  return (
    <PresenceAvatar userId={userId} showTooltip={showPresenceTooltip}>
      <Avatar
        size={size}
        src={avatarUrl}
        style={{ background: colorFor(userId), fontSize: size / 3 }}
      >
        {!avatarUrl && initials(name)}
      </Avatar>
    </PresenceAvatar>
  )
}
