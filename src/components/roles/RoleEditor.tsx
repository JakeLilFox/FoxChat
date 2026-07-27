import { MemberAvatar } from '../profile'
import { RoleIconEditor } from './RoleIconEditor'
import {
  type EditableRole,
  type RolePermissionField,
  effectivePowerLevel,
  expandPermissionLevels,
  readPermissionLevel,
} from '../../lib/roleHelpers'
import { containingSpacePath } from '../../lib/spaceHelpers'
import { useState } from 'react'
import {
  Button,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Switch,
  App as AntApp,
  List as AntList,
} from 'antd'
import { DeleteOutlined, SyncOutlined } from '@ant-design/icons'
import { EventType, Room, RoomType } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

const messageDefault = (power: Record<string, unknown>) =>
  typeof power.events_default === 'number' ? power.events_default : 0
const stateDefault = (power: Record<string, unknown>) =>
  typeof power.state_default === 'number' ? power.state_default : 50

const rolePermissionGroups: {
  title: string
  fields: RolePermissionField[]
}[] = [
  {
    title: 'Messages',
    fields: [
      {
        key: 'events_default',
        label: 'Send messages',
        description:
          'Send normal timeline messages, and any event type without a more specific rule below',
        fallback: () => 0,
      },
      {
        key: 'events.m.sticker',
        label: 'Send stickers',
        description: 'Send sticker messages',
        fallback: messageDefault,
      },
      {
        key: 'events.m.reaction',
        label: 'Send reactions',
        description: 'React to messages with an emoji',
        fallback: messageDefault,
      },
      {
        key: 'events.m.room.pinned_events',
        label: 'Pin messages',
        description: 'Change which messages are pinned',
        fallback: stateDefault,
      },
      {
        key: 'notifications.room',
        label: 'Ping @room',
        description: 'Notify everyone in the room with an @room mention',
        fallback: () => 50,
      },
      {
        key: 'redact',
        label: 'Delete messages sent by others',
        description: "Remove any member's messages",
        fallback: () => 50,
      },
      {
        key: 'events.m.room.redaction',
        label: 'Delete own messages',
        description: 'Remove your own messages',
        fallback: messageDefault,
      },
    ],
  },
  {
    title: 'Calls',
    fields: [
      {
        key: 'events.org.matrix.msc3401.call',
        aliasKeys: ['events.org.matrix.msc3401.call.member'],
        label: 'Start or join calls',
        description: 'Start or join a voice/video call in this room',
        fallback: stateDefault,
      },
    ],
  },
  {
    title: 'Membership',
    fields: [
      {
        key: 'invite',
        label: 'Invite members',
        description: 'Invite people to this room',
        fallback: () => 0,
      },
      {
        key: 'kick',
        label: 'Remove members',
        description: 'Remove members with a lower power level',
        fallback: () => 50,
      },
      {
        key: 'ban',
        label: 'Ban members',
        description: 'Ban members with a lower power level',
        fallback: () => 50,
      },
    ],
  },
  {
    title: 'Room info',
    fields: [
      {
        key: 'events.m.room.name',
        label: 'Change room name',
        description: '',
        fallback: stateDefault,
      },
      {
        key: 'events.m.room.avatar',
        label: 'Change room avatar',
        description: '',
        fallback: stateDefault,
      },
      {
        key: 'events.m.room.topic',
        label: 'Change room topic',
        description: '',
        fallback: stateDefault,
      },
      {
        key: 'events.m.room.join_rules',
        label: 'Change room access',
        description: 'Who can join without an invite (public, invite-only, knock, restricted...)',
        fallback: stateDefault,
      },
      {
        key: 'events.m.room.canonical_alias',
        label: 'Change published address',
        description: "Set the room's main and published addresses",
        fallback: stateDefault,
      },
    ],
  },
  {
    title: 'Advanced',
    fields: [
      {
        key: 'state_default',
        label: 'Change room settings',
        description: 'Change any room state without a more specific rule above',
        fallback: () => 50,
      },
      {
        key: 'events.m.room.power_levels',
        label: 'Edit permissions',
        description: 'Change this list of permissions itself',
        fallback: stateDefault,
      },
      {
        key: 'events.m.room.encryption',
        label: 'Enable encryption',
        description: 'Turn on end-to-end encryption (this cannot be undone)',
        fallback: stateDefault,
      },
      {
        key: 'events.m.room.history_visibility',
        label: 'Change history visibility',
        description: "Who can read the room's past messages",
        fallback: stateDefault,
      },
      {
        key: 'events.m.room.tombstone',
        label: 'Upgrade room',
        description: 'Upgrade this room to a new room version',
        fallback: stateDefault,
      },
      {
        key: 'events.m.room.server_acl',
        label: 'Change server ACLs',
        description: 'Block or allow specific homeservers from participating',
        fallback: stateDefault,
      },
      {
        key: 'events.im.ponies.room_emotes',
        label: 'Manage emoji & stickers',
        description: "Add or remove this room's custom emoji and sticker pack",
        fallback: stateDefault,
      },
    ],
  },
]
const rolePermissionFields: RolePermissionField[] = rolePermissionGroups.flatMap(
  (group) => group.fields,
)
export function RoleEditor({ room }: { room: Room }) {
  const { message } = AntApp.useApp()
  const isSpace = room.getType() === RoomType.Space
  const client = matrixService.matrixClient
  const inheritedSource = !room.currentState.getStateEvents('in.cinny.room.power_level_tags', '')
    ? containingSpacePath(room.roomId, client)
        .reverse()
        .map((id) => client?.getRoom(id))
        .find((value) => value?.currentState.getStateEvents('in.cinny.room.power_level_tags', ''))
    : undefined
  const initialTags = (
    room.currentState.getStateEvents('in.cinny.room.power_level_tags', '') ??
    inheritedSource?.currentState.getStateEvents('in.cinny.room.power_level_tags', '')
  )?.getContent() as
    | Record<string, { name?: string; color?: string; icon?: { key?: string } }>
    | undefined
  const power = room.currentState.getStateEvents(EventType.RoomPowerLevels, '')?.getContent() ?? {}
  const makeRoles = () => {
    const levels = new Set([
      0,
      50,
      100,
      ...Object.keys(initialTags ?? {})
        .map(Number)
        .filter(Number.isFinite),
    ])
    return [...levels]
      .sort((a, b) => b - a)
      .map((level) => ({
        id: crypto.randomUUID(),
        level,
        name:
          initialTags?.[level]?.name ||
          (level >= 100 ? 'Admin' : level >= 50 ? 'Moderator' : 'Member'),
        color:
          initialTags?.[level]?.color ||
          (level >= 100 ? '#0088ff' : level >= 50 ? '#a77eff' : '#ff7df6'),
        icon: initialTags?.[level]?.icon?.key,
      }))
  }
  const [roles, setRoles] = useState<EditableRole[]>(makeRoles)
  const [selected, setSelected] = useState<string>()
  const [assignments, setAssignments] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      room
        .getJoinedMembers()
        .map((member) => [member.userId, effectivePowerLevel(room, member.userId)]),
    ),
  )
  const startingPermissions = Object.fromEntries(
    rolePermissionFields.map((field) => [
      field.key,
      readPermissionLevel(power, field.key) ?? field.fallback(power),
    ]),
  )
  const [permissions, setPermissions] = useState<Record<string, number>>(() => ({
    ...startingPermissions,
  }))
  const [busy, setBusy] = useState<'save' | 'sync'>()
  const sorted = [...roles].sort((a, b) => b.level - a.level)
  const active = roles.find((role) => role.id === selected)
  const update = (id: string, patch: Partial<EditableRole>) =>
    setRoles((current) =>
      current.map((role) => {
        if (role.id !== id) return role
        if (patch.level !== undefined && patch.level !== role.level) {
          setAssignments((values) =>
            Object.fromEntries(
              Object.entries(values).map(([userId, level]) => [
                userId,
                level === role.level ? patch.level! : level,
              ]),
            ),
          )
          setPermissions((values) =>
            Object.fromEntries(
              Object.entries(values).map(([key, level]) => [
                key,
                level === role.level ? patch.level! : level,
              ]),
            ),
          )
        }
        return { ...role, ...patch }
      }),
    )
  const tags = () =>
    Object.fromEntries(
      roles.map((role) => [
        String(role.level),
        {
          name: role.name.trim() || `Power ${role.level}`,
          color: role.color,
          ...(role.icon ? { icon: { key: role.icon } } : {}),
        },
      ]),
    )
  const validate = () => {
    if (new Set(roles.map((role) => role.level)).size !== roles.length) {
      message.error('Every role needs a unique power level')
      return false
    }
    if (roles.some((role) => role.icon && !role.icon.startsWith('mxc://'))) {
      message.error('Role icons must use an mxc:// Matrix media URL')
      return false
    }
    return true
  }
  const save = async () => {
    if (!validate()) return
    setBusy('save')
    const expanded = expandPermissionLevels(rolePermissionFields, permissions)
    try {
      if (isSpace) await matrixService.saveSpaceRoles(room.roomId, tags(), assignments, expanded)
      else await matrixService.saveRoomRoles(room.roomId, tags(), assignments, expanded)
      message.success(`${isSpace ? 'Space' : 'Room'} roles saved`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not save roles')
    } finally {
      setBusy(undefined)
    }
  }
  const sync = async () => {
    if (!validate()) return
    setBusy('sync')
    const expanded = expandPermissionLevels(rolePermissionFields, permissions)
    const expandedStarting = expandPermissionLevels(rolePermissionFields, startingPermissions)
    try {
      await matrixService.saveSpaceRoles(room.roomId, tags(), assignments, expanded)
      const result = await matrixService.syncSpaceRoles(
        room.roomId,
        tags(),
        assignments,
        expanded,
        Object.fromEntries(
          Object.entries(expanded).filter(([key, value]) => expandedStarting[key] !== value),
        ),
      )
      if (result.failed.length)
        Modal.warning({
          title: `Synced ${result.synced.length} rooms`,
          content: `${result.failed.length} rooms could not be changed because your Matrix permissions differ there.`,
        })
      else message.success(`Roles synced to ${result.synced.length} rooms`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not sync roles')
    } finally {
      setBusy(undefined)
    }
  }
  const create = () => {
    const role = {
      id: crypto.randomUUID(),
      level: Math.max(0, ...roles.map((item) => item.level)) + 1,
      name: 'New role',
      color: '#7357e8',
    }
    setRoles((current) => [...current, role])
    setSelected(role.id)
  }
  return (
    <div>
      <h2>{isSpace ? 'Space' : 'Room'} roles</h2>
      <p>
        {isSpace
          ? 'Space roles are the server-wide baseline. Changed permissions and member assignments can be synchronized without overwriting unchanged channel overrides.'
          : 'These roles and permissions apply only to this room and can override the Space baseline.'}
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(170px,240px) minmax(280px,1fr)',
          gap: 18,
          alignItems: 'start',
        }}
      >
        <div>
          <Button type="primary" block onClick={create}>
            Create role
          </Button>
          <div style={{ display: 'grid', gap: 5, marginTop: 10 }}>
            {sorted.map((role) => (
              <button
                type="button"
                key={role.id}
                onClick={() => setSelected(role.id)}
                style={{
                  border: active?.id === role.id ? '1px solid #7357e8' : '1px solid transparent',
                  background: active?.id === role.id ? 'rgba(115,87,232,.14)' : 'transparent',
                  borderRadius: 9,
                  padding: '9px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  color: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: role.color,
                  }}
                />
                <span style={{ flex: 1 }}>{role.name}</span>
                <small>{role.level}</small>
              </button>
            ))}
          </div>
        </div>
        <div>
          {active ? (
            <>
              <h3 style={{ marginTop: 0 }}>Edit {active.name}</h3>
              <Form layout="vertical">
                <Form.Item label="Role name">
                  <Input
                    value={active.name}
                    onChange={(event) => update(active.id, { name: event.target.value })}
                  />
                </Form.Item>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                  }}
                >
                  <Form.Item label="Color">
                    <input
                      type="color"
                      value={active.color}
                      onChange={(event) => update(active.id, { color: event.target.value })}
                      style={{ width: '100%', height: 34, border: 0 }}
                    />
                  </Form.Item>
                  <Form.Item label="Power level">
                    <InputNumber
                      style={{ width: '100%' }}
                      min={0}
                      max={1000}
                      value={active.level}
                      onChange={(value) => update(active.id, { level: value ?? 0 })}
                    />
                  </Form.Item>
                </div>
                <RoleIconEditor role={active} onChange={(icon) => update(active.id, { icon })} />
              </Form>
              <h3>Permissions</h3>
              <p style={{ fontSize: 12 }}>
                Matrix permissions are minimum power thresholds. Changing a switch can also affect
                lower or higher roles according to their numeric order.
              </p>
              {rolePermissionGroups.map((group) => (
                <div key={group.title} style={{ marginBottom: 14 }}>
                  <h4 style={{ margin: '0 0 6px' }}>{group.title}</h4>
                  <AntList
                    bordered
                    dataSource={group.fields}
                    renderItem={(field) => {
                      const enabled = active.level >= (permissions[field.key] ?? 0)
                      return (
                        <AntList.Item
                          extra={
                            <Switch
                              checked={enabled}
                              onChange={(checked) =>
                                setPermissions((current) => ({
                                  ...current,
                                  [field.key]: checked
                                    ? Math.min(current[field.key] ?? active.level, active.level)
                                    : active.level + 1,
                                }))
                              }
                            />
                          }
                        >
                          <AntList.Item.Meta title={field.label} description={field.description} />
                        </AntList.Item>
                      )
                    }}
                  />
                </div>
              ))}
              <Popconfirm
                title="Delete this role?"
                onConfirm={() => {
                  setRoles((current) => current.filter((role) => role.id !== active.id))
                  setAssignments((current) =>
                    Object.fromEntries(
                      Object.entries(current).map(([id, level]) => [
                        id,
                        level === active.level ? 0 : level,
                      ]),
                    ),
                  )
                  setSelected(undefined)
                }}
              >
                <Button danger icon={<DeleteOutlined />} style={{ marginTop: 12 }}>
                  Delete role
                </Button>
              </Popconfirm>
            </>
          ) : (
            <Empty description="Create or select a role to edit it" />
          )}
        </div>
      </div>
      <Divider />
      <h3>Member roles</h3>
      <AntList
        bordered
        dataSource={[...room.getJoinedMembers()].sort((a, b) =>
          (a.name || a.userId).localeCompare(b.name || b.userId),
        )}
        renderItem={(member) => (
          <AntList.Item>
            <AntList.Item.Meta
              avatar={
                <MemberAvatar
                  userId={member.userId}
                  name={member.name || member.userId}
                  url={member.getMxcAvatarUrl()}
                />
              }
              title={member.name || member.userId}
              description={member.userId}
            />
            <Select
              style={{ width: 160 }}
              value={assignments[member.userId] ?? 0}
              options={sorted.map((role) => ({
                value: role.level,
                label: role.name,
              }))}
              onChange={(level) =>
                setAssignments((current) => ({
                  ...current,
                  [member.userId]: level,
                }))
              }
            />
          </AntList.Item>
        )}
      />
      <Divider />
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="primary" loading={busy === 'save'} onClick={() => void save()}>
          Save changes
        </Button>
        {isSpace && (
          <Popconfirm
            title="Synchronize baseline role changes?"
            description="Assignments always propagate. Only permissions changed since the previous sync replace channel values."
            onConfirm={() => void sync()}
          >
            <Button icon={<SyncOutlined />} loading={busy === 'sync'}>
              Sync baseline
            </Button>
          </Popconfirm>
        )}
      </div>
    </div>
  )
}
