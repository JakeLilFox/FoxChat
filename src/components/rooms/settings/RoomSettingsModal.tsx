import { ImagePackEditor } from '../../ImagePackEditor'
import { RoleEditor } from '../../roles'
import { RoomGeneralSettings } from './RoomGeneralSettings'
import { RoomFederationSettings } from './RoomFederationSettings'
import { RoomNotificationSetting } from './RoomNotificationSetting'
import { RoomSecuritySettings } from './RoomSecuritySettings'
import { SpaceInvitations } from '../../spaces'
import { SpaceManagement } from '../../spaces'
import { SpacePresentationSettings } from './SpacePresentationSettings'
import { findRoomImagePack } from '../../../lib/emojiData'
import { Divider, Modal, Tabs, Tag } from 'antd'
import { EventType, Room, RoomType } from 'matrix-js-sdk'
import { matrixService } from '../../../matrix/MatrixClientService'

export function RoomSettingsModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const userId = matrixService.matrixClient?.getUserId()
  const canManageRoles =
    !!userId &&
    room.currentState.maySendStateEvent('in.cinny.room.power_level_tags', userId) &&
    room.currentState.maySendStateEvent(EventType.RoomPowerLevels, userId)
  const canManagePacks =
    !!userId && room.currentState.maySendStateEvent('im.ponies.room_emotes', userId)
  const packLocation = findRoomImagePack(room)
  const kind = room.getType() === RoomType.Space ? 'Space' : 'Room'
  const items = [
    {
      key: 'general',
      label: 'General',
      children: (
        <div>
          <h2>{kind} settings</h2>
          <RoomGeneralSettings room={room} />
          <Divider />
          <RoomNotificationSetting room={room} />
          {room.getType() === RoomType.Space && <SpacePresentationSettings space={room} />}
          {!canManagePacks && (
            <p style={{ marginTop: 16 }}>
              <Tag color="warning">Limited permissions</Tag> You cannot change this{' '}
              {kind.toLowerCase()}’s sticker and emoji pack.
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'federation',
      label: 'Federation',
      children: <RoomFederationSettings room={room} />,
    },
    ...(room.getType() !== RoomType.Space
      ? [
          {
            key: 'security',
            label: 'Security',
            children: <RoomSecuritySettings room={room} />,
          },
        ]
      : []),
    ...(room.getType() === RoomType.Space
      ? [
          {
            key: 'channels',
            label: 'Channels',
            children: <SpaceManagement space={room} />,
          },
        ]
      : []),
    ...(room.getType() === RoomType.Space
      ? [
          {
            key: 'invitations',
            label: 'Invitations',
            children: <SpaceInvitations space={room} />,
          },
        ]
      : []),
    ...(canManageRoles
      ? [
          {
            key: 'roles',
            label: 'Roles & permissions',
            children: <RoleEditor room={room} />,
          },
        ]
      : []),
    ...(canManagePacks
      ? [
          {
            key: 'stickers',
            label: 'Stickers & emoji',
            children: (
              <div>
                <h2>{kind} stickers and emoji</h2>
                <p>
                  Upload images for this {kind.toLowerCase()}. They are stored as room state and
                  become available to participants.
                </p>
                <ImagePackEditor
                  pack={packLocation?.pack}
                  roomId={room.roomId}
                  stateKey={packLocation?.stateKey}
                />
              </div>
            ),
          },
        ]
      : []),
  ]
  return (
    <Modal
      title={`${kind} settings`}
      open
      footer={null}
      width={980}
      onCancel={onClose}
      destroyOnHidden
    >
      <Tabs items={items} />
    </Modal>
  )
}
