import {
  CHAT_FONT_SIZE_KEY,
  applyChatFontSize,
  chatFontSizeFromStorage,
} from '../../../lib/constants'
import { useState } from 'react'
import { InputNumber, List as AntList } from 'antd'

export function ChatFontSizeSetting() {
  const [fontSize, setFontSize] = useState(chatFontSizeFromStorage)
  const change = (value: number | null) => {
    if (value === null) return
    const next = Math.min(18, Math.max(11, value))
    setFontSize(next)
    localStorage.setItem(CHAT_FONT_SIZE_KEY, String(next))
    applyChatFontSize(next)
  }
  return (
    <AntList.Item
      extra={
        <InputNumber
          min={11}
          max={18}
          value={fontSize}
          addonAfter="px"
          onChange={change}
          aria-label="Chat font size"
        />
      }
    >
      <AntList.Item.Meta
        title="Chat size"
        description="Change the font size of messages in chats."
      />
    </AntList.Item>
  )
}
