import { useState } from 'react'
import { Segmented, App as AntApp } from 'antd'
import { Room, RoomType } from 'matrix-js-sdk'
import { matrixService, type RoomNotificationMode } from '../../../matrix/MatrixClientService'

export function RoomNotificationSetting({
  room,
  compact = false,
}: {
  room: Room
  compact?: boolean
}) {
  const { message } = AntApp.useApp()
  const [mode, setMode] = useState<RoomNotificationMode>(() =>
    matrixService.getRoomNotificationMode(room.roomId),
  )
  const [saving, setSaving] = useState(false)
  const change = async (value: RoomNotificationMode) => {
    const previous = mode
    setMode(value)
    setSaving(true)
    try {
      await matrixService.setRoomNotificationMode(room.roomId, value)
      message.success(
        `${room.getType() === RoomType.Space ? 'Space' : 'Room'} notifications updated`,
      )
    } catch (error) {
      setMode(previous)
      message.error(error instanceof Error ? error.message : 'Could not update notifications')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div style={{ marginTop: compact ? 0 : 18 }}>
      {!compact && <div style={{ fontWeight: 700, marginBottom: 7 }}>Notifications</div>}
      <Segmented
        block
        disabled={saving}
        value={mode}
        onChange={(value) => void change(value as RoomNotificationMode)}
        options={[
          { label: 'All', value: 'all' },
          { label: 'Mentions', value: 'mentions' },
          { label: 'None', value: 'none' },
        ]}
      />
      {!compact && room.getType() === RoomType.Space && (
        <div style={{ fontSize: 11, marginTop: 7, opacity: 0.7 }}>
          This setting applies to every channel in the Space.
        </div>
      )}
    </div>
  )
}
