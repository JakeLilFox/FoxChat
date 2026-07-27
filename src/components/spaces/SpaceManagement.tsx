import { RoomAvatar } from '../rooms'
import { AUTO_SYNC_SPACE_ROLES_KEY, VOICE_CHANNEL_ROOM_TYPE } from '../../lib/constants'
import { roomTopic } from '../../lib/eventHelpers'
import { compareSpaceChildren } from '../../lib/spaceHelpers'
import { Preview } from '../../styles'
import { useState } from 'react'
import {
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Switch,
  Tooltip,
  App as AntApp,
  List as AntList,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { EventType, Preset, Room, Visibility } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

export function SpaceManagement({ space }: { space: Room }) {
  const { message, modal } = AntApp.useApp()
  const client = matrixService.clientForRoom(space.roomId)
  const userId = client?.getUserId()
  const canManage = !!userId && space.currentState.maySendStateEvent(EventType.SpaceChild, userId)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [topic, setTopic] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [encrypted, setEncrypted] = useState(false)
  const [voiceChannel, setVoiceChannel] = useState(false)
  const [federated, setFederated] = useState(true)
  const [busy, setBusy] = useState<string>()
  const [drag, setDrag] = useState<{
    source: string
    target?: string
    edge?: 'before' | 'after'
  }>()
  const [, refresh] = useState(0)
  const children = space.currentState
    .getStateEvents(EventType.SpaceChild)
    .filter((event) => Array.isArray(event.getContent().via))
    .map((event) => ({
      id: event.getStateKey() ?? '',
      content: event.getContent<Record<string, unknown>>(),
      room:
        client?.getRoom(event.getStateKey() ?? '') ?? matrixService.room(event.getStateKey() ?? ''),
    }))
    .filter((item) => item.id)
    .sort((a, b) =>
      compareSpaceChildren(
        space,
        { roomId: a.id, name: a.room?.name },
        { roomId: b.id, name: b.room?.name },
      ),
    )
  const sendChild = (id: string, content: Record<string, unknown>) => {
    if (!client) throw new Error('Space account is unavailable')
    return (
      client.sendStateEvent as unknown as (
        roomId: string,
        type: string,
        content: Record<string, unknown>,
        stateKey: string,
      ) => Promise<unknown>
    )(space.roomId, EventType.SpaceChild, content, id)
  }
  const create = async () => {
    if (!client || !name.trim()) return
    setBusy('create')
    try {
      const domain = space.roomId.split(':').slice(1).join(':')
      const result = await client.createRoom({
        name: name.trim(),
        topic: topic.trim() || undefined,
        visibility: isPublic ? Visibility.Public : Visibility.Private,
        preset: isPublic ? Preset.PublicChat : Preset.PrivateChat,
        initial_state: [
          {
            type: EventType.SpaceParent,
            state_key: space.roomId,
            content: { via: [domain], canonical: true },
          },
          ...(encrypted
            ? [
                {
                  type: EventType.RoomEncryption,
                  state_key: '',
                  content: { algorithm: 'm.megolm.v1.aes-sha2' },
                },
              ]
            : []),
        ],
        creation_content: {
          ...(voiceChannel ? { type: VOICE_CHANNEL_ROOM_TYPE } : {}),
          'm.federate': federated,
        },
        room_type: voiceChannel ? VOICE_CHANNEL_ROOM_TYPE : undefined,
      } as any)
      await sendChild(result.room_id, { via: [domain], suggested: true })
      if (localStorage.getItem(AUTO_SYNC_SPACE_ROLES_KEY) === 'true') {
        try {
          await matrixService.applyCurrentSpaceRolesToRoom(space.roomId, result.room_id)
        } catch (error) {
          message.error(
            error instanceof Error
              ? `Channel created, but could not apply the Space's permissions: ${error.message}`
              : "Channel created, but could not apply the Space's permissions",
          )
        }
      }
      setName('')
      setTopic('')
      setIsPublic(false)
      setEncrypted(false)
      setVoiceChannel(false)
      setFederated(true)
      setCreating(false)
      refresh((value) => value + 1)
      message.success('Channel created')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not create channel')
    } finally {
      setBusy(undefined)
    }
  }
  const saveOrder = async (next: typeof children) => {
    setBusy('order')
    try {
      await Promise.all(
        next.map((item, index) =>
          sendChild(item.id, {
            ...item.content,
            order: index.toString().padStart(5, '0'),
          }),
        ),
      )
      refresh((value) => value + 1)
      message.success('Channel order updated')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not reorder channels')
    } finally {
      setBusy(undefined)
      setDrag(undefined)
    }
  }
  const drop = (targetId: string, edge: 'before' | 'after') => {
    const sourceId = drag?.source
    if (!sourceId || sourceId === targetId) {
      setDrag(undefined)
      return
    }
    const next = children.filter((item) => item.id !== sourceId)
    const source = children.find((item) => item.id === sourceId)
    const targetIndex = next.findIndex((item) => item.id === targetId)
    if (!source || targetIndex < 0) {
      setDrag(undefined)
      return
    }
    next.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, source)
    void saveOrder(next)
  }
  const remove = (item: (typeof children)[number]) =>
    modal.confirm({
      title: `Remove ${item.room?.name || item.id} from this Space?`,
      content:
        'This removes the channel from the Space hierarchy. Matrix does not support deleting a room from the server.',
      okText: 'Remove channel',
      okButtonProps: { danger: true },
      onOk: async () => {
        await sendChild(item.id, {})
        refresh((value) => value + 1)
        message.success('Channel removed from Space')
      },
    })
  if (!canManage)
    return <Empty description="You do not have permission to manage channels in this Space" />
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Channels</h2>
          <Preview>Drag channels to change their order.</Preview>
        </div>
        <Tooltip title="Create channel">
          <Button
            type="primary"
            shape="circle"
            icon={<PlusOutlined />}
            onClick={() => setCreating(true)}
          />
        </Tooltip>
      </div>
      <AntList
        bordered
        dataSource={children}
        locale={{ emptyText: 'No channels in this Space' }}
        renderItem={(item) => {
          const edge = drag?.target === item.id ? drag.edge : undefined
          return (
            <div
              draggable={busy !== 'order'}
              onDragStart={(event) => {
                setDrag({ source: item.id })
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => setDrag(undefined)}
              onDragOver={(event) => {
                if (!drag?.source || drag.source === item.id) return
                event.preventDefault()
                const bounds = event.currentTarget.getBoundingClientRect()
                const nextEdge = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
                setDrag((current) =>
                  current?.target === item.id && current.edge === nextEdge
                    ? current
                    : { source: drag.source, target: item.id, edge: nextEdge },
                )
              }}
              onDrop={(event) => {
                event.preventDefault()
                drop(item.id, edge ?? 'before')
              }}
              style={{
                borderTop: edge === 'before' ? '3px solid #7357e8' : undefined,
                borderBottom: edge === 'after' ? '3px solid #7357e8' : undefined,
                opacity: drag?.source === item.id ? 0.45 : 1,
                cursor: 'grab',
              }}
            >
              <AntList.Item
                actions={[
                  <Button
                    key="remove"
                    size="small"
                    danger
                    disabled={busy === 'order'}
                    onClick={() => remove(item)}
                  >
                    Remove
                  </Button>,
                ]}
              >
                <AntList.Item.Meta
                  avatar={item.room ? <RoomAvatar room={item.room} size={36} /> : undefined}
                  title={item.room?.name || item.id}
                  description={(item.room && roomTopic(item.room)) || item.id}
                />
              </AntList.Item>
            </div>
          )
        }}
      />
      <Modal
        title="Create channel"
        open={creating}
        footer={null}
        onCancel={() => !busy && setCreating(false)}
        destroyOnHidden
      >
        <Form layout="vertical" onFinish={() => void create()}>
          <Form.Item label="Channel name" required>
            <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          </Form.Item>
          <Form.Item label="Description">
            <Input.TextArea value={topic} onChange={(event) => setTopic(event.target.value)} />
          </Form.Item>
          <Form.Item>
            <Switch checked={isPublic} onChange={setIsPublic} />{' '}
            <span style={{ marginLeft: 8 }}>Public channel</span>
          </Form.Item>
          <Form.Item extra="Allow people from other Matrix servers to join. This cannot be enabled later.">
            <Switch checked={federated} onChange={setFederated} />{' '}
            <span style={{ marginLeft: 8 }}>Allow federation</span>
          </Form.Item>
          <Form.Item>
            <Switch checked={encrypted} onChange={setEncrypted} />{' '}
            <span style={{ marginLeft: 8 }}>Encrypt this channel</span>
          </Form.Item>
          <Form.Item>
            <Switch checked={voiceChannel} onChange={setVoiceChannel} />{' '}
            <span style={{ marginLeft: 8 }}>Voice channel · this can't be changed later</span>
          </Form.Item>
          <Button
            block
            type="primary"
            htmlType="submit"
            disabled={!name.trim()}
            loading={busy === 'create'}
          >
            Create channel
          </Button>
        </Form>
      </Modal>
    </div>
  )
}
