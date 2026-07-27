import { showRoomSettings } from '../../../lib/roomSettingsHelpers'
import { IconBtn } from '../../../styles'
import { Tooltip } from 'antd'
import { SettingOutlined } from '@ant-design/icons'
import { Room, RoomType } from 'matrix-js-sdk'

export function RoomSettingsButton({ room }: { room: Room }) {
  const kind = room.getType() === RoomType.Space ? 'Space' : 'Room'
  return (
    <Tooltip title={`${kind} settings`}>
      <IconBtn shape="circle" icon={<SettingOutlined />} onClick={() => showRoomSettings(room)} />
    </Tooltip>
  )
}
