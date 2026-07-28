import { ImagePackEditor } from '../../ImagePackEditor'
import { RoleEditor } from '../../roles'
import { RoomGeneralSettings } from './RoomGeneralSettings'
import { RoomFederationSettings } from './RoomFederationSettings'
import { RoomNotificationSetting } from './RoomNotificationSetting'
import { RoomSecuritySettings } from './RoomSecuritySettings'
import { SpaceInvitations } from '../../spaces'
import { SpaceManagement } from '../../spaces'
import { SpacePresentationSettings } from './SpacePresentationSettings'
import { type MatrixEmotePack, findRoomImagePacks } from '../../../lib/emojiData'
import { useState } from 'react'
import { Divider, Modal, Tabs, Tag } from 'antd'
import { EventType, Room, RoomType } from 'matrix-js-sdk'
import { matrixService } from '../../../matrix/MatrixClientService'

type PackSlot = { key: string; stateKey: string; pack?: MatrixEmotePack }
const newPackStateKey = () => `pack-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const slotsFromRoom = (room: Room): PackSlot[] => {
  const locations = findRoomImagePacks(room)
  return locations.length
    ? locations.map((location) => ({
        key: location.stateKey || 'default',
        stateKey: location.stateKey,
        pack: location.pack,
      }))
    : [{ key: 'default', stateKey: '', pack: undefined }]
}

export function RoomSettingsModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const userId = matrixService.matrixClient?.getUserId()
  const canManageRoles =
    !!userId &&
    room.currentState.maySendStateEvent('in.cinny.room.power_level_tags', userId) &&
    room.currentState.maySendStateEvent(EventType.RoomPowerLevels, userId)
  const canManagePacks =
    !!userId && room.currentState.maySendStateEvent('im.ponies.room_emotes', userId)
  const [packSlots, setPackSlots] = useState<PackSlot[]>(() => slotsFromRoom(room))
  const [activePackKey, setActivePackKey] = useState<string>(() => packSlots[0]?.key ?? 'default')
  const kind = room.getType() === RoomType.Space ? 'Space' : 'Room'
  const editPack = (targetKey: string, action: 'add' | 'remove') => {
    if (action === 'add') {
      const stateKey = newPackStateKey()
      setPackSlots((current) => [...current, { key: stateKey, stateKey, pack: undefined }])
      setActivePackKey(stateKey)
      return
    }
    const slot = packSlots.find((candidate) => candidate.key === targetKey)
    if (!slot) return
    Modal.confirm({
      title: 'Remove this pack?',
      content: `${slot.pack?.pack?.display_name || 'This pack'} and its images will no longer be available in this ${kind.toLowerCase()}.`,
      okText: 'Remove',
      okButtonProps: { danger: true },
      onOk: async () => {
        if (slot.pack) await matrixService.saveRoomImagePack(room.roomId, {}, slot.stateKey)
        setPackSlots((current) => {
          const next = current.filter((candidate) => candidate.key !== targetKey)
          return next.length ? next : [{ key: 'default', stateKey: '', pack: undefined }]
        })
        setActivePackKey((current) => {
          if (current !== targetKey) return current
          const remaining = packSlots.filter((candidate) => candidate.key !== targetKey)
          return remaining[0]?.key ?? 'default'
        })
      },
    })
  }
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
                  Upload images for this {kind.toLowerCase()}. Each tab is a separate pack, stored
                  as its own room state event, and every pack becomes available to participants.
                </p>
                <Tabs
                  type="editable-card"
                  hideAdd={false}
                  activeKey={activePackKey}
                  onChange={setActivePackKey}
                  onEdit={(targetKey, action) => {
                    if (action === 'add') editPack('', 'add')
                    else editPack(targetKey as string, 'remove')
                  }}
                  items={packSlots.map((slot, index) => ({
                    key: slot.key,
                    label: slot.pack?.pack?.display_name || `Pack ${index + 1}`,
                    closable: true,
                    children: (
                      <ImagePackEditor
                        pack={slot.pack}
                        roomId={room.roomId}
                        stateKey={slot.stateKey}
                        defaultName={packSlots.length > 1 ? `Pack ${index + 1}` : undefined}
                        onSaved={(content) =>
                          setPackSlots((current) =>
                            current.map((entry) =>
                              entry.key === slot.key ? { ...entry, pack: content } : entry,
                            ),
                          )
                        }
                      />
                    ),
                  }))}
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
