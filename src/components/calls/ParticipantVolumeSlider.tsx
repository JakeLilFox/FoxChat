import { Slider } from 'antd'
import { useState } from 'react'
import * as VoiceAudioMixer from './ElementCallAudioMixer'
import type { AudioSourceKind } from './ElementCallAudioMixer'

export function ParticipantVolumeSlider({
  userId,
  source,
  label,
}: {
  userId: string
  source: AudioSourceKind
  label: string
}) {
  const [value, setValue] = useState(() => VoiceAudioMixer.getUserVolume(userId, source))
  return (
    <div style={{ padding: '2px 4px', width: 210 }} onClick={(event) => event.stopPropagation()}>
      <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 4 }}>
        {label} · {value}%
      </div>
      <Slider
        ariaLabelForHandle={`${label} for ${userId}`}
        min={0}
        max={200}
        step={5}
        value={value}
        onChange={(next) => {
          setValue(next)
          VoiceAudioMixer.setUserVolume(userId, source, next)
        }}
      />
    </div>
  )
}
