import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk'
import { ClientEvent, RoomEvent, RoomStateEvent } from 'matrix-js-sdk'
import {
  ClientWidgetApi,
  OpenIDRequestState,
  Widget,
  WidgetDriver,
  type Capability,
  type IRoomEvent,
  type ITurnServer,
  type SimpleObservable,
  type IOpenIDUpdate,
} from 'matrix-widget-api'
import {
  clampMicrophoneVolumePercent,
  microphoneVolumePercent,
  preferredMicrophoneId,
  type ScreenShareContentHint,
  type ScreenShareFrameRate,
  type ScreenShareResolution,
} from '../../lib/constants'

export const SCREEN_SHARE_AUDIO_RESULT_EVENT = 'foxchat-screen-share-audio-result'

const rawEvent = (event: MatrixEvent): IRoomEvent => event.getEffectiveEvent() as IRoomEvent

class ElementCallDriver extends WidgetDriver {
  private readonly client: MatrixClient
  private readonly roomId: string
  onStateEvent?: (event: IRoomEvent) => void
  constructor(client: MatrixClient, roomId: string) {
    super()
    this.client = client
    this.roomId = roomId
  }

  override validateCapabilities(requested: Set<Capability>) {
    return Promise.resolve(new Set(requested))
  }

  override async sendEvent(
    eventType: string,
    content: unknown,
    stateKey: string | null = null,
    roomId: string | null = null,
  ) {
    const target = roomId || this.roomId
    const response =
      stateKey === null
        ? await this.client.sendEvent(target, eventType as never, content as never)
        : await this.client.sendStateEvent(target, eventType as never, content as never, stateKey)
    if (stateKey !== null)
      this.onStateEvent?.({
        type: eventType,
        content: content as Record<string, unknown>,
        event_id: response.event_id,
        room_id: target,
        sender: this.client.getSafeUserId(),
        state_key: stateKey,
        origin_server_ts: Date.now(),
        unsigned: {},
      })
    return { roomId: target, eventId: response.event_id }
  }

  override async sendToDevice(
    eventType: string,
    encrypted: boolean,
    contentMap: Record<string, Record<string, object>>,
  ) {
    if (encrypted) {
      for (const [userId, devices] of Object.entries(contentMap)) {
        for (const [deviceId, content] of Object.entries(devices)) {
          await this.client.encryptAndSendToDevice(eventType, [{ userId, deviceId }], content)
        }
      }
      return
    }
    const map = new Map<string, Map<string, object>>()
    for (const [userId, devices] of Object.entries(contentMap))
      map.set(userId, new Map(Object.entries(devices)))
    await this.client.sendToDevice(eventType, map)
  }

  override readRoomState(roomId: string, eventType: string, stateKey: string | undefined) {
    const room = this.client.getRoom(roomId)
    if (!room) return Promise.resolve([])
    const events =
      stateKey === undefined
        ? room.currentState.getStateEvents(eventType)
        : room.currentState.getStateEvents(eventType, stateKey)
    return Promise.resolve((Array.isArray(events) ? events : events ? [events] : []).map(rawEvent))
  }

  override readStickyEvents(_roomId: string) {
    return Promise.resolve([])
  }

  override readRoomTimeline(
    roomId: string,
    eventType: string,
    msgtype: string | undefined,
    stateKey: string | undefined,
    limit: number,
    since: string | undefined,
  ) {
    const events = this.client.getRoom(roomId)?.getLiveTimeline().getEvents() ?? []
    let filtered = events.filter((event) => event.getType() === eventType)
    if (msgtype !== undefined)
      filtered = filtered.filter((event) => event.getContent().msgtype === msgtype)
    if (stateKey !== undefined)
      filtered = filtered.filter((event) => event.getStateKey() === stateKey)
    if (since) {
      const index = filtered.findIndex((event) => event.getId() === since)
      if (index >= 0) filtered = filtered.slice(index + 1)
    }
    if (limit > 0) filtered = filtered.slice(-limit)
    return Promise.resolve(filtered.map(rawEvent))
  }

  override askOpenID(observer: SimpleObservable<IOpenIDUpdate>) {
    observer.update({ state: OpenIDRequestState.PendingUserConfirmation })
    void this.client
      .getOpenIdToken()
      .then((token) => {
        observer.update({ state: OpenIDRequestState.Allowed, token })
        observer.close()
      })
      .catch(() => {
        observer.update({ state: OpenIDRequestState.Blocked })
        observer.close()
      })
  }

  override async *getTurnServers(): AsyncGenerator<ITurnServer> {
    for (const server of this.client.getTurnServers())
      yield { uris: server.urls, username: server.username, password: server.credential }
  }

  override getMediaConfig() {
    return this.client.getMediaConfig()
  }
  override getKnownRooms() {
    return this.client.getRooms().map((room) => room.roomId)
  }
}

export const elementCallUrl = (client: MatrixClient, room: Room, widgetId: string) => {
  const params = new URLSearchParams({
    widgetId,
    parentUrl: window.location.origin,
    roomId: room.roomId,
    userId: client.getSafeUserId(),
    deviceId: client.getDeviceId() ?? '',
    baseUrl: client.baseUrl,
    intent: 'join_existing_voice',
    confineToRoom: 'true',
    preload: 'true',
    skipLobby: 'true',
    header: 'none',
    showControls: 'true',
    hideScreensharing: 'false',
    controlledAudioDevices: 'false',
  })
  return `${import.meta.env.BASE_URL}element-call/index.html?${params}`
}

export const leaveElementCall = async (client: MatrixClient, room: Room) => {
  const userId = client.getSafeUserId()
  const deviceId = client.getDeviceId()
  if (!deviceId) return
  const eventTypes = [
    'org.matrix.msc3401.call.member',
    'm.call.member',
    'org.matrix.msc4143.rtc.member',
    'm.rtc.member',
  ]
  const ownDeviceInContent = (content: Record<string, unknown>) => {
    const member = content.member as Record<string, unknown> | undefined
    if (content.device_id === deviceId || member?.device_id === deviceId) return true
    return (
      Array.isArray(content.memberships) &&
      content.memberships.some((item) => {
        const membership = item as Record<string, unknown>
        const membershipMember = membership.member as Record<string, unknown> | undefined
        return membership.device_id === deviceId || membershipMember?.device_id === deviceId
      })
    )
  }
  const targets = new Map<
    string,
    { type: string; stateKey: string; content: Record<string, unknown> }
  >()
  for (const type of eventTypes) {
    for (const event of room.currentState.getStateEvents(type)) {
      const content = event.getContent<Record<string, unknown>>()
      const stateKey = event.getStateKey() ?? ''
      if (
        event.getSender() !== userId ||
        (!ownDeviceInContent(content) && !stateKey.includes(`${userId}_${deviceId}`))
      )
        continue
      let nextContent: Record<string, unknown> = {}
      // Legacy call membership can contain several devices.
      if (Array.isArray(content.memberships)) {
        nextContent = {
          ...content,
          memberships: content.memberships.filter((item) => {
            const membership = item as Record<string, unknown>
            const membershipMember = membership.member as Record<string, unknown> | undefined
            return membership.device_id !== deviceId && membershipMember?.device_id !== deviceId
          }),
        }
      }
      targets.set(`${type}\0${stateKey}`, { type, stateKey, content: nextContent })
    }
  }
  const membershipStateKey = `${userId}_${deviceId}_m.call`
  const legacyPrefix = /^org\.matrix\.msc(3757|3779)\b/.test(room.getVersion()) ? '' : '_'
  const fallbackType = 'org.matrix.msc3401.call.member'
  const fallbackStateKey = `${legacyPrefix}${membershipStateKey}`
  targets.set(`${fallbackType}\0${fallbackStateKey}`, {
    type: fallbackType,
    stateKey: fallbackStateKey,
    content: {},
  })

  const send = async ({
    type,
    stateKey,
    content,
  }: {
    type: string
    stateKey: string
    content: Record<string, unknown>
  }) => {
    let lastError: unknown
    for (const delay of [0, 250, 750]) {
      if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay))
      try {
        await client.sendStateEvent(room.roomId, type as never, content as never, stateKey)
        return
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }
  const results = await Promise.allSettled([...targets.values()].map(send))
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (failed) throw failed.reason
}

const SCREEN_SHARE_RESOLUTION_CONSTRAINTS: Record<
  Exclude<ScreenShareResolution, 'source'>,
  MediaTrackConstraints
> = {
  '720p': { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 } },
  '1080p': { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 } },
  '1440p': { width: { ideal: 2560, max: 2560 }, height: { ideal: 1440, max: 1440 } },
  '2160p': { width: { ideal: 3840, max: 3840 }, height: { ideal: 2160, max: 2160 } },
}

const patchScreenShare = (
  iframe: HTMLIFrameElement,
  audioEnabled: () => boolean,
  resolution: () => ScreenShareResolution,
  frameRate: () => ScreenShareFrameRate,
  contentHint: () => ScreenShareContentHint,
  cursorEnabled: () => boolean,
  bitrateKbps: () => number,
) => {
  let patchedWindow: Window | undefined
  let restoreSenderParameters: (() => void) | undefined
  const screenTracks = new WeakSet<MediaStreamTrack>()
  const apply = () => {
    const win = iframe.contentWindow
    if (!win || win === patchedWindow) return
    const mediaDevices = win.navigator?.mediaDevices
    if (!mediaDevices?.getDisplayMedia) return
    patchedWindow = win
    restoreSenderParameters?.()
    const senderPrototype = (win as unknown as { RTCRtpSender?: typeof RTCRtpSender }).RTCRtpSender
      ?.prototype
    const originalSetParameters = senderPrototype?.setParameters
    if (senderPrototype && originalSetParameters) {
      senderPrototype.setParameters = function (parameters: RTCRtpSendParameters) {
        if (this.track && screenTracks.has(this.track)) {
          const maxBitrate = bitrateKbps() * 1_000
          parameters.encodings = parameters.encodings?.length
            ? parameters.encodings.map((encoding) => ({
                ...encoding,
                maxBitrate,
              }))
            : [{ maxBitrate }]
        }
        return originalSetParameters.call(this, parameters)
      }
      restoreSenderParameters = () => {
        senderPrototype.setParameters = originalSetParameters
      }
    }
    const original = mediaDevices.getDisplayMedia.bind(mediaDevices)
    mediaDevices.getDisplayMedia = (async (options?: DisplayMediaStreamOptions) => {
      const wantsAudio = audioEnabled()
      const selectedResolution = resolution()
      const selectedFrameRate = frameRate()
      const requestedVideo = typeof options?.video === 'object' ? options.video : {}
      const video =
        selectedResolution === 'source' && selectedFrameRate === 'source'
          ? { ...requestedVideo, cursor: cursorEnabled() ? 'always' : 'never' }
          : {
              ...requestedVideo,
              ...(selectedResolution === 'source'
                ? {}
                : SCREEN_SHARE_RESOLUTION_CONSTRAINTS[selectedResolution]),
              ...(selectedFrameRate === 'source'
                ? {}
                : { frameRate: { ideal: selectedFrameRate, max: selectedFrameRate } }),
              cursor: cursorEnabled() ? 'always' : 'never',
            }
      const stream = await original({
        ...options,
        // Request audio explicitly so Chromium can offer system audio.
        audio: wantsAudio ? (typeof options?.audio === 'object' ? options.audio : true) : false,
        video,
        systemAudio: wantsAudio ? 'include' : 'exclude',
        windowAudio: wantsAudio ? 'system' : 'exclude',
        surfaceSwitching: 'include',
      } as DisplayMediaStreamOptions)
      for (const track of stream.getVideoTracks()) {
        screenTracks.add(track)
        try {
          track.contentHint = contentHint()
        } catch (error) {
          console.warn('[element-call] Could not apply the screen-share content hint', error)
        }
      }
      if (!wantsAudio)
        for (const track of stream.getAudioTracks()) {
          stream.removeTrack(track)
          track.stop()
        }
      window.dispatchEvent(
        new CustomEvent(SCREEN_SHARE_AUDIO_RESULT_EVENT, {
          detail: {
            requested: wantsAudio,
            available: stream.getAudioTracks().some((track) => track.readyState === 'live'),
          },
        }),
      )
      return stream
    }) as typeof mediaDevices.getDisplayMedia
  }
  iframe.addEventListener('load', apply)
  apply()
  return () => {
    iframe.removeEventListener('load', apply)
    restoreSenderParameters?.()
  }
}

const activeCalls = new Set<ClientWidgetApi>()

const sendPreferredMicrophone = async (api: ClientWidgetApi) => {
  const deviceId = preferredMicrophoneId()
  let audioInput: string | undefined
  if (deviceId) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      audioInput =
        devices.find((device) => device.kind === 'audioinput' && device.deviceId === deviceId)
          ?.label || undefined
    } catch (error) {
      console.warn(
        '[element-call] Could not read the preferred microphone from enumerateDevices',
        error,
      )
    }
  }
  await api.transport.send('io.element.join', audioInput ? { audioInput } : {})
}

export const applyPreferredMicrophoneToActiveCalls = () => {
  for (const api of activeCalls)
    void sendPreferredMicrophone(api).catch((error) =>
      console.warn('[element-call] Could not live-swap the microphone on an active call', error),
    )
}

export const createMicrophoneGate = (iframe: HTMLIFrameElement) => {
  const gateOriginalTrack =
    '__TAURI_INTERNALS__' in window && /Linux/i.test(window.navigator.userAgent)
  let patchedWindow: Window | undefined
  const tracks = new Set<MediaStreamTrack>()
  const directTracks = new Set<MediaStreamTrack>()
  const delayNodes = new Set<DelayNode>()
  const gainNodes = new Set<GainNode>()
  const audioContexts = new Set<AudioContext>()
  let delayMs = 0
  let closeTimer: number | undefined
  let cameraAllowed = false
  let enabled = true
  let volumeScale = microphoneVolumePercent() / 100
  const targetGain = () => (enabled ? volumeScale : 0)
  const apply = () => {
    const win = iframe.contentWindow
    if (!win || win === patchedWindow) return
    const mediaDevices = win.navigator?.mediaDevices
    if (!mediaDevices?.getUserMedia) return
    patchedWindow = win
    const original = mediaDevices.getUserMedia.bind(mediaDevices)
    mediaDevices.getUserMedia = (async (constraints?: MediaStreamConstraints) => {
      const wantedVideo = Boolean(constraints?.video) && !cameraAllowed
      let effectiveConstraints =
        constraints?.video && !cameraAllowed ? { ...constraints, video: false } : constraints
      if (effectiveConstraints?.audio) {
        const supported = mediaDevices.getSupportedConstraints()
        const requestedAudio =
          typeof effectiveConstraints.audio === 'object' ? effectiveConstraints.audio : {}
        const filteredAudio: MediaTrackConstraints & Record<string, unknown> = {
          ...requestedAudio,
          echoCancellation: true,
          noiseSuppression: true,
          // AGC makes voice-activation thresholds unreliable.
          autoGainControl: false,
          channelCount: 1,
        }
        if ((supported as Record<string, boolean | undefined>).voiceIsolation)
          filteredAudio.voiceIsolation = true
        effectiveConstraints = {
          ...effectiveConstraints,
          audio: filteredAudio,
        }
      }
      if (effectiveConstraints && !effectiveConstraints.audio && !effectiveConstraints.video)
        return new MediaStream()
      const stream = await original(effectiveConstraints)
      if (effectiveConstraints?.audio)
        for (const track of stream.getAudioTracks()) {
          // Linux WebKit needs the native track at neutral gain. A custom volume
          // explicitly opts into Web Audio so the published Matrix track is amplified.
          if (gateOriginalTrack && volumeScale === 1) {
            track.enabled = enabled
            tracks.add(track)
            directTracks.add(track)
            track.addEventListener('ended', () => {
              tracks.delete(track)
              directTracks.delete(track)
            })
            continue
          }
          // Build the gate in the iframe realm to match Firefox's sample rate.
          const IframeAudioContext = (win as Window & { AudioContext: typeof AudioContext })
            .AudioContext
          const context = new IframeAudioContext()
          const source = context.createMediaStreamSource(new MediaStream([track]))
          const delay = context.createDelay(1)
          const gain = context.createGain()
          const destination = context.createMediaStreamDestination()
          delay.delayTime.value = delayMs / 1000
          gain.gain.value = targetGain()
          source.connect(delay).connect(gain).connect(destination)
          const output = destination.stream.getAudioTracks()[0]
          stream.removeTrack(track)
          stream.addTrack(output)
          tracks.add(output)
          delayNodes.add(delay)
          gainNodes.add(gain)
          audioContexts.add(context)
          output.addEventListener('ended', () => {
            tracks.delete(output)
            delayNodes.delete(delay)
            gainNodes.delete(gain)
            audioContexts.delete(context)
            track.stop()
            void context.close().catch(() => undefined)
          })
        }
      if (wantedVideo && !stream.getVideoTracks().length) {
        const canvas = win.document.createElement('canvas')
        canvas.width = 2
        canvas.height = 2
        canvas.getContext('2d')?.fillRect(0, 0, canvas.width, canvas.height)
        const placeholder = (
          canvas as HTMLCanvasElement & {
            captureStream: (frameRate?: number) => MediaStream
          }
        )
          .captureStream(0)
          .getVideoTracks()[0]
        if (placeholder) stream.addTrack(placeholder)
      }
      return stream
    }) as typeof mediaDevices.getUserMedia
  }
  iframe.addEventListener('load', apply)
  apply()
  return {
    allowCamera() {
      cameraAllowed = true
    },
    setDelay(nextDelayMs: number) {
      delayMs = Math.max(0, Math.min(1000, nextDelayMs))
      for (const delay of delayNodes)
        delay.delayTime.setValueAtTime(delayMs / 1000, delay.context.currentTime)
    },
    setVolume(nextVolumePercent: number) {
      volumeScale = clampMicrophoneVolumePercent(nextVolumePercent) / 100
      for (const gain of gainNodes) {
        const now = gain.context.currentTime
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(gain.gain.value, now)
        gain.gain.linearRampToValueAtTime(targetGain(), now + 0.015)
      }
    },
    setEnabled(next: boolean, preserveTail = false) {
      if (closeTimer !== undefined) {
        window.clearTimeout(closeTimer)
        closeTimer = undefined
      }
      enabled = next
      for (const track of directTracks) track.enabled = next
      const applyGain = () => {
        for (const gain of gainNodes) {
          const now = gain.context.currentTime
          gain.gain.cancelScheduledValues(now)
          gain.gain.setValueAtTime(gain.gain.value, now)
          gain.gain.linearRampToValueAtTime(targetGain(), now + (next ? 0.008 : 0.025))
        }
      }
      if (!next && preserveTail && delayMs > 0)
        closeTimer = window.setTimeout(() => {
          closeTimer = undefined
          applyGain()
        }, delayMs)
      else applyGain()
    },
    extendTail() {
      // Preserve an open release tail during early speech.
      if (closeTimer === undefined || delayMs <= 0) return
      window.clearTimeout(closeTimer)
      closeTimer = window.setTimeout(() => {
        closeTimer = undefined
        for (const gain of gainNodes) {
          const now = gain.context.currentTime
          gain.gain.cancelScheduledValues(now)
          gain.gain.setValueAtTime(gain.gain.value, now)
          gain.gain.linearRampToValueAtTime(targetGain(), now + 0.025)
        }
      }, delayMs)
    },
    disconnect() {
      iframe.removeEventListener('load', apply)
      if (closeTimer !== undefined) window.clearTimeout(closeTimer)
      for (const context of audioContexts) void context.close().catch(() => undefined)
      tracks.clear()
      directTracks.clear()
      delayNodes.clear()
      gainNodes.clear()
      audioContexts.clear()
    },
  }
}

export const connectElementCallWidget = (
  client: MatrixClient,
  room: Room,
  iframe: HTMLIFrameElement,
  widgetId: string,
  screenShareAudioEnabled: () => boolean = () => true,
  screenShareResolution: () => ScreenShareResolution = () => 'source',
  screenShareFrameRate: () => ScreenShareFrameRate = () => 'source',
  screenShareContentHint: () => ScreenShareContentHint = () => 'detail',
  screenShareCursorEnabled: () => boolean = () => true,
  screenShareBitrateKbps: () => number = () => 6_000,
) => {
  const widget = new Widget({
    id: widgetId,
    creatorUserId: client.getSafeUserId(),
    type: 'm.call',
    url: iframe.src,
    waitForIframeLoad: true,
  })
  const driver = new ElementCallDriver(client, room.roomId)
  const api = new ClientWidgetApi(widget, iframe, driver)
  driver.onStateEvent = (event) => {
    void api.feedStateUpdate(event).catch(() => undefined)
  }
  api.setViewedRoomId(room.roomId)
  api.once('ready', () => {
    activeCalls.add(api)
    void sendPreferredMicrophone(api).catch((error) =>
      console.warn(
        '[element-call] Could not send the preferred microphone; the call will join with its own default device',
        error,
      ),
    )
  })

  const feedTimeline = (event: MatrixEvent, eventRoom: Room | undefined) => {
    if (eventRoom?.roomId === room.roomId)
      void api.feedEvent(rawEvent(event)).catch(() => undefined)
  }
  const feedToDevice = (event: MatrixEvent) => {
    const json = event.getEffectiveEvent() as Parameters<ClientWidgetApi['feedToDevice']>[0]
    void api.feedToDevice(json, event.isEncrypted()).catch(() => undefined)
  }
  const feedState = (event: MatrixEvent) => {
    if (event.getRoomId() === room.roomId)
      void api.feedStateUpdate(rawEvent(event)).catch(() => undefined)
  }
  client.on(RoomEvent.Timeline, feedTimeline)
  client.on(RoomStateEvent.Events, feedState)
  client.on(ClientEvent.ToDeviceEvent, feedToDevice)

  let callDocument: Document | undefined
  const endCallClick = (event: Event) => {
    const button = (event.target as HTMLElement | null)?.closest('button')
    if (!button || !/end call|leave call|hang up/i.test(button.textContent ?? '')) return
    window.setTimeout(() => {
      void leaveElementCall(client, room)
    }, 0)
  }
  const attachCallDocument = () => {
    callDocument?.removeEventListener('click', endCallClick, true)
    callDocument = iframe.contentDocument ?? undefined
    callDocument?.addEventListener('click', endCallClick, true)
  }
  iframe.addEventListener('load', attachCallDocument)
  attachCallDocument()
  const unpatchScreenShare = patchScreenShare(
    iframe,
    screenShareAudioEnabled,
    screenShareResolution,
    screenShareFrameRate,
    screenShareContentHint,
    screenShareCursorEnabled,
    screenShareBitrateKbps,
  )

  return () => {
    activeCalls.delete(api)
    client.off(RoomEvent.Timeline, feedTimeline)
    client.off(RoomStateEvent.Events, feedState)
    client.off(ClientEvent.ToDeviceEvent, feedToDevice)
    iframe.removeEventListener('load', attachCallDocument)
    callDocument?.removeEventListener('click', endCallClick, true)
    unpatchScreenShare()
    api.stop()
  }
}
