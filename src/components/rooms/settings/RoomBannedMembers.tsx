import { MemberAvatar } from '../../profile'
import { Section } from '../../../styles'
import { useEffect, useState } from 'react'
import { App as AntApp, Button, Empty } from 'antd'
import { Room } from 'matrix-js-sdk'
import { matrixService } from '../../../matrix/MatrixClientService'

export function RoomBannedMembers({ room }: { room: Room }) {
  const { message, modal } = AntApp.useApp()
  const [, setRevision] = useState(0)
  const [unbanningId, setUnbanningId] = useState<string>()
  useEffect(
    () =>
      matrixService.subscribe({
        onRoom: (changed) => {
          if (changed.roomId === room.roomId) setRevision((value) => value + 1)
        },
      }),
    [room],
  )
  const banned = matrixService.bannedRoomMembers(room)
  const unban = (userId: string, name?: string) => {
    modal.confirm({
      title: `Unban ${name || userId}?`,
      content: 'They will be able to join this room again.',
      okText: 'Unban member',
      onOk: async () => {
        setUnbanningId(userId)
        try {
          await matrixService.unbanRoomMember(room.roomId, userId)
          message.success(`${name || userId} was unbanned`)
        } catch (error) {
          message.error(error instanceof Error ? error.message : 'Could not unban member')
        } finally {
          setUnbanningId(undefined)
        }
      },
    })
  }
  return (
    <Section>
      <div className="head">
        <span>Banned members · {banned.length}</span>
      </div>
      {banned.length ? (
        banned.map((member) => (
          <div className="item" key={member.userId}>
            <MemberAvatar
              userId={member.userId}
              name={member.name || member.userId}
              url={member.avatarUrl}
              roomId={room.roomId}
              showPresenceTooltip={false}
            />
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{member.name || member.userId}</div>
              <div style={{ opacity: 0.7 }}>{member.userId}</div>
              {member.reason && <div style={{ opacity: 0.7 }}>Reason: {member.reason}</div>}
            </div>
            <Button
              size="small"
              loading={unbanningId === member.userId}
              onClick={() => unban(member.userId, member.name)}
            >
              Unban
            </Button>
          </div>
        ))
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No banned members" />
      )}
    </Section>
  )
}
