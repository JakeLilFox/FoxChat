import { MemberAvatar } from '../profile'
import { RoleIcon } from '../roles'
import { UserProfileTrigger } from '../profile'
import { type RoomRank, roomRank } from '../../lib/roleHelpers'
import { RankHeading, Section } from '../../styles'
import { useEffect, useState } from 'react'
import { Spin } from 'antd'
import { UserAddOutlined } from '@ant-design/icons'
import { Room } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

export function RoomParticipants({ room }: { room: Room }) {
  const [, refresh] = useState(0)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void room
      .loadMembersIfNeeded()
      .then(() => {
        if (!cancelled) refresh((value) => value + 1)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [room])
  const groups = new Map<
    string,
    { rank: RoomRank; members: ReturnType<Room['getJoinedMembers']> }
  >()
  for (const member of room.getJoinedMembers()) {
    const rank = roomRank(room, member.userId)
    const key = `${rank.level}:${rank.name}:${rank.color ?? ''}`
    const group = groups.get(key) ?? { rank, members: [] }
    group.members.push(member)
    groups.set(key, group)
  }
  const sorted = [...groups.values()].sort(
    (a, b) => b.rank.level - a.rank.level || a.rank.name.localeCompare(b.rank.name),
  )
  for (const group of sorted)
    group.members.sort((a, b) => (a.name || a.userId).localeCompare(b.name || b.userId))
  return (
    <Section>
      <div className="head">
        <span>Participants · {room.getJoinedMemberCount()}</span>
        {loading ? <Spin size="small" /> : <UserAddOutlined />}
      </div>
      {sorted.map((group) => (
        <div key={`${group.rank.level}:${group.rank.name}`}>
          <RankHeading style={{ color: group.rank.color }}>
            <RoleIcon rank={group.rank} />
            <span>{group.rank.name}</span>
            <span className="line" />
            <span className="count">{group.members.length}</span>
          </RankHeading>
          {group.members.map((member) => {
            const displayName = member.name || member.userId
            const status = matrixService
              .clientForRoomInstance(room)
              ?.getUser(member.userId)
              ?.presenceStatusMsg?.trim()
            return (
              <UserProfileTrigger
                block
                key={member.userId}
                userId={member.userId}
                name={displayName}
                avatarUrl={member.getMxcAvatarUrl()}
                room={room}
              >
                <div className="item">
                  <MemberAvatar
                    userId={member.userId}
                    name={displayName}
                    url={member.getMxcAvatarUrl()}
                    roomId={room.roomId}
                  />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="participantPrimary">
                      <span
                        className="participantName"
                        title={displayName}
                        style={{ color: group.rank.color }}
                      >
                        {displayName}
                      </span>
                      <span
                        className="participantMxid"
                        title={member.userId}
                        style={{ color: group.rank.color }}
                      >
                        {member.userId}
                      </span>
                    </div>
                    {status && (
                      <div className="participantStatus" title={status}>
                        {status}
                      </div>
                    )}
                  </div>
                </div>
              </UserProfileTrigger>
            )
          })}
        </div>
      ))}
    </Section>
  )
}
