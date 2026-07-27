import { AUTO_SYNC_SPACE_ROLES_KEY, autoSyncSpaceRolesDefault } from '../../../lib/constants'
import { useState } from 'react'
import { List as AntList, Switch } from 'antd'

export function AutoSyncSpaceRolesSetting() {
  const [autoSync, setAutoSync] = useState(autoSyncSpaceRolesDefault)
  const toggle = (value: boolean) => {
    setAutoSync(value)
    localStorage.setItem(AUTO_SYNC_SPACE_ROLES_KEY, String(value))
  }
  return (
    <AntList.Item extra={<Switch checked={autoSync} onChange={toggle} />}>
      <AntList.Item.Meta
        title="Auto-sync space permissions to new channels"
        description="When you create a channel inside a Space, immediately apply that Space's current roles and permissions to it. Off by default - channels only pick up Space permissions when someone next clicks 'Sync baseline' in the Space's Roles & permissions tab."
      />
    </AntList.Item>
  )
}
