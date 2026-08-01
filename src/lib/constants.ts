export type ThemeMode = 'light' | 'dark'
export type AuthState = 'loading' | 'guest' | 'syncing' | 'ready'
export type VoiceSystemNotice = {
  id: string
  roomId: string
  text: string
  timestamp: number
}
export const voiceSystemNoticeEvent = 'foxchat-voice-system-notice'

export const colors = ['#7357e8', '#e66c74', '#4d8dea', '#13b89c', '#d89546', '#e45e7d']
export const initials = (name: string) =>
  name
    .replace(/^#/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join('')
    .toUpperCase() || '?'
export const colorFor = (value: string) =>
  colors[Math.abs([...value].reduce((n, c) => n + c.charCodeAt(0), 0)) % colors.length]
export const timezoneOptions = () => {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[]
  }
  const zones = intl.supportedValuesOf?.('timeZone') ?? [
    'UTC',
    'Europe/Berlin',
    'Europe/London',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Kolkata',
    'Australia/Sydney',
  ]
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone
  return [...new Set([local, 'UTC', ...zones].filter(Boolean))].map((zone) => ({
    value: zone,
    label: zone.replaceAll('_', ' '),
  }))
}
export const TIMEZONE_OPTIONS = timezoneOptions()
export const BUILD_VERSION = import.meta.env.VITE_BUILD_VERSION || 'development'
export const CHAT_FONT_SIZE_KEY = 'foxchat.chatFontSize'
export const DEFAULT_CHAT_FONT_SIZE = 13
export const chatFontSizeFromStorage = () => {
  const value = Number(localStorage.getItem(CHAT_FONT_SIZE_KEY))
  return Number.isFinite(value) && value >= 11 && value <= 18 ? value : DEFAULT_CHAT_FONT_SIZE
}
export const applyChatFontSize = (value: number) =>
  document.documentElement.style.setProperty('--foxchat-chat-font-size', `${value}px`)
applyChatFontSize(chatFontSizeFromStorage())
export const MICROPHONE_DEVICE_KEY = 'foxchat.microphoneDeviceId'
export const preferredMicrophoneId = () => localStorage.getItem(MICROPHONE_DEVICE_KEY) || undefined
export const MICROPHONE_VOLUME_KEY = 'foxchat.microphoneVolumePercent'
export const MICROPHONE_VOLUME_CHANGED_EVENT = 'foxchat-microphone-volume-changed'
export const clampMicrophoneVolumePercent = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.min(200, value)) : 100
export const microphoneVolumePercent = () => {
  const stored = localStorage.getItem(MICROPHONE_VOLUME_KEY)
  return stored === null ? 100 : clampMicrophoneVolumePercent(Number(stored))
}
export type VoiceInputMode = 'open' | 'voice_activation' | 'push_to_talk'
export type VoiceActivationThresholdMode = 'automatic' | 'manual'
export const VOICE_INPUT_MODE_KEY = 'foxchat.voiceInputMode'
export const VOICE_INPUT_MODE_CHANGED_EVENT = 'foxchat-voice-input-mode-changed'
export const VOICE_ACTIVATION_KEY = 'foxchat.voiceActivation'
export const voiceActivationEnabled = () => localStorage.getItem(VOICE_ACTIVATION_KEY) === 'true'
export const VOICE_ACTIVATION_CHANGED_EVENT = 'foxchat-voice-activation-changed'
export const voiceInputMode = (): VoiceInputMode => {
  const value = localStorage.getItem(VOICE_INPUT_MODE_KEY)
  if (value === 'open' || value === 'voice_activation' || value === 'push_to_talk') return value
  return voiceActivationEnabled() ? 'voice_activation' : 'open'
}
export const VOICE_ACTIVATION_THRESHOLD_MODE_KEY = 'foxchat.voiceActivationThresholdMode'
export const VOICE_ACTIVATION_THRESHOLD_KEY = 'foxchat.voiceActivationThresholdDb'
export const VOICE_ACTIVATION_THRESHOLD_CHANGED_EVENT = 'foxchat-voice-activation-threshold-changed'
export const voiceActivationThresholdMode = (): VoiceActivationThresholdMode =>
  localStorage.getItem(VOICE_ACTIVATION_THRESHOLD_MODE_KEY) === 'manual' ? 'manual' : 'automatic'
export const voiceActivationThresholdDb = () => {
  const value = Number(localStorage.getItem(VOICE_ACTIVATION_THRESHOLD_KEY))
  return Number.isFinite(value) && value >= -90 && value <= -10 ? value : -50
}
export const VOICE_ACTIVATION_PREROLL_KEY = 'foxchat.voiceActivationPrerollMs'
export const VOICE_ACTIVATION_PREROLL_CHANGED_EVENT = 'foxchat-voice-activation-preroll-changed'
export const voiceActivationPrerollMs = () => {
  const value = Number(localStorage.getItem(VOICE_ACTIVATION_PREROLL_KEY))
  return value === 100 || value === 200 || value === 300 || value === 350 || value === 500
    ? value
    : 350
}
export const PUSH_TO_TALK_SHORTCUT_KEY = 'foxchat.pushToTalkShortcut'
export const PUSH_TO_TALK_SHORTCUT_CHANGED_EVENT = 'foxchat-push-to-talk-shortcut-changed'
export const pushToTalkShortcut = () =>
  localStorage.getItem(PUSH_TO_TALK_SHORTCUT_KEY) || 'CapsLock'
export const OWN_MESSAGES_ON_RIGHT_KEY = 'foxchat.ownMessagesOnRight'
export const ownMessagesOnRight = () => localStorage.getItem(OWN_MESSAGES_ON_RIGHT_KEY) !== 'false'
export const OWN_MESSAGES_ON_RIGHT_CHANGED_EVENT = 'foxchat-own-messages-on-right-changed'
export const ANONYMIZE_FILENAME_KEY = 'foxchat.anonymizeFilenameDefault'
export const anonymizeFilenameDefault = () =>
  localStorage.getItem(ANONYMIZE_FILENAME_KEY) === 'true'
export const ANONYMIZE_FILENAME_CHANGED_EVENT = 'foxchat-anonymize-filename-changed'
export const AUTO_SYNC_SPACE_ROLES_KEY = 'foxchat.autoSyncSpaceRoles'
export const autoSyncSpaceRolesDefault = () =>
  localStorage.getItem(AUTO_SYNC_SPACE_ROLES_KEY) === 'true'
export type TimelineAppearanceSettings = {
  roomMembership: boolean
  voiceMembership: boolean
  displayName: boolean
  avatar: boolean
}
export const TIMELINE_APPEARANCE_KEYS = {
  roomMembership: 'foxchat.timeline.showRoomMembership',
  voiceMembership: 'foxchat.timeline.showVoiceMembership',
  displayName: 'foxchat.timeline.showDisplayNameUpdates',
  avatar: 'foxchat.timeline.showAvatarUpdates',
} satisfies Record<keyof TimelineAppearanceSettings, string>
export const TIMELINE_APPEARANCE_CHANGED_EVENT = 'foxchat-timeline-appearance-changed'
export const timelineAppearanceSettings = (): TimelineAppearanceSettings => ({
  roomMembership: localStorage.getItem(TIMELINE_APPEARANCE_KEYS.roomMembership) !== 'false',
  voiceMembership: localStorage.getItem(TIMELINE_APPEARANCE_KEYS.voiceMembership) !== 'false',
  displayName: localStorage.getItem(TIMELINE_APPEARANCE_KEYS.displayName) !== 'false',
  avatar: localStorage.getItem(TIMELINE_APPEARANCE_KEYS.avatar) !== 'false',
})
export const VOICE_CHANNEL_ROOM_TYPE = 'org.matrix.msc3417.call'
export type ScreenShareResolution = '720p' | '1080p' | '1440p' | '2160p' | 'source'
export type ScreenShareFrameRate = 15 | 30 | 60 | 'source'
export type ScreenShareContentHint = 'detail' | 'motion'
export const SCREEN_SHARE_QUALITY_KEY = 'foxchat.screenShareQuality'
export const SCREEN_SHARE_RESOLUTION_KEY = 'foxchat.screenShareResolution'
export const SCREEN_SHARE_FRAME_RATE_KEY = 'foxchat.screenShareFrameRate'
export const SCREEN_SHARE_CONTENT_HINT_KEY = 'foxchat.screenShareContentHint'
export const SCREEN_SHARE_CURSOR_KEY = 'foxchat.screenShareCursor'
export const SCREEN_SHARE_BITRATE_KEY = 'foxchat.screenShareBitrateKbps'
export const preferredScreenShareResolution = (): ScreenShareResolution => {
  const value = localStorage.getItem(SCREEN_SHARE_RESOLUTION_KEY)
  if (
    value === '720p' ||
    value === '1080p' ||
    value === '1440p' ||
    value === '2160p' ||
    value === 'source'
  )
    return value
  const legacy = localStorage.getItem(SCREEN_SHARE_QUALITY_KEY)
  return legacy === 'standard' ? '720p' : legacy === 'high' ? '1080p' : 'source'
}
export const preferredScreenShareFrameRate = (): ScreenShareFrameRate => {
  const value = localStorage.getItem(SCREEN_SHARE_FRAME_RATE_KEY)
  if (value === '15' || value === '30' || value === '60') return Number(value) as 15 | 30 | 60
  if (value === 'source') return 'source'
  const legacy = localStorage.getItem(SCREEN_SHARE_QUALITY_KEY)
  return legacy === 'standard' ? 15 : legacy === 'high' ? 30 : 'source'
}
export const preferredScreenShareContentHint = (): ScreenShareContentHint =>
  localStorage.getItem(SCREEN_SHARE_CONTENT_HINT_KEY) === 'motion' ? 'motion' : 'detail'
export const screenShareCursorEnabled = () =>
  localStorage.getItem(SCREEN_SHARE_CURSOR_KEY) !== 'false'
export const preferredScreenShareBitrate = () => {
  const value = Number(localStorage.getItem(SCREEN_SHARE_BITRATE_KEY))
  return Number.isFinite(value) && value >= 500 && value <= 20_000 ? value : 6_000
}
