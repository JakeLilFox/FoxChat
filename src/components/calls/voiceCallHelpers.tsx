import { type MenuProps } from 'antd'
import { AudioMutedOutlined, SoundOutlined } from '@ant-design/icons'
import * as VoiceAudioMixer from './ElementCallAudioMixer'
import type { AudioSourceKind } from './ElementCallAudioMixer'
import { ParticipantVolumeSlider } from './ParticipantVolumeSlider'

export type ElementCallMedia = {
  id: string
  stream: MediaStream
  label: string
  screen: boolean
  muted: boolean
  own: boolean
  userId?: string
}

const volumeSlider = (userId: string, source: AudioSourceKind, label: string) => ({
  key: `volume-${source}`,
  label: <ParticipantVolumeSlider userId={userId} source={source} label={label} />,
})

export const participantAudioMenu = (
  userId: string,
  refresh: () => void,
  hasScreenShare = VoiceAudioMixer.hasChannel(userId, 'screen_share_audio'),
) => {
  const screenMuted = VoiceAudioMixer.getScreenshareAudioMuted(userId)
  const items: NonNullable<MenuProps['items']> = [
    volumeSlider(userId, 'microphone', 'Microphone volume'),
    ...(hasScreenShare
      ? [
          { type: 'divider' as const },
          volumeSlider(userId, 'screen_share_audio', 'Screen share volume'),
          {
            key: 'mute-screen',
            label: screenMuted ? 'Unmute screen share audio' : 'Mute screen share audio',
            icon: screenMuted ? <SoundOutlined /> : <AudioMutedOutlined />,
            onClick: () => {
              VoiceAudioMixer.setScreenshareAudioMuted(userId, !screenMuted)
              refresh()
            },
          },
        ]
      : []),
  ]
  return { items }
}
