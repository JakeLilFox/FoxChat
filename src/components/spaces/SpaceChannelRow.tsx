import { RoomAvatar } from '../rooms'
import { RoomNotificationModeIcon } from '../rooms'
import { VoiceParticipantList } from '../calls/VoiceParticipantList'
import {
  activeVoiceUsers,
  isVoiceChannel,
  matrixRTCActiveSpeakers,
  voiceSpeakerEvent,
} from '../calls/voiceRoom'
import { lastMessagePreview, roomHasTyping, typingPreview } from '../../lib/timelineHelpers'
import { IconBtn, Name, Preview, Row, VoiceChannelGroup } from '../../styles'
import { Badge, Tooltip } from 'antd'
import { AudioOutlined, LockOutlined, PhoneOutlined, TeamOutlined } from '@ant-design/icons'
import { Room, RoomType } from 'matrix-js-sdk'
import { useEffect, useState } from 'react'

export function SpaceChannelRow({
  room,
  unread,
  selected,
  onSelect,
}: {
  room: Room
  unread: number
  selected: boolean
  onSelect: () => void
}) {
  const [, refreshSpeakers] = useState(0)
  useEffect(() => {
    const update = (event: Event) => {
      if ((event as CustomEvent<{ roomId?: string }>).detail?.roomId === room.roomId)
        refreshSpeakers((value) => value + 1)
    }
    window.addEventListener(voiceSpeakerEvent, update)
    return () => window.removeEventListener(voiceSpeakerEvent, update)
  }, [room.roomId])
  const participants = [...activeVoiceUsers(room)]
  const someoneSpeaking = (matrixRTCActiveSpeakers.get(room.roomId)?.size ?? 0) > 0
  if (!isVoiceChannel(room))
    return (
      <VoiceChannelGroup>
        <Row $selected={selected} onClick={onSelect}>
          <RoomAvatar room={room} />
          <div style={{ minWidth: 0 }}>
            <Name>
              {room.getType() === RoomType.Space && <TeamOutlined style={{ marginRight: 6 }} />}
              {room.name}
            </Name>
            {roomHasTyping(room) ? (
              typingPreview
            ) : (
              <Preview>
                {room.getMyMembership() === 'invite' ? 'Invitation' : lastMessagePreview(room)}
              </Preview>
            )}
          </div>
          <div
            style={{
              alignSelf: 'start',
              paddingTop: 3,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <RoomNotificationModeIcon roomId={room.roomId} />
            {room.hasEncryptionStateEvent() && (
              <Tooltip title="Encrypted">
                <LockOutlined style={{ opacity: 0.55, fontSize: 12 }} />
              </Tooltip>
            )}
            {unread > 0 && <Badge count={unread} size="small" color="#7357e8" />}
          </div>
        </Row>
        {participants.length > 0 && <VoiceParticipantList room={room} />}
      </VoiceChannelGroup>
    )
  return (
    <VoiceChannelGroup>
      <Row $selected={selected} onClick={onSelect}>
        <RoomAvatar room={room} />
        <div style={{ minWidth: 0 }}>
          <Name>
            <AudioOutlined style={{ marginRight: 6, color: '#8b72f3' }} />
            {room.name}
          </Name>
          {roomHasTyping(room) ? (
            typingPreview
          ) : (
            <Preview>
              {participants.length
                ? `${participants.length} connected`
                : 'Voice channel · nobody connected'}
            </Preview>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <RoomNotificationModeIcon roomId={room.roomId} />
          {room.hasEncryptionStateEvent() && (
            <Tooltip title="Encrypted">
              <LockOutlined style={{ opacity: 0.55, fontSize: 12 }} />
            </Tooltip>
          )}
          {unread > 0 && <Badge count={unread} size="small" color="#7357e8" />}
          <Tooltip title="Join voice">
            <IconBtn
              shape="circle"
              icon={<PhoneOutlined />}
              style={
                someoneSpeaking
                  ? {
                      color: '#fff',
                      background: '#35c77a',
                      borderColor: '#35c77a',
                      boxShadow: '0 0 10px rgba(53,199,122,.6)',
                    }
                  : undefined
              }
              onClick={(event) => {
                event.stopPropagation()
                window.dispatchEvent(new CustomEvent<Room>('foxchat-join-voice', { detail: room }))
              }}
            />
          </Tooltip>
        </div>
      </Row>
      <VoiceParticipantList room={room} />
    </VoiceChannelGroup>
  )
}
