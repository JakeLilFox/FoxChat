import {
  AUTO_READ_ALL_ACCOUNTS_CHANGED_EVENT,
  matrixService,
} from '../../../matrix/MatrixClientService'
import { useEffect, useState } from 'react'
import { List as AntList, Switch } from 'antd'

export function AutoReadAllAccountsSetting() {
  const [enabled, setEnabled] = useState(() => matrixService.autoReadAllAccountsEnabled())
  useEffect(() => {
    const refresh = () => setEnabled(matrixService.autoReadAllAccountsEnabled())
    window.addEventListener(AUTO_READ_ALL_ACCOUNTS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(AUTO_READ_ALL_ACCOUNTS_CHANGED_EVENT, refresh)
  }, [])
  const toggle = (value: boolean) => {
    setEnabled(value)
    matrixService.setAutoReadAllAccountsEnabled(value)
  }
  return (
    <AntList.Item
      extra={
        <Switch aria-label="Read rooms with every account" checked={enabled} onChange={toggle} />
      }
    >
      <AntList.Item.Meta
        title="Read rooms with every account"
        description="When on (default), reading a message marks it read for every one of your accounts that's in that room. When off, only the currently selected 'sending as' account is marked read. The unread badge always reflects the selected account."
      />
    </AntList.Item>
  )
}
