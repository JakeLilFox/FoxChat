import { MemberAvatar } from '../profile'
import { effectivePowerLevel } from '../../lib/roleHelpers'
import { useEffect, useState } from 'react'
import { Button, Divider, Form, Input, App as AntApp, List as AntList } from 'antd'
import { EventType, Room } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'

export function SpaceInvitations({ space }: { space: Room }) {
  const { message } = AntApp.useApp()
  const client = matrixService.clientForRoom(space.roomId)
  const userId = client?.getUserId()
  const [invitee, setInvitee] = useState('')
  const [busy, setBusy] = useState<string>()
  const [, refresh] = useState(0)
  useEffect(() => {
    let cancelled = false
    void space.loadMembersIfNeeded().then(() => {
      if (!cancelled) refresh((value) => value + 1)
    })
    return () => {
      cancelled = true
    }
  }, [space])
  const power = space.currentState.getStateEvents(EventType.RoomPowerLevels, '')?.getContent() ?? {}
  const ownLevel = userId ? effectivePowerLevel(space, userId) : 0
  const canInvite =
    space.getMyMembership() === 'join' &&
    ownLevel >= (typeof power.invite === 'number' ? power.invite : 50)
  const canKick =
    space.getMyMembership() === 'join' &&
    ownLevel >= (typeof power.kick === 'number' ? power.kick : 50)
  const pending = space
    .getMembersWithMembership('invite')
    .filter((member) => member.userId !== userId)
  const accept = async () => {
    if (!client) return
    setBusy('accept')
    try {
      await client.joinRoom(space.roomId)
      message.success(`Joined ${space.name}`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not accept Space invitation')
    } finally {
      setBusy(undefined)
    }
  }
  const invite = async () => {
    if (!client || !invitee.trim()) return
    setBusy('invite')
    try {
      await client.invite(space.roomId, invitee.trim())
      setInvitee('')
      refresh((value) => value + 1)
      message.success(`Invited ${invitee.trim()}`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not invite user')
    } finally {
      setBusy(undefined)
    }
  }
  const revoke = async (target: string) => {
    if (!client) return
    setBusy(target)
    try {
      await client.kick(space.roomId, target, 'Invitation revoked')
      refresh((value) => value + 1)
      message.success('Invitation revoked')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not revoke invitation')
    } finally {
      setBusy(undefined)
    }
  }
  return (
    <div>
      <h2>Space invitations</h2>
      {space.getMyMembership() === 'invite' && (
        <>
          <p>You have been invited to this Space.</p>
          <Button type="primary" loading={busy === 'accept'} onClick={() => void accept()}>
            Accept invitation
          </Button>
          <Divider />
        </>
      )}
      {canInvite && (
        <>
          <Form layout="vertical" onFinish={() => void invite()}>
            <Form.Item label="Invite a Matrix user">
              <Input
                value={invitee}
                onChange={(event) => setInvitee(event.target.value)}
                placeholder="@user:example.org"
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              disabled={!/^@.+:.+$/.test(invitee.trim())}
              loading={busy === 'invite'}
            >
              Invite to Space
            </Button>
          </Form>
          <Divider />
        </>
      )}
      <h3>Pending invitations</h3>
      <AntList
        bordered
        dataSource={pending}
        locale={{ emptyText: 'No pending invitations' }}
        renderItem={(member) => (
          <AntList.Item
            actions={
              canKick
                ? [
                    <Button
                      key="revoke"
                      danger
                      loading={busy === member.userId}
                      onClick={() => void revoke(member.userId)}
                    >
                      Revoke
                    </Button>,
                  ]
                : undefined
            }
          >
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
          </AntList.Item>
        )}
      />
    </div>
  )
}
