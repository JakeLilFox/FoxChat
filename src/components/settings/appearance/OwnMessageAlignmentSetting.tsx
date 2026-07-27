import {
  OWN_MESSAGES_ON_RIGHT_CHANGED_EVENT,
  OWN_MESSAGES_ON_RIGHT_KEY,
  ownMessagesOnRight,
} from '../../../lib/constants'
import { useState } from 'react'
import { List as AntList, Switch } from 'antd'

export function OwnMessageAlignmentSetting() {
  const [onRight, setOnRight] = useState(ownMessagesOnRight)
  const toggle = (value: boolean) => {
    setOnRight(value)
    localStorage.setItem(OWN_MESSAGES_ON_RIGHT_KEY, String(value))
    window.dispatchEvent(new CustomEvent(OWN_MESSAGES_ON_RIGHT_CHANGED_EVENT, { detail: value }))
  }
  return (
    <AntList.Item extra={<Switch checked={onRight} onChange={toggle} />}>
      <AntList.Item.Meta
        title="Own messages on the right"
        description="Turn off to show your own messages on the left along with everyone else's, instead of on the right by themselves."
      />
    </AntList.Item>
  )
}
