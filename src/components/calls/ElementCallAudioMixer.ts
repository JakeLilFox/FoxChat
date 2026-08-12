import type { RoomMember } from 'matrix-js-sdk'

export type AudioSourceKind = 'microphone' | 'screen_share_audio'

type MixerChannel = {
  context: AudioContext
  source: MediaStreamAudioSourceNode
  analyser: AnalyserNode
  gain: GainNode
  element: HTMLMediaElement
  stream: MediaStream
  track: MediaStreamTrack
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
let inferredUsers = new WeakMap<HTMLMediaElement, string>()
const managedElements = new Set<HTMLMediaElement>()
const channelKey = (userId: string, source: AudioSourceKind) => `${userId}:${source}`

const disconnectChannel = (key: string, channel: MixerChannel) => {
  channel.source.disconnect()
  channel.analyser.disconnect()
  channel.gain.disconnect()
  if (channels.get(key) === channel) channels.delete(key)
  if (wired.get(channel.element) === key) wired.delete(channel.element)
  delete channel.element.dataset.foxchatMixerActive
  delete channel.element.dataset.foxchatMixerUserId
  delete channel.element.dataset.foxchatMixerGain
}

const manage = (element: HTMLMediaElement) => {
  managedElements.add(element)
  element.muted = true
}

const stopManaging = (element: HTMLMediaElement) => {
  managedElements.delete(element)
  wired.delete(element)
  element.muted = masterMuted
}

const applyGain = (userId: string, source: AudioSourceKind) => {
  const channel = channels.get(channelKey(userId, source))
  if (!channel) return
  const state = stateFor(userId)
  const muted = masterMuted || (source === 'screen_share_audio' && state.screenshareMuted)
  const effectiveGain = muted ? 0 : state[volumeField(source)] / 100
  channel.gain.gain.value = effectiveGain
  channel.element.dataset.foxchatMixerGain = String(effectiveGain)
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
  if (!candidate || typeof candidate.getAudioTracks !== 'function') return
  const track = candidate
    .getAudioTracks()
    .find((candidateTrack) => candidateTrack.readyState !== 'ended')
  if (!track) return
  const stream = candidate as MediaStream
  manage(element)
  const key = channelKey(userId, source)
  const previousKey = wired.get(element)
  const existing = channels.get(key)
  if (
    previousKey === key &&
    existing?.element === element &&
    existing.stream === stream &&
    existing.track === track
  ) {
    applyGain(userId, source)
    return
  }
  if (previousKey !== undefined) {
    const stale = channels.get(previousKey)
    if (stale?.element === element) disconnectChannel(previousKey, stale)
  }
  wired.set(element, key)
  const context = audioContextFor()
  void context.resume().catch(() => undefined)
  if (existing) disconnectChannel(key, existing)
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
    element,
    stream,
    track,
    userId,
    sourceKind: source,
  })
  element.dataset.foxchatMixerActive = 'true'
  element.dataset.foxchatMixerUserId = userId
  applyGain(userId, source)
}

export const detach = (userId: string, source: AudioSourceKind) => {
  const key = channelKey(userId, source)
  const channel = channels.get(key)
  if (!channel) return
  disconnectChannel(key, channel)
  if (source === 'microphone') lastSpokeAt.delete(userId)
}


export const reconcile = (matches: MatchedAudioElement[]) => {
  const matchedElements = new Set(matches.map((match) => match.element))
  for (const element of managedElements) {
    if (matchedElements.has(element)) continue
    if (element.isConnected) manage(element)
    else stopManaging(element)
  }

  const grouped = new Map<string, MatchedAudioElement[]>()
  for (const match of matches) {
    manage(match.element)
    const key = channelKey(match.userId, match.source)
    grouped.set(key, [...(grouped.get(key) ?? []), match])
  }

  for (const [key, channel] of channels) {
    if (!grouped.has(key)) {
      disconnectChannel(key, channel)
      if (channel.sourceKind === 'microphone') lastSpokeAt.delete(channel.userId)
    }
  }

  for (const [key, candidates] of grouped) {
    const usable = candidates.filter((candidate) => {
      const stream = candidate.element.srcObject as
        | (MediaStream & { getAudioTracks?: () => MediaStreamTrack[] })
        | null
      return (
        !!stream &&
        typeof stream.getAudioTracks === 'function' &&
        stream.getAudioTracks().some((track) => track.readyState !== 'ended')
      )
    })
    const existing = channels.get(key)
    const selected = usable.at(-1)
    if (!selected) {
      if (existing) disconnectChannel(key, existing)
      continue
    }
    attach(selected.element, selected.userId, selected.source)
    for (const candidate of candidates) {
      if (candidate.element === selected.element) continue
      delete candidate.element.dataset.foxchatMixerActive
      delete candidate.element.dataset.foxchatMixerUserId
      delete candidate.element.dataset.foxchatMixerGain
      if (wired.get(candidate.element) === key) wired.delete(candidate.element)
    }
  }
}

export const reset = () => {
  for (const [key, channel] of channels) disconnectChannel(key, channel)
  masterMuted = false
  for (const element of managedElements) stopManaging(element)
  managedElements.clear()
  lastSpokeAt.clear()
  inferredUsers = new WeakMap()
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
  const hints: Array<string | null | undefined> = [
    element.getAttribute('aria-label'),
    element.title,
    ...Object.values(element.dataset),
    container?.textContent,
    container?.getAttribute('aria-label'),
    container?.title,
    ...Object.values(container?.dataset ?? {}),
  ]
  for (const node of container?.querySelectorAll<HTMLElement>(
    '[aria-label],[title],[data-participant-identity],[data-lk-participant-identity]',
  ) ?? [])
    hints.push(node.getAttribute('aria-label'), node.title, ...Object.values(node.dataset))
  let ancestor = element.parentElement
  for (let depth = 0; ancestor && depth < 7; depth++, ancestor = ancestor.parentElement) {
    hints.push(
      ancestor.getAttribute('aria-label'),
      ancestor.title,
      ...Object.values(ancestor.dataset),
    )
  }
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
    if (member) {
      inferredUsers.set(element, member.userId)
      matched.push({ element, userId: member.userId, source })
    } else unmatched.push({ element, source })
  }

  const unresolved: typeof unmatched = []
  for (const candidate of unmatched) {
    const inferredUserId = inferredUsers.get(candidate.element)
    const member = others.find((other) => other.userId === inferredUserId)
    if (member) matched.push({ ...candidate, userId: member.userId })
    else unresolved.push(candidate)
  }

  // A single remote user is unambiguous even on older embedded Element Call builds. Never infer
  // several users by DOM order: LiveKit track order can differ from Matrix membership order.
  if (others.length === 1)
    for (const candidate of unresolved) {
      if (matched.some((match) => match.element === candidate.element)) continue
      inferredUsers.set(candidate.element, others[0].userId)
      matched.push({ ...candidate, userId: others[0].userId })
    }
  return matched
}
