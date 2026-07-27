import { matrixService, type RoomNotificationMode } from '../../matrix/MatrixClientService'
import { BellOutlined, SoundOutlined, StopOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
import type { ReactNode } from 'react'

const presentation: Record<
  RoomNotificationMode,
  { label: string; color: string; icon: ReactNode }
> = {
  all: {
    label: 'Notifications: All messages',
    color: '#35c77a',
    icon: <SoundOutlined />,
  },
  mentions: {
    label: 'Notifications: Mentions only',
    color: '#d89546',
    icon: <BellOutlined />,
  },
  none: {
    label: 'Notifications: None',
    color: '#8b91a1',
    icon: <StopOutlined />,
  },
}

export function RoomNotificationModeIcon({ roomId }: { roomId: string }) {
  const mode = matrixService.getRoomNotificationMode(roomId)
  const item = presentation[mode]
  return (
    <Tooltip title={item.label}>
      <span
        aria-label={item.label}
        role="img"
        style={{
          color: item.color,
          fontSize: 12,
          lineHeight: 1,
          display: 'inline-flex',
          opacity: mode === 'none' ? 0.75 : 1,
        }}
      >
        {item.icon}
      </span>
    </Tooltip>
  )
}
