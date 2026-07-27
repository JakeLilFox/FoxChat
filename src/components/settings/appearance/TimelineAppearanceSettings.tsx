import {
  TIMELINE_APPEARANCE_CHANGED_EVENT,
  TIMELINE_APPEARANCE_KEYS,
  type TimelineAppearanceSettings,
  timelineAppearanceSettings,
} from '../../../lib/constants'
import { useState } from 'react'
import { List as AntList, Switch } from 'antd'
import { matrixService } from '../../../matrix/MatrixClientService'
import { scheduleNativeCryptoSync } from '../../../platform/push'

const options: Array<{
  key: keyof TimelineAppearanceSettings
  title: string
  description: string
}> = [
  {
    key: 'roomMembership',
    title: 'Show joined / left room',
    description: 'Show when somebody joins or leaves a room.',
  },
  {
    key: 'voiceMembership',
    title: 'Show joined / left VC',
    description: 'Show when somebody joins or leaves a voice or video call.',
  },
  {
    key: 'displayName',
    title: 'Show name updates',
    description: 'Show when somebody changes their display name.',
  },
  {
    key: 'avatar',
    title: 'Show profile picture updates',
    description: 'Show when somebody changes their profile picture.',
  },
]

export function TimelineAppearanceSettings() {
  const [settings, setSettings] = useState(timelineAppearanceSettings)
  const toggle = (key: keyof TimelineAppearanceSettings, value: boolean) => {
    localStorage.setItem(TIMELINE_APPEARANCE_KEYS[key], String(value))
    const next = { ...settings, [key]: value }
    setSettings(next)
    window.dispatchEvent(new CustomEvent(TIMELINE_APPEARANCE_CHANGED_EVENT, { detail: next }))
    for (const { client } of matrixService.availableAccounts())
      scheduleNativeCryptoSync(client, 0, true)
  }
  return options.map((option) => (
    <AntList.Item
      key={option.key}
      extra={
        <Switch checked={settings[option.key]} onChange={(value) => toggle(option.key, value)} />
      }
    >
      <AntList.Item.Meta title={option.title} description={option.description} />
    </AntList.Item>
  ))
}
