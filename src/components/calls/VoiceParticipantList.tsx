import { MemberAvatar } from '../profile'
import { UserProfileTrigger } from '../profile'
import { roomRank } from '../../lib/roleHelpers'
import { participantAudioMenu } from './voiceCallHelpers'
import {
  matrixRTCActiveSpeakers,
  matrixRTCVoiceMembers,
  voiceCallFor,
  voiceSpeakerEvent,
} from './voiceRoom'
import { VoiceParticipantRow } from '../../styles'
import { useEffect, useState } from 'react'
import { Dropdown, Tooltip } from 'antd'
import { Room } from 'matrix-js-sdk'
import { GroupCallEvent } from 'matrix-js-sdk/lib/webrtc/groupCall'
import { MatrixRTCSessionEvent } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession'
import { matrixService } from '../../matrix/MatrixClientService'

export function VoiceParticipantList({ room }: { room: Room }) {
  const client = matrixService.clientForRoomInstance(room)
  const [, render] = useState(0)
  const session = client?.matrixRTC.getRoomSession(room)
  const call = voiceCallFor(room)
  useEffect(() => {
    const update = () => render((value) => value + 1)
    const speakers = (event: Event) => {
      const detail = (event as CustomEvent<{ roomId: string; userIds: string[] }>).detail
      if (detail?.roomId !== room.roomId) return
      matrixRTCActiveSpeakers.set(room.roomId, new Set(detail.userIds))
      update()
    }
    session?.on(MatrixRTCSessionEvent.MembershipsChanged, update)
    call?.on(GroupCallEvent.ParticipantsChanged, update)
    call?.on(GroupCallEvent.ActiveSpeakerChanged, update)
    window.addEventListener(voiceSpeakerEvent, speakers)
    return () => {
      session?.off(MatrixRTCSessionEvent.MembershipsChanged, update)
      call?.off(GroupCallEvent.ParticipantsChanged, update)
      call?.off(GroupCallEvent.ActiveSpeakerChanged, update)
      window.removeEventListener(voiceSpeakerEvent, speakers)
    }
  }, [session, call, room.roomId])
  const members = new Map(
    matrixRTCVoiceMembers(client, room).map((member) => [member.userId, member]),
  )
  for (const member of call?.participants.keys() ?? []) members.set(member.userId, member)
  if (!members.size) return null
  const liveSpeakers = matrixRTCActiveSpeakers.get(room.roomId) ?? new Set<string>()
  const ownUserId = client?.getUserId()
  return (
    <>
      {[...members.values()].map((member) => {
        const name = member.name || member.userId
        const rank = roomRank(room, member.userId)
        const speaking =
          call?.activeSpeaker?.userId === member.userId || liveSpeakers.has(member.userId)
        const row = (
          <VoiceParticipantRow key={member.userId}>
            <UserProfileTrigger
              userId={member.userId}
              name={name}
              avatarUrl={member.getMxcAvatarUrl()}
              room={room}
            >
              <span className={`participantAvatar ${speaking ? 'speaking' : ''}`}>
                <MemberAvatar
                  userId={member.userId}
                  name={name}
                  url={member.getMxcAvatarUrl()}
                  size={27}
                />
              </span>
            </UserProfileTrigger>
            <Tooltip title={member.userId}>
              <span className="participantIdentity">
                <span className="participantName" style={{ color: rank.color }}>
                  {name}
                </span>
                <span className="participantRank">{rank.name}</span>
              </span>
            </Tooltip>
          </VoiceParticipantRow>
        )
        return member.userId === ownUserId ? (
          row
        ) : (
          <Dropdown
            key={member.userId}
            trigger={['contextMenu']}
            menu={participantAudioMenu(member.userId, () => render((value) => value + 1))}
          >
            {row}
          </Dropdown>
        )
      })}
    </>
  )
}
