import { PresenceAvatar } from '../profile'
import { activeVoiceUsers, isVoiceChannel } from '../calls/voiceRoom'
import { colorFor, initials } from '../../lib/constants'
import { useMediaUrl } from '../../lib/hooks'
import { ActiveSpaceVoiceAvatar, ActiveSpaceVoiceIndicator, VoiceAvatarWrap } from '../../styles'
import { Avatar, Badge, Tooltip } from 'antd'
import { AudioOutlined } from '@ant-design/icons'
import { Room, RoomType } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

export function RoomAvatar({ room, size = 43 }: { room: Room; size?: number }) {
  const client = matrixService.clientForRoomInstance(room)
  const accountRoom = client?.getRoom(room.roomId) ?? room
  const directMember = matrixService.directRoomMember(accountRoom)
  const directUser = directMember?.userId
  const url = useMediaUrl(
    {
      url: accountRoom.getMxcAvatarUrl() ?? directMember?.getMxcAvatarUrl(),
    },
    client,
    { category: 'avatar', roomId: room.roomId },
  )
  if (isVoiceChannel(accountRoom))
    return (
      <Badge
        count={activeVoiceUsers(accountRoom).size}
        size="small"
        color="#35c978"
        offset={[-1, size - 7]}
      >
        <VoiceAvatarWrap>
          <Avatar
            size={size}
            shape="square"
            src={url}
            style={{
              background: colorFor(room.roomId),
              fontWeight: 750,
              fontSize: size / 3,
            }}
          >
            {!url && initials(room.name)}
          </Avatar>
          <span className="voiceMark">
            <AudioOutlined />
          </span>
        </VoiceAvatarWrap>
      </Badge>
    )
  const avatar = (
    <PresenceAvatar userId={directUser}>
      <Avatar
        size={size}
        src={url}
        style={{
          background: colorFor(room.roomId),
          fontWeight: 750,
          fontSize: size / 3,
        }}
      >
        {!url && initials(room.name)}
      </Avatar>
    </PresenceAvatar>
  )
  const voiceUsers =
    accountRoom.getType() === RoomType.Space ? activeVoiceUsers(accountRoom) : new Map()
  return voiceUsers.size ? (
    <Tooltip title={`${voiceUsers.size} ${voiceUsers.size === 1 ? 'person' : 'people'} in voice`}>
      <Badge
        count={
          <ActiveSpaceVoiceIndicator>
            <AudioOutlined />
          </ActiveSpaceVoiceIndicator>
        }
        offset={[-3, size - 8]}
      >
        <ActiveSpaceVoiceAvatar>{avatar}</ActiveSpaceVoiceAvatar>
      </Badge>
    </Tooltip>
  ) : (
    avatar
  )
}
