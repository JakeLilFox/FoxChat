import { matrixService } from '../../../matrix/MatrixClientService'
import { Alert, Button, Form, Input, Switch, Tag, App as AntApp } from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import { Room } from 'matrix-js-sdk'
import { useState } from 'react'

type ServerAclContent = {
  allow?: string[]
  deny?: string[]
  allow_ip_literals?: boolean
}

const parsePatterns = (value: string) => [
  ...new Set(
    value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
]

const matchesServer = (pattern: string, server: string) => {
  const host = server.startsWith('[')
    ? server.slice(1, server.indexOf(']'))
    : server.replace(/:\d+$/, '')
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${expression}$`, 'i').test(host)
}

export function RoomFederationSettings({ room }: { room: Room }) {
  const { message } = AntApp.useApp()
  const client = matrixService.clientForRoomInstance(room)
  const userId = client?.getSafeUserId() ?? ''
  const ownServer = userId.split(':').slice(1).join(':')
  const createContent = room.currentState
    .getStateEvents('m.room.create', '')
    ?.getContent<Record<string, unknown>>()
  const federated = createContent?.['m.federate'] !== false
  const event = room.currentState.getStateEvents('m.room.server_acl', '')
  const content = event?.getContent<ServerAclContent>() ?? {}
  const canEdit =
    !!userId && room.currentState.maySendStateEvent('m.room.server_acl' as never, userId)
  const [allow, setAllow] = useState(() => (content.allow ?? (event ? [] : ['*'])).join('\n'))
  const [deny, setDeny] = useState(() => (content.deny ?? []).join('\n'))
  const [allowIpLiterals, setAllowIpLiterals] = useState(
    event ? content.allow_ip_literals !== false : false,
  )
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!client || !canEdit) return
    const allowed = parsePatterns(allow)
    const denied = parsePatterns(deny)
    if (!allowed.length) {
      message.error('At least one allowed-server pattern is required')
      return
    }
    const ownServerAllowed =
      allowed.some((pattern) => matchesServer(pattern, ownServer)) &&
      !denied.some((pattern) => matchesServer(pattern, ownServer))
    if (!ownServerAllowed) {
      message.error(`The ACL must continue to allow this account's homeserver (${ownServer})`)
      return
    }
    setSaving(true)
    try {
      await client.sendStateEvent(
        room.roomId,
        'm.room.server_acl' as never,
        {
          allow: allowed,
          deny: denied,
          allow_ip_literals: allowIpLiterals,
        } as never,
        '',
      )
      message.success('Server ACL updated')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not update the server ACL')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h2>Federation and server access</h2>
      <p>
        Federation lets homeservers exchange this room’s events. Server ACLs restrict which remote
        Matrix servers may participate; deny patterns take precedence over allow patterns.
      </p>
      <p>
        Federation status:{' '}
        <Tag color={federated ? 'success' : 'error'}>{federated ? 'Enabled' : 'Disabled'}</Tag>
        Server ACL:{' '}
        <Tag color={event ? 'blue' : 'default'}>
          {event ? 'Configured' : 'Not configured · all servers allowed'}
        </Tag>
      </p>
      {!federated && (
        <Alert
          type="info"
          showIcon
          message="Federation was disabled when this room was created"
          description="The m.federate creation setting is immutable. This room cannot be made federated without creating or upgrading to a new room."
          style={{ marginBottom: 18 }}
        />
      )}
      {!canEdit && (
        <Alert
          type="warning"
          showIcon
          message="Read-only"
          description="Your power level does not permit sending m.room.server_acl state events."
          style={{ marginBottom: 18 }}
        />
      )}
      <Form layout="vertical">
        {canEdit && federated && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              marginBottom: 16,
            }}
          >
            <Button onClick={() => setAllow('*')}>Allow all except denied</Button>
            <Button
              onClick={() => {
                setAllow(ownServer)
                setDeny('')
              }}
            >
              Restrict to {ownServer}
            </Button>
          </div>
        )}
        <Form.Item
          label="Allowed servers"
          extra="One case-insensitive glob per line. * matches any sequence and ? matches one character."
        >
          <Input.TextArea
            value={allow}
            onChange={(event) => setAllow(event.target.value)}
            disabled={!canEdit || !federated}
            autoSize={{ minRows: 4, maxRows: 10 }}
            placeholder={'*\n*.example.org'}
          />
        </Form.Item>
        <Form.Item label="Denied servers" extra="Denied patterns override allowed patterns.">
          <Input.TextArea
            value={deny}
            onChange={(event) => setDeny(event.target.value)}
            disabled={!canEdit || !federated}
            autoSize={{ minRows: 4, maxRows: 10 }}
            placeholder={'bad.example.org\n*.blocked.example'}
          />
        </Form.Item>
        <Form.Item label="Literal IP addresses">
          <Switch
            checked={allowIpLiterals}
            onChange={setAllowIpLiterals}
            disabled={!canEdit || !federated}
          />{' '}
          <span style={{ marginLeft: 8 }}>
            Allow server names written directly as IPv4 or IPv6 addresses
          </span>
        </Form.Item>
        <Alert
          type="warning"
          showIcon
          message="ACL mistakes can break federation for this room"
          description={`FoxChat will prevent saving rules that block your current homeserver (${ownServer}), but another administrator can still publish conflicting rules.`}
          style={{ marginBottom: 16 }}
        />
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          disabled={!canEdit || !federated}
          onClick={() => void save()}
        >
          Save server ACL
        </Button>
      </Form>
    </div>
  )
}
