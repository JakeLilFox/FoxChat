import {
  type RoomAction,
  roomActionFromUrl,
  roomIdFromUrl,
  setRoomActionUrl,
  writeRoomUrl,
} from '../../lib/urlState'
import { useEffect, useState } from 'react'
import { Button, Form, Input, Modal, Select, Switch, App as AntApp } from 'antd'
import { matrixService } from '../../matrix/MatrixClientService'

export function RoomActionsHost() {
  const { message } = AntApp.useApp()
  const [action, setAction] = useState<RoomAction | undefined>(roomActionFromUrl)
  const [inviteRoomId, setInviteRoomId] = useState<string>()
  const [joinHint, setJoinHint] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm()
  const accounts = matrixService.availableAccounts()
  const currentRoomId = roomIdFromUrl()
  const targetRoomId = action === 'invite' ? (inviteRoomId ?? currentRoomId) : currentRoomId
  const roomAccounts = targetRoomId ? matrixService.roomAccounts(targetRoomId) : []
  useEffect(() => {
    const navigate = () => {
      const next = roomActionFromUrl()
      setAction(next)
      if (next !== 'invite') setInviteRoomId(undefined)
      if (next !== 'join') setJoinHint(undefined)
    }
    const invite = (event: Event) => {
      setInviteRoomId((event as CustomEvent<string>).detail)
      setRoomActionUrl('invite')
    }
    const join = (event: Event) => {
      setJoinHint((event as CustomEvent<string>).detail)
      setRoomActionUrl('join')
    }
    window.addEventListener('popstate', navigate)
    window.addEventListener('foxchat-room-action', navigate)
    window.addEventListener('foxchat-invite-to-room', invite)
    window.addEventListener('foxchat-join-room', join)
    navigate()
    return () => {
      window.removeEventListener('popstate', navigate)
      window.removeEventListener('foxchat-room-action', navigate)
      window.removeEventListener('foxchat-invite-to-room', invite)
      window.removeEventListener('foxchat-join-room', join)
    }
  }, [])
  useEffect(() => {
    if (!action) return
    const eligible =
      action === 'invite' && targetRoomId
        ? matrixService.roomAccounts(targetRoomId)
        : matrixService.availableAccounts()
    form.resetFields()
    form.setFieldValue(
      'accountId',
      (targetRoomId && matrixService.selectedRoomAccountId(targetRoomId)) ?? eligible[0]?.id,
    )
    if (action === 'create' || action === 'create-space') form.setFieldValue('federated', true)
    if (action === 'join' && joinHint) form.setFieldValue('room', joinHint)
  }, [action, targetRoomId, joinHint, form])
  const close = (force = false) => {
    if (busy && !force) return
    if (history.state?.foxchatRoomAction === action) history.back()
    else setRoomActionUrl(undefined, true)
  }
  const submit = async (values: {
    accountId: string
    room: string
    name: string
    topic?: string
    public?: boolean
    encrypted?: boolean
    voiceChannel?: boolean
    federated?: boolean
    userId: string
  }) => {
    setBusy(true)
    try {
      if (action === 'join') {
        const joined = await matrixService.joinRoomAs(values.room, values.accountId)
        message.success(`Joined ${joined.name}`)
        close(true)
      } else if (action === 'create') {
        const created = await matrixService.createRoomAs(
          values.accountId,
          values.name,
          values.topic,
          values.public,
          values.encrypted,
          values.voiceChannel,
          values.federated !== false,
        )
        message.success(`Created ${created.name}`)
        setRoomActionUrl(undefined, true)
        writeRoomUrl(created.roomId, false)
      } else if (action === 'create-space') {
        const created = await matrixService.createSpaceAs(
          values.accountId,
          values.name,
          values.topic,
          values.public,
          values.federated !== false,
        )
        message.success(`Created ${created.name}`)
        setRoomActionUrl(undefined, true)
        writeRoomUrl('browse', false, created.roomId)
      } else if (action === 'invite' && targetRoomId) {
        await matrixService.inviteToRoomAs(targetRoomId, values.userId, values.accountId)
        message.success(`Invited ${values.userId}`)
        close(true)
      } else if (action === 'create-dm') {
        const dm = await matrixService.createDMAs(values.accountId, values.userId)
        setRoomActionUrl(undefined, true)
        writeRoomUrl(dm.roomId, false)
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Room action failed')
    } finally {
      setBusy(false)
    }
  }
  const eligible = action === 'invite' ? roomAccounts : accounts
  const creating = action === 'create' || action === 'create-space'
  return (
    <Modal
      title={
        action === 'join'
          ? 'Join a room'
          : action === 'create'
            ? 'Create a room'
            : action === 'create-space'
              ? 'Create a Space'
              : action === 'create-dm'
                ? 'Start a DM'
                : 'Invite to room'
      }
      open={!!action}
      footer={null}
      onCancel={() => close()}
    >
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item name="accountId" label="Account" rules={[{ required: true }]}>
          <Select
            options={eligible.map((account) => ({
              value: account.id,
              label: account.userId,
            }))}
          />
        </Form.Item>
        {action === 'join' && (
          <Form.Item name="room" label="Room ID or alias" rules={[{ required: true }]}>
            <Input autoFocus placeholder="#room:example.org" />
          </Form.Item>
        )}
        {creating && (
          <>
            <Form.Item
              name="name"
              label={action === 'create-space' ? 'Space name' : 'Room name'}
              rules={[{ required: true }]}
            >
              <Input autoFocus />
            </Form.Item>
            <Form.Item name="topic" label="Description">
              <Input.TextArea />
            </Form.Item>
            <Form.Item
              name="public"
              label={`Public ${action === 'create-space' ? 'Space' : 'room'}`}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="federated"
              label="Allow federation"
              valuePropName="checked"
              extra={`Allow people from other Matrix servers to join this ${action === 'create-space' ? 'Space' : 'room'}. This cannot be enabled later.`}
            >
              <Switch />
            </Form.Item>

            {action === 'create' && (
              <>
                <Form.Item name="encrypted" label="Encrypt this room" valuePropName="checked">
                  <Switch />
                </Form.Item>

                <Form.Item
                  name="voiceChannel"
                  label="Voice channel · this can't be changed later"
                  valuePropName="checked"
                >
                  <Switch />
                </Form.Item>
              </>
            )}
          </>
        )}
        {(action === 'invite' || action === 'create-dm') && (
          <Form.Item
            name="userId"
            label="Matrix user ID"
            rules={[
              {
                required: true,
                pattern: /^@.+:.+$/,
                message: 'Enter a full Matrix ID',
              },
            ]}
          >
            <Input autoFocus placeholder="@user:example.org" />
          </Form.Item>
        )}
        <Button block type="primary" htmlType="submit" loading={busy}>
          {action === 'join'
            ? 'Join room'
            : action === 'create'
              ? 'Create room'
              : action === 'create-space'
                ? 'Create Space'
                : action === 'create-dm'
                  ? 'Start DM'
                  : 'Send invitation'}
        </Button>
      </Form>
    </Modal>
  )
}
