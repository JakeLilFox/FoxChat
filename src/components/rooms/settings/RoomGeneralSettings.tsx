import { roomTopic } from '../../../lib/eventHelpers'
import { containingSpacePath } from '../../../lib/spaceHelpers'
import { useMediaUrl } from '../../../lib/hooks'
import { useEffect, useRef, useState } from 'react'
import {
  Avatar,
  Button,
  Collapse,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Switch,
  Tag,
  App as AntApp,
} from 'antd'
import { CloseOutlined, PlusOutlined, UploadOutlined, WarningOutlined } from '@ant-design/icons'
import {
  EventType,
  GuestAccess,
  HistoryVisibility,
  JoinRule,
  RestrictedAllowType,
  Room,
  RoomType,
} from 'matrix-js-sdk'
import { matrixService } from '../../../matrix/MatrixClientService'

const JOIN_RULE_LABELS: Record<JoinRule, string> = {
  [JoinRule.Public]: 'Public · anyone can join',
  [JoinRule.Invite]: 'Invite only',
  [JoinRule.Knock]: 'Ask to join',
  [JoinRule.Restricted]: 'Space members only',
  [JoinRule.Private]: 'Private',
}
const HISTORY_VISIBILITY_LABELS: Record<HistoryVisibility, string> = {
  [HistoryVisibility.WorldReadable]: 'Anyone, even without joining',
  [HistoryVisibility.Shared]: 'Members, including messages from before they joined',
  [HistoryVisibility.Invited]: 'Members, from the moment they were invited',
  [HistoryVisibility.Joined]: 'Members, only from the moment they joined',
}

export function RoomGeneralSettings({ room }: { room: Room }) {
  const { message } = AntApp.useApp()
  const client = matrixService.clientForRoomInstance(room)
  const userId = client?.getUserId()
  const may = (type: string) =>
    !!userId && room.currentState.maySendStateEvent(type as never, userId)
  const canName = may(EventType.RoomName)
  const canTopic = may(EventType.RoomTopic)
  const canAvatar = may(EventType.RoomAvatar)
  const canAlias = may(EventType.RoomCanonicalAlias)
  const canJoinRules = may(EventType.RoomJoinRules)
  const canGuestAccess = may(EventType.RoomGuestAccess)
  const canHistoryVisibility = may(EventType.RoomHistoryVisibility)
  const [justEnabledEncryption, setJustEnabledEncryption] = useState(false)
  const encrypted = room.hasEncryptionStateEvent() || justEnabledEncryption
  const canEncryption = may(EventType.RoomEncryption) && !encrypted
  const canUpgrade = may(EventType.RoomTombstone)
  const [defaultRoomVersion, setDefaultRoomVersion] = useState<string>()
  useEffect(() => {
    if (!canUpgrade || !client) return
    let active = true
    void client.getCapabilities().then((capabilities) => {
      if (active) setDefaultRoomVersion(capabilities['m.room_versions']?.default)
    })
    return () => {
      active = false
    }
  }, [canUpgrade, client])

  const rawName = String(
    room.currentState.getStateEvents(EventType.RoomName, '')?.getContent().name ?? '',
  )
  const [name, setName] = useState(rawName)
  const savedLocalName = matrixService.localRoomName(room.roomId) ?? ''
  const [localName, setLocalName] = useState(savedLocalName)
  const [topic, setTopic] = useState(() => roomTopic(room))
  const [newAlias, setNewAlias] = useState('')
  const [joinRule, setJoinRule] = useState(room.getJoinRule())
  const [guestAccess, setGuestAccess] = useState(room.getGuestAccess() === GuestAccess.CanJoin)
  const [historyVisibility, setHistoryVisibility] = useState(room.getHistoryVisibility())
  const [busy, setBusy] = useState<string>()
  const avatarInput = useRef<HTMLInputElement>(null)
  const avatarUrl = useMediaUrl({ url: room.getMxcAvatarUrl() ?? undefined }, undefined, {
    category: 'avatar',
    roomId: room.roomId,
  })
  const server = room.roomId.split(':').slice(1).join(':')
  const knownAliases = [
    ...new Set(
      [room.getCanonicalAlias(), ...room.getAltAliases()].filter(
        (alias): alias is string => !!alias,
      ),
    ),
  ]
  const kind = room.getType() === RoomType.Space ? 'Space' : 'Room'

  const fail = (error: unknown, fallback: string) =>
    message.error(error instanceof Error ? error.message : fallback)

  const saveName = async () => {
    if (!client || !name.trim()) return
    setBusy('name')
    try {
      await client.sendStateEvent(room.roomId, EventType.RoomName, { name: name.trim() }, '')
      message.success('Name updated')
    } catch (error) {
      fail(error, 'Could not update the name')
    } finally {
      setBusy(undefined)
    }
  }
  const saveLocalName = () => {
    const normalized = localName.trim()
    matrixService.setLocalRoomName(room.roomId, normalized || undefined)
    setLocalName(normalized)
    message.success(
      normalized ? `${kind} renamed locally` : `Local ${kind.toLowerCase()} name removed`,
    )
  }
  const saveTopic = async () => {
    if (!client) return
    setBusy('topic')
    try {
      await client.sendStateEvent(room.roomId, EventType.RoomTopic, { topic: topic.trim() }, '')
      message.success('Topic updated')
    } catch (error) {
      fail(error, 'Could not update the topic')
    } finally {
      setBusy(undefined)
    }
  }
  const uploadAvatar = async (file?: File) => {
    if (!file || !client) return
    setBusy('avatar')
    try {
      const upload = await client.uploadContent(file, { name: file.name, type: file.type })
      await client.sendStateEvent(
        room.roomId,
        EventType.RoomAvatar,
        { url: upload.content_uri },
        '',
      )
      message.success('Avatar updated')
    } catch (error) {
      fail(error, 'Could not update the avatar')
    } finally {
      setBusy(undefined)
      if (avatarInput.current) avatarInput.current.value = ''
    }
  }
  const removeAvatar = async () => {
    if (!client) return
    setBusy('avatar')
    try {
      await client.sendStateEvent(room.roomId, EventType.RoomAvatar, {}, '')
      message.success('Avatar removed')
    } catch (error) {
      fail(error, 'Could not remove the avatar')
    } finally {
      setBusy(undefined)
    }
  }
  const addAlias = async () => {
    const local = newAlias.trim().replace(/^#/, '')
    if (!local || !client) return
    const full = `#${local}:${server}`
    setBusy('alias')
    try {
      await client.createAlias(full, room.roomId)
      await client.sendStateEvent(
        room.roomId,
        EventType.RoomCanonicalAlias,
        {
          alias: room.getCanonicalAlias() ?? full,
          alt_aliases: [...room.getAltAliases(), full],
        },
        '',
      )
      setNewAlias('')
      message.success('Alias added')
    } catch (error) {
      fail(error, 'Could not add that alias')
    } finally {
      setBusy(undefined)
    }
  }
  const removeAlias = async (alias: string) => {
    if (!client) return
    setBusy('alias')
    try {
      await client.deleteAlias(alias).catch(() => undefined)
      const canonical = room.getCanonicalAlias()
      await client.sendStateEvent(
        room.roomId,
        EventType.RoomCanonicalAlias,
        {
          alias: canonical === alias ? undefined : (canonical ?? undefined),
          alt_aliases: room.getAltAliases().filter((existing) => existing !== alias),
        },
        '',
      )
      message.success('Alias removed')
    } catch (error) {
      fail(error, 'Could not remove that alias')
    } finally {
      setBusy(undefined)
    }
  }
  const makeCanonical = async (alias: string) => {
    if (!client) return
    setBusy('alias')
    try {
      await client.sendStateEvent(
        room.roomId,
        EventType.RoomCanonicalAlias,
        { alias, alt_aliases: room.getAltAliases() },
        '',
      )
      message.success('Canonical alias updated')
    } catch (error) {
      fail(error, 'Could not update the canonical alias')
    } finally {
      setBusy(undefined)
    }
  }
  const saveJoinRule = async (rule: JoinRule) => {
    if (!client) return
    setBusy('joinrule')
    try {
      const parents = containingSpacePath(room.roomId)
      await client.sendStateEvent(
        room.roomId,
        EventType.RoomJoinRules,
        {
          join_rule: rule,
          allow:
            rule === JoinRule.Restricted
              ? parents.map((roomId) => ({
                  type: RestrictedAllowType.RoomMembership,
                  room_id: roomId,
                }))
              : undefined,
        },
        '',
      )
      setJoinRule(rule)
      message.success('Join rule updated')
    } catch (error) {
      fail(error, 'Could not update the join rule')
    } finally {
      setBusy(undefined)
    }
  }
  const saveGuestAccess = async (allow: boolean) => {
    if (!client) return
    setBusy('guest')
    try {
      await client.sendStateEvent(
        room.roomId,
        EventType.RoomGuestAccess,
        { guest_access: allow ? GuestAccess.CanJoin : GuestAccess.Forbidden },
        '',
      )
      setGuestAccess(allow)
      message.success('Guest access updated')
    } catch (error) {
      fail(error, 'Could not update guest access')
    } finally {
      setBusy(undefined)
    }
  }
  const saveHistoryVisibility = async (value: HistoryVisibility) => {
    if (!client) return
    setBusy('history')
    try {
      await client.sendStateEvent(
        room.roomId,
        EventType.RoomHistoryVisibility,
        { history_visibility: value },
        '',
      )
      setHistoryVisibility(value)
      message.success('History visibility updated')
    } catch (error) {
      fail(error, 'Could not update history visibility')
    } finally {
      setBusy(undefined)
    }
  }
  const enableEncryption = async () => {
    setBusy('encryption')
    try {
      await matrixService.enableEncryption(room.roomId)
      setJustEnabledEncryption(true)
      message.success('Encryption enabled for this room')
    } catch (error) {
      fail(error, 'Could not enable encryption')
    } finally {
      setBusy(undefined)
    }
  }

  const upgradeRoom = () => {
    if (!client || !defaultRoomVersion) return
    Modal.confirm({
      title: `Upgrade this ${kind.toLowerCase()}?`,
      icon: <WarningOutlined />,
      content: `This creates a new room on version ${defaultRoomVersion} and marks this one as replaced. Members have to rejoin the new room manually - this cannot be undone.`,
      okText: 'Upgrade',
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy('upgrade')
        try {
          const { replacement_room: replacementRoom } = await client.upgradeRoom(
            room.roomId,
            defaultRoomVersion,
          )
          message.success('Room upgraded')
          window.dispatchEvent(new CustomEvent('foxchat-open-room', { detail: replacementRoom }))
        } catch (error) {
          fail(error, 'Could not upgrade this room')
        } finally {
          setBusy(undefined)
        }
      },
    })
  }

  const restricted = joinRule === JoinRule.Restricted && !containingSpacePath(room.roomId).length

  const panels = [
    {
      key: 'profile',
      label: 'Profile',
      children: (
        <Form layout="vertical">
          <Form.Item
            label={`Local ${kind.toLowerCase()} name`}
            extra="Only visible on this FoxChat installation. This does not change Matrix room state."
          >
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                value={localName}
                placeholder={rawName || room.name}
                onChange={(event) => setLocalName(event.target.value)}
              />
              <Button disabled={localName.trim() === savedLocalName} onClick={saveLocalName}>
                {localName.trim() ? 'Save locally' : 'Clear'}
              </Button>
            </div>
          </Form.Item>
          <Form.Item label={`Matrix ${kind.toLowerCase()} name`}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                value={name}
                disabled={!canName}
                onChange={(event) => setName(event.target.value)}
              />
              {canName && (
                <Button
                  loading={busy === 'name'}
                  disabled={!name.trim() || name.trim() === rawName}
                  onClick={() => void saveName()}
                >
                  Save
                </Button>
              )}
            </div>
          </Form.Item>
          <Form.Item label="Topic">
            <Input.TextArea
              value={topic}
              disabled={!canTopic}
              autoSize={{ minRows: 2, maxRows: 6 }}
              onChange={(event) => setTopic(event.target.value)}
            />
            {canTopic && (
              <Button
                style={{ marginTop: 8 }}
                loading={busy === 'topic'}
                onClick={() => void saveTopic()}
              >
                Save topic
              </Button>
            )}
          </Form.Item>
          <Form.Item label="Avatar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar
                size={56}
                src={avatarUrl}
                shape={room.getType() === RoomType.Space ? 'square' : 'circle'}
              >
                {!avatarUrl && room.name[0]?.toUpperCase()}
              </Avatar>
              {canAvatar && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    ref={avatarInput}
                    hidden
                    style={{ display: 'none' }}
                    type="file"
                    accept="image/*"
                    onChange={(event) => void uploadAvatar(event.target.files?.[0])}
                  />
                  <Button
                    icon={<UploadOutlined />}
                    loading={busy === 'avatar'}
                    onClick={() => avatarInput.current?.click()}
                  >
                    {avatarUrl ? 'Replace' : 'Upload'}
                  </Button>
                  {avatarUrl && (
                    <Button danger loading={busy === 'avatar'} onClick={() => void removeAvatar()}>
                      Remove
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Form.Item>
        </Form>
      ),
    },
    {
      key: 'addresses',
      label: 'Addresses',
      children: (
        <Form layout="vertical">
          <Form.Item label="Aliases">
            {knownAliases.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {knownAliases.map((alias) => (
                  <div key={alias} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1 }}>{alias}</span>
                    {alias === room.getCanonicalAlias() ? (
                      <Tag color="blue">Canonical</Tag>
                    ) : (
                      canAlias && (
                        <Button size="small" onClick={() => void makeCanonical(alias)}>
                          Make canonical
                        </Button>
                      )
                    )}
                    {canAlias && (
                      <Button
                        size="small"
                        danger
                        icon={<CloseOutlined />}
                        onClick={() => void removeAlias(alias)}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ opacity: 0.65, marginBottom: 8 }}>
                No aliases published for this {kind.toLowerCase()}.
              </div>
            )}
            {canAlias && (
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  value={newAlias}
                  placeholder="alias-name"
                  prefix="#"
                  suffix={`:${server}`}
                  onChange={(event) => setNewAlias(event.target.value)}
                  onPressEnter={() => void addAlias()}
                />
                <Button
                  icon={<PlusOutlined />}
                  loading={busy === 'alias'}
                  onClick={() => void addAlias()}
                >
                  Add
                </Button>
              </div>
            )}
          </Form.Item>
        </Form>
      ),
    },
    {
      key: 'access',
      label: 'Access & visibility',
      children: (
        <Form layout="vertical">
          <Form.Item label="Who can join">
            <Select
              value={joinRule}
              disabled={!canJoinRules}
              style={{ width: '100%' }}
              loading={busy === 'joinrule'}
              onChange={(value) => void saveJoinRule(value)}
              options={Object.values(JoinRule)
                .filter((rule) => rule !== JoinRule.Private)
                .map((rule) => ({ value: rule, label: JOIN_RULE_LABELS[rule] }))}
            />
            {restricted && (
              <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>
                This {kind.toLowerCase()} is not inside a Space, so "Space members only" has no
                members to allow in - add it to a Space first.
              </div>
            )}
          </Form.Item>
          <Form.Item label="Guest access">
            <Switch
              checked={guestAccess}
              disabled={!canGuestAccess}
              loading={busy === 'guest'}
              onChange={(value) => void saveGuestAccess(value)}
            />{' '}
            <span style={{ marginLeft: 8 }}>Allow guest accounts to join</span>
          </Form.Item>
          <Form.Item label="Who can read history">
            <Select
              value={historyVisibility}
              disabled={!canHistoryVisibility}
              style={{ width: '100%' }}
              loading={busy === 'history'}
              onChange={(value) => void saveHistoryVisibility(value)}
              options={Object.values(HistoryVisibility).map((value) => ({
                value,
                label: HISTORY_VISIBILITY_LABELS[value],
              }))}
            />
          </Form.Item>
        </Form>
      ),
    },
    {
      key: 'encryption',
      label: 'Encryption',
      children: (
        <>
          <p>
            {encrypted
              ? 'This room is encrypted with Megolm. Once enabled, encryption cannot be turned back off - this is a Matrix protocol rule, not a FoxChat limitation.'
              : 'Messages in this room are not end-to-end encrypted.'}
          </p>
          {canEncryption && (
            <Button loading={busy === 'encryption'} onClick={() => void enableEncryption()}>
              Enable encryption
            </Button>
          )}
        </>
      ),
    },
    ...(canUpgrade
      ? [
          {
            key: 'danger',
            label: 'Danger zone',
            children: (
              <>
                <p>
                  Current room version: <b>{room.getVersion()}</b>
                  {defaultRoomVersion && defaultRoomVersion !== room.getVersion()
                    ? ` · server default: ${defaultRoomVersion}`
                    : ''}
                  . Upgrading creates a brand-new room and points this one at it - members are not
                  moved automatically and must rejoin.
                </p>
                <Button
                  danger
                  icon={<WarningOutlined />}
                  loading={busy === 'upgrade'}
                  disabled={!defaultRoomVersion || defaultRoomVersion === room.getVersion()}
                  onClick={upgradeRoom}
                >
                  Upgrade room
                </Button>
              </>
            ),
          },
        ]
      : []),
  ]

  return (
    <div>
      <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
        <Descriptions.Item label="Matrix ID">{room.roomId}</Descriptions.Item>
      </Descriptions>
      <Collapse items={panels} defaultActiveKey={['profile']} />
    </div>
  )
}
