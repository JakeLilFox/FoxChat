import type { RoomMember } from 'matrix-js-sdk'

export type AudioSourceKind = 'microphone' | 'screen_share_audio'

type MixerChannel = {
  context: AudioContext
  source: MediaStreamAudioSourceNode
  analyser: AnalyserNode
  gain: GainNode
  userId: string
  sourceKind: AudioSourceKind
}
type UserVolumeState = { micVolume: number; screenVolume: number; screenshareMuted: boolean }

const STORAGE_KEY = 'foxchat.voiceVolumes'
const DEFAULT_STATE: UserVolumeState = {
  micVolume: 100,
  screenVolume: 100,
  screenshareMuted: false,
}

const loadStore = (): Record<string, Partial<UserVolumeState>> => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<
      string,
      Partial<UserVolumeState>
    >
  } catch {
    return {}
  }
}

let store = loadStore()
const persist = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* storage may be unavailable (private browsing quota) */
  }
}

const stateFor = (userId: string): UserVolumeState => ({ ...DEFAULT_STATE, ...store[userId] })

const volumeField = (source: AudioSourceKind): 'micVolume' | 'screenVolume' =>
  source === 'microphone' ? 'micVolume' : 'screenVolume'

let audioContext: AudioContext | undefined
const audioContextFor = () => (audioContext ??= new AudioContext())
let masterMuted = false

const channels = new Map<string, MixerChannel>()
const lastSpokeAt = new Map<string, number>()
const levelSamples = new Float32Array(256)
const wired = new WeakMap<HTMLMediaElement, string>()
const managedElements = new Set<HTMLMediaElement>()
const channelKey = (userId: string, source: AudioSourceKind) => `${userId}:${source}`

const applyGain = (userId: string, source: AudioSourceKind) => {
  const channel = channels.get(channelKey(userId, source))
  if (!channel) return
  const state = stateFor(userId)
  const muted = masterMuted || (source === 'screen_share_audio' && state.screenshareMuted)
  channel.gain.gain.value = muted ? 0 : state[volumeField(source)] / 100
}

export const isManaged = (element: HTMLMediaElement) => managedElements.has(element)

export const hasChannel = (userId: string, source: AudioSourceKind) =>
  channels.has(channelKey(userId, source))

export const activeMicrophoneUsers = () => {
  const now = performance.now()
  const users = new Set<string>()
  for (const channel of channels.values()) {
    if (channel.sourceKind !== 'microphone') continue
    channel.analyser.getFloatTimeDomainData(levelSamples)
    let power = 0
    for (const sample of levelSamples) power += sample * sample
    if (Math.sqrt(power / levelSamples.length) >= 0.012) lastSpokeAt.set(channel.userId, now)
    if (now - (lastSpokeAt.get(channel.userId) ?? 0) < 280) users.add(channel.userId)
  }
  return users
}

export const setMasterMuted = (muted: boolean) => {
  masterMuted = muted
  for (const channel of channels.values()) applyGain(channel.userId, channel.sourceKind)
}

export const attach = (element: HTMLMediaElement, userId: string, source: AudioSourceKind) => {
  // Iframe streams belong to another JavaScript realm, so avoid instanceof.
  const candidate = element.srcObject as
    | (MediaStream & { getAudioTracks?: () => MediaStreamTrack[] })
    | null
  if (
    !candidate ||
    typeof candidate.getAudioTracks !== 'function' ||
    !candidate.getAudioTracks().length
  )
    return
  const stream = candidate as MediaStream
  managedElements.add(element)
  element.muted = true
  const key = channelKey(userId, source)
  const previousKey = wired.get(element)
  if (previousKey === key) {
    applyGain(userId, source)
    return
  }
  if (previousKey !== undefined) {
    const stale = channels.get(previousKey)
    if (stale) {
      stale.source.disconnect()
      stale.analyser.disconnect()
      stale.gain.disconnect()
      channels.delete(previousKey)
    }
  }
  wired.set(element, key)
  const context = audioContextFor()
  void context.resume().catch(() => undefined)
  const existing = channels.get(key)
  existing?.source.disconnect()
  existing?.analyser.disconnect()
  existing?.gain.disconnect()
  const sourceNode = context.createMediaStreamSource(stream)
  const analyserNode = context.createAnalyser()
  analyserNode.fftSize = 512
  analyserNode.smoothingTimeConstant = 0.35
  const gainNode = context.createGain()
  sourceNode.connect(analyserNode)
  analyserNode.connect(gainNode)
  gainNode.connect(context.destination)
  channels.set(key, {
    context,
    source: sourceNode,
    analyser: analyserNode,
    gain: gainNode,
    userId,
    sourceKind: source,
  })
  applyGain(userId, source)
}

export const detach = (userId: string, source: AudioSourceKind) => {
  const key = channelKey(userId, source)
  const channel = channels.get(key)
  if (!channel) return
  channel.source.disconnect()
  channel.analyser.disconnect()
  channel.gain.disconnect()
  channels.delete(key)
  if (source === 'microphone') lastSpokeAt.delete(userId)
}

export const getUserVolume = (userId: string, source: AudioSourceKind) =>
  stateFor(userId)[volumeField(source)]
export const getScreenshareAudioMuted = (userId: string) => stateFor(userId).screenshareMuted

export const setUserVolume = (userId: string, source: AudioSourceKind, percent: number) => {
  const clamped = Math.max(0, Math.min(200, Math.round(percent)))
  store = { ...store, [userId]: { ...stateFor(userId), [volumeField(source)]: clamped } }
  persist()
  void audioContext?.resume().catch(() => undefined)
  applyGain(userId, source)
}

export const setScreenshareAudioMuted = (userId: string, muted: boolean) => {
  store = { ...store, [userId]: { ...stateFor(userId), screenshareMuted: muted } }
  persist()
  applyGain(userId, 'screen_share_audio')
}

const sourceKind = (value: string | null): AudioSourceKind | undefined =>
  value === 'microphone' || value === 'screen_share_audio' ? value : undefined

export type MatchedAudioElement = {
  element: HTMLMediaElement
  userId: string
  source: AudioSourceKind
}

const tileLabel = (element: HTMLMediaElement) => {
  const container = element.closest<HTMLElement>('[class*="tile"],li,article')
  if (!container) return ''
  const hints = [container.textContent, container.getAttribute('aria-label'), container.title]
  for (const node of container.querySelectorAll<HTMLElement>('[aria-label],[title]'))
    hints.push(node.getAttribute('aria-label'), node.title)
  return hints.filter(Boolean).join(' ')
}

export const scanAudioElements = (
  document: Document,
  members: RoomMember[],
  ownUserId: string | undefined,
): MatchedAudioElement[] => {
  const others = members.filter((member) => member.userId !== ownUserId)
  const matched: MatchedAudioElement[] = []
  const unmatched: { element: HTMLMediaElement; source: AudioSourceKind }[] = []
  const seen = new Set<HTMLMediaElement>()
  const candidates = [
    ...document.querySelectorAll<HTMLMediaElement>('[data-lk-source]'),
    ...document.querySelectorAll<HTMLAudioElement>('audio'),
  ]
  for (const element of candidates) {
    if (seen.has(element)) continue
    seen.add(element)
    if (element.dataset.lkLocalParticipant === 'true') continue
    const source =
      sourceKind(element.dataset.lkSource ?? null) ??
      (element.tagName === 'AUDIO' ? 'microphone' : undefined)
    if (!source) continue
    const label = tileLabel(element)
    const member = others.find(
      (candidate) =>
        label.includes(candidate.userId) || (candidate.name && label.includes(candidate.name)),
    )
    if (member) matched.push({ element, userId: member.userId, source })
    else unmatched.push({ element, source })
  }
  const matchedUserIds = new Set(matched.map((item) => item.userId))
  const remaining = others.filter((member) => !matchedUserIds.has(member.userId))
  if (unmatched.length && remaining.length === 1)
    for (const { element, source } of unmatched)
      matched.push({ element, userId: remaining[0].userId, source })
  return matched
}
