import { colorFor, initials } from '../../../lib/constants'
import { useState } from 'react'
import { Avatar, Button, App as AntApp, List as AntList } from 'antd'
import { matrixService } from '../../../matrix/MatrixClientService'

export function BlockedUsersSettings() {
  const { message } = AntApp.useApp()
  const [users, setUsers] = useState(() => matrixService.getBlockedUsers())
  const [busy, setBusy] = useState<string>()
  const unblock = async (userId: string) => {
    setBusy(userId)
    try {
      await matrixService.setUserBlocked(userId, false)
      setUsers(matrixService.getBlockedUsers())
      message.success(`${userId} unblocked`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not unblock user')
    } finally {
      setBusy(undefined)
    }
  }
  return (
    <div>
      <h2>Blocked users</h2>
      <p>Messages and invitations from blocked Matrix users are ignored for this account.</p>
      <AntList
        bordered
        dataSource={users}
        locale={{ emptyText: 'You have not blocked anyone' }}
        renderItem={(userId) => (
          <AntList.Item
            actions={[
              <Button key="unblock" loading={busy === userId} onClick={() => void unblock(userId)}>
                Unblock
              </Button>,
            ]}
          >
            <AntList.Item.Meta
              avatar={<Avatar style={{ background: colorFor(userId) }}>{initials(userId)}</Avatar>}
              title={userId}
            />
          </AntList.Item>
        )}
      />
    </div>
  )
}
