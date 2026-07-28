import { RoomAvatar } from './RoomAvatar'
import { RoomNotificationSetting, RoomSettingsButton } from './settings'
import { RoomParticipants } from './RoomParticipants'
import { UserProfileCard } from '../profile'
import { roomTopic } from '../../lib/eventHelpers'
import { openRoomFiles, openRoomGallery, openRoomLinks, openSearchUrl } from '../../lib/urlState'
import { DetailHead, Details, Hero, IconBtn, RoomDetailsProfile, Section } from '../../styles'
import { useState } from 'react'
import { Button, Popover, Select, App as AntApp } from 'antd'
import {
  BellOutlined,
  FileOutlined,
  LinkOutlined,
  LockOutlined,
  PictureOutlined,
  SearchOutlined,
  UserAddOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons'
import { EventType, Room, RoomType } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

export function RoomDetails({ room, drawer = false }: { room?: Room; drawer?: boolean }) {
  const { message } = AntApp.useApp()
  const [enablingEncryption, setEnablingEncryption] = useState(false)
  const [justEnabledEncryption, setJustEnabledEncryption] = useState(false)
  if (!room) return <Details $drawer={drawer} />
  const memberCount = room.getJoinedMemberCount()
  const accounts = matrixService.roomAccounts(room.roomId)
  const selectedAccount = matrixService.selectedRoomAccountId(room.roomId)
  const client = matrixService.clientForRoomInstance(room)
  const selfId = client?.getUserId()
  const encrypted = room.hasEncryptionStateEvent() || justEnabledEncryption
  const canEnableEncryption =
    !!selfId && !encrypted && room.currentState.maySendStateEvent(EventType.RoomEncryption, selfId)
  const enableEncryption = async () => {
    setEnablingEncryption(true)
    try {
      await matrixService.enableEncryption(room.roomId)
      setJustEnabledEncryption(true)
      message.success('Encryption enabled for this room')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not enable encryption')
    } finally {
      setEnablingEncryption(false)
    }
  }
  const otherMember = matrixService.directRoomMember(room)
  const isDirectMessage = !!otherMember
  const actions = (
    <div className="actions">
      <Popover
        trigger="click"
        content={
          <div style={{ width: 270 }}>
            <RoomNotificationSetting room={room} compact />
          </div>
        }
      >
        <div className="action">
          <IconBtn shape="circle" icon={<BellOutlined />} />
          Notifications
        </div>
      </Popover>
      <div
        className="action"
        role="button"
        tabIndex={0}
        onClick={() => openSearchUrl('room')}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          openSearchUrl('room')
        }}
      >
        <IconBtn shape="circle" icon={<SearchOutlined />} />
        Search
      </div>
      <div
        className="action"
        role="button"
        aria-label="Invite"
        tabIndex={0}
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent('foxchat-invite-to-room', {
              detail: room.roomId,
            }),
          )
        }
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          window.dispatchEvent(
            new CustomEvent('foxchat-invite-to-room', {
              detail: room.roomId,
            }),
          )
        }}
      >
        <IconBtn shape="circle" icon={<UserAddOutlined />} />
        Invite
      </div>
      <div
        className="action"
        role="button"
        tabIndex={0}
        onClick={openRoomGallery}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') openRoomGallery()
        }}
      >
        <IconBtn shape="circle" icon={<PictureOutlined />} />
        Gallery
      </div>
      <div
        className="action"
        role="button"
        tabIndex={0}
        onClick={openRoomLinks}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') openRoomLinks()
        }}
      >
        <IconBtn shape="circle" icon={<LinkOutlined />} />
        Links
      </div>
      <div
        className="action"
        role="button"
        tabIndex={0}
        onClick={openRoomFiles}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') openRoomFiles()
        }}
      >
        <IconBtn shape="circle" icon={<FileOutlined />} />
        Files
      </div>
    </div>
  )
  return (
    <Details $drawer={drawer}>
      <DetailHead>
        <span>{room.getType() === RoomType.Space ? 'Space details' : 'Channel details'}</span>
        <RoomSettingsButton room={room} />
      </DetailHead>
      {isDirectMessage && otherMember ? (
        <>
          <RoomDetailsProfile>
            <UserProfileCard
              request={{
                userId: otherMember.userId,
                name: otherMember.name,
                avatarUrl: otherMember.getMxcAvatarUrl() ?? undefined,
                rect: { left: 0, right: 0, top: 0, bottom: 0 },
              }}
            />
          </RoomDetailsProfile>
          <Hero style={{ paddingTop: 0 }}>{actions}</Hero>
        </>
      ) : (
        <Hero>
          <RoomAvatar room={room} size={72} />
          <h3>{room.name}</h3>
          <div className="desc">
            {room.getCanonicalAlias() || room.roomId}
            <br />
            {memberCount} participant{memberCount === 1 ? '' : 's'}
          </div>
          {actions}
        </Hero>
      )}
      <Section>
        <div className="head">
          <span>Channel description</span>
        </div>
        <div className="item" style={{ display: 'block', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
          {roomTopic(room) || 'No channel description has been set.'}
        </div>
      </Section>
      {accounts.length > 1 && (
        <Section>
          <div className="head">
            <span>Send messages as</span>
            <UserSwitchOutlined />
          </div>
          <div className="item">
            <Select
              style={{ width: '100%' }}
              value={selectedAccount}
              options={accounts.map((account) => ({
                value: account.id,
                label: account.userId,
              }))}
              onChange={(accountId) => matrixService.selectRoomAccount(room.roomId, accountId)}
            />
          </div>
        </Section>
      )}
      <RoomParticipants room={room} />
      {room.getType() !== RoomType.Space && (
        <Section>
          <div className="head">
            <span>Security</span>
          </div>
          <div className="item">
            <LockOutlined />
            <span className="grow">
              {encrypted ? 'Encrypted with Megolm' : 'Encryption is not enabled'}
            </span>
            {canEnableEncryption && (
              <Button
                size="small"
                loading={enablingEncryption}
                onClick={() => void enableEncryption()}
              >
                Enable encryption
              </Button>
            )}
          </div>
        </Section>
      )}
    </Details>
  )
}
