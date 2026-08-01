import { ElementCallVideo } from './ElementCallVideo'
import { MemberAvatar } from '../profile'
import { type ElementCallMedia, participantAudioMenu } from './voiceCallHelpers'
import {
  matrixMemberDisplayName,
  matrixRTCActiveSpeakers,
  matrixRTCVoiceMembers,
  voiceSpeakerEvent,
} from './voiceRoom'
import { IconBtn } from '../../styles'
import {
  preferredMicrophoneId,
  MICROPHONE_VOLUME_CHANGED_EVENT,
  preferredScreenShareBitrate,
  preferredScreenShareContentHint,
  preferredScreenShareFrameRate,
  preferredScreenShareResolution,
  pushToTalkShortcut,
  screenShareCursorEnabled,
  SCREEN_SHARE_BITRATE_KEY,
  SCREEN_SHARE_CONTENT_HINT_KEY,
  SCREEN_SHARE_CURSOR_KEY,
  SCREEN_SHARE_FRAME_RATE_KEY,
  SCREEN_SHARE_RESOLUTION_KEY,
  type ScreenShareContentHint,
  type ScreenShareFrameRate,
  type ScreenShareResolution,
  type VoiceActivationThresholdMode,
  type VoiceInputMode,
  voiceActivationPrerollMs,
  voiceActivationThresholdDb,
  voiceActivationThresholdMode,
  voiceInputMode,
  PUSH_TO_TALK_SHORTCUT_CHANGED_EVENT,
  VOICE_ACTIVATION_PREROLL_CHANGED_EVENT,
  VOICE_ACTIVATION_THRESHOLD_CHANGED_EVENT,
  VOICE_INPUT_MODE_CHANGED_EVENT,
} from '../../lib/constants'
import { showUserProfile } from '../../lib/userProfile'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Button, Dropdown, Modal, Radio, Slider, Switch, Tooltip, App as AntApp } from 'antd'
import {
  AudioMutedOutlined,
  AudioOutlined,
  CustomerServiceOutlined,
  DesktopOutlined,
  ExpandOutlined,
  FullscreenOutlined,
  PhoneOutlined,
  SettingOutlined,
  SoundOutlined,
  StopOutlined,
  SwapOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import { Room } from 'matrix-js-sdk'
import { matrixService } from '../../matrix/MatrixClientService'
import {
  connectElementCallWidget,
  createMicrophoneGate,
  elementCallUrl,
  leaveElementCall,
  SCREEN_SHARE_AUDIO_RESULT_EVENT,
} from './ElementCallWidget'
import {
  activePopoutIds,
  closeAllPopouts,
  closePopout,
  isPopoutOpen,
  openPopout,
} from './CallPopout'
import { VoiceActivation } from './VoiceActivation'
import * as VoiceAudioMixer from './ElementCallAudioMixer'
import {
  desktopPushToTalkAvailable,
  pushToTalkShortcutLabel,
  registerPushToTalk,
} from '../../platform/pushToTalk'

const SCREEN_SHARE_RESOLUTION_LABELS: Record<ScreenShareResolution, string> = {
  '720p': '720p HD',
  '1080p': '1080p Full HD',
  '1440p': '1440p QHD',
  '2160p': '2160p 4K',
  source: 'Original resolution',
}
const SCREEN_SHARE_FRAME_RATES: ScreenShareFrameRate[] = [15, 30, 60, 'source']

const MAX_DOCK_PARTICIPANTS = 5
const MIN_SCREEN_SHARE_ZOOM = 1
const MAX_SCREEN_SHARE_ZOOM = 4

type ScreenShareView = {
  scale: number
  x: number
  y: number
}

const defaultScreenShareView = (): ScreenShareView => ({
  scale: MIN_SCREEN_SHARE_ZOOM,
  x: 0,
  y: 0,
})

const clampScreenShareView = (
  view: ScreenShareView,
  width: number,
  height: number,
): ScreenShareView => {
  const scale = Math.min(MAX_SCREEN_SHARE_ZOOM, Math.max(MIN_SCREEN_SHARE_ZOOM, view.scale))
  if (scale === MIN_SCREEN_SHARE_ZOOM) return defaultScreenShareView()

  const maxX = Math.max(0, ((scale - 1) * width) / 2)
  const maxY = Math.max(0, ((scale - 1) * height) / 2)
  return {
    scale,
    x: Math.min(maxX, Math.max(-maxX, view.x)),
    y: Math.min(maxY, Math.max(-maxY, view.y)),
  }
}

function ZoomableScreenShare({
  media,
  videoRef,
}: {
  media: ElementCallMedia
  videoRef?: RefObject<HTMLVideoElement | null>
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<
    | {
        pointerId: number
        lastX: number
        lastY: number
        moved: boolean
      }
    | undefined
  >(undefined)
  const suppressClickRef = useRef(false)
  const [view, setView] = useState(defaultScreenShareView)
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const zoomed = view.scale > MIN_SCREEN_SHARE_ZOOM

  const resizeView = (
    scale: number | ((currentScale: number) => number),
    clientX?: number,
    clientY?: number,
  ) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const bounds = viewport.getBoundingClientRect()
    setView((current) => {
      const requestedScale = typeof scale === 'function' ? scale(current.scale) : scale
      const nextScale = Math.min(
        MAX_SCREEN_SHARE_ZOOM,
        Math.max(MIN_SCREEN_SHARE_ZOOM, requestedScale),
      )
      if (nextScale === MIN_SCREEN_SHARE_ZOOM) {
        return defaultScreenShareView()
      }

      const pointX = clientX === undefined ? 0 : clientX - (bounds.left + bounds.width / 2)
      const pointY = clientY === undefined ? 0 : clientY - (bounds.top + bounds.height / 2)
      const ratio = nextScale / current.scale
      return clampScreenShareView(
        {
          scale: nextScale,
          x: pointX - (pointX - current.x) * ratio,
          y: pointY - (pointY - current.y) * ratio,
        },
        bounds.width,
        bounds.height,
      )
    })
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const bounds = viewport.getBoundingClientRect()
      setView((current) => clampScreenShareView(current, bounds.width, bounds.height))
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={viewportRef}
      aria-label={
        zoomed
          ? `Screen share zoomed to ${Math.round(view.scale * 100)} percent`
          : 'Screen share. Scroll to zoom.'
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onWheel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const factor = Math.exp(-event.deltaY * 0.0015)
        resizeView((currentScale) => currentScale * factor, event.clientX, event.clientY)
      }}
      onPointerDown={(event) => {
        if (!zoomed || event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = {
          pointerId: event.pointerId,
          lastX: event.clientX,
          lastY: event.clientY,
          moved: false,
        }
        setDragging(true)
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current
        const viewport = viewportRef.current
        if (!drag || drag.pointerId !== event.pointerId || !viewport) return
        event.preventDefault()
        event.stopPropagation()
        const deltaX = event.clientX - drag.lastX
        const deltaY = event.clientY - drag.lastY
        drag.lastX = event.clientX
        drag.lastY = event.clientY
        if (Math.abs(deltaX) + Math.abs(deltaY) > 1) drag.moved = true
        const bounds = viewport.getBoundingClientRect()
        setView((current) =>
          clampScreenShareView(
            {
              ...current,
              x: current.x + deltaX,
              y: current.y + deltaY,
            },
            bounds.width,
            bounds.height,
          ),
        )
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        event.preventDefault()
        event.stopPropagation()
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
        suppressClickRef.current = drag.moved
        dragRef.current = undefined
        setDragging(false)
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
      }}
      onPointerCancel={(event) => {
        if (dragRef.current?.pointerId !== event.pointerId) return
        suppressClickRef.current = dragRef.current.moved
        dragRef.current = undefined
        setDragging(false)
      }}
      onClick={(event) => {
        if (!suppressClickRef.current) return
        event.preventDefault()
        event.stopPropagation()
        suppressClickRef.current = false
      }}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        cursor: zoomed ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
        touchAction: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
          transformOrigin: 'center',
          transition: dragging ? 'none' : 'transform 100ms ease-out',
          willChange: zoomed ? 'transform' : undefined,
          pointerEvents: 'none',
        }}
      >
        <ElementCallVideo media={media} videoRef={videoRef} />
      </div>
      {(hovered || zoomed) && (
        <span
          aria-live="polite"
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            zIndex: 2,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 30,
            padding: '4px 8px',
            border: '1px solid rgba(255,255,255,.2)',
            borderRadius: 9,
            background: 'rgba(12,14,18,.82)',
            boxShadow: '0 4px 14px rgba(0,0,0,.24)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            pointerEvents: 'auto',
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <span>{Math.round(view.scale * 100)}%</span>
          <span style={{ opacity: 0.72 }}>{zoomed ? 'Drag to move' : 'Scroll to zoom'}</span>
          <span
            role="button"
            tabIndex={0}
            aria-label="Zoom out"
            onClick={() => resizeView((currentScale) => currentScale - 0.5)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              resizeView((currentScale) => currentScale - 0.5)
            }}
            style={{
              display: 'inline-grid',
              placeItems: 'center',
              width: 22,
              height: 22,
              borderRadius: 6,
              background: 'rgba(255,255,255,.12)',
              cursor: view.scale <= MIN_SCREEN_SHARE_ZOOM ? 'default' : 'pointer',
              opacity: view.scale <= MIN_SCREEN_SHARE_ZOOM ? 0.45 : 1,
            }}
          >
            −
          </span>
          <span
            role="button"
            tabIndex={0}
            aria-label="Zoom in"
            onClick={() => resizeView((currentScale) => currentScale + 0.5)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              resizeView((currentScale) => currentScale + 0.5)
            }}
            style={{
              display: 'inline-grid',
              placeItems: 'center',
              width: 22,
              height: 22,
              borderRadius: 6,
              background: 'rgba(255,255,255,.12)',
              cursor: view.scale >= MAX_SCREEN_SHARE_ZOOM ? 'default' : 'pointer',
              opacity: view.scale >= MAX_SCREEN_SHARE_ZOOM ? 0.45 : 1,
            }}
          >
            +
          </span>
          {zoomed && (
            <span
              role="button"
              tabIndex={0}
              onClick={() => setView(defaultScreenShareView())}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                setView(defaultScreenShareView())
              }}
              style={{
                padding: '3px 5px',
                borderRadius: 5,
                background: 'rgba(255,255,255,.12)',
                cursor: 'pointer',
              }}
            >
              Reset
            </span>
          )}
        </span>
      )}
    </div>
  )
}

type DockParticipant = {
  userId: string
  name: string
  avatarUrl?: string
}

function DockParticipants({
  participants,
  speakers,
}: {
  participants: DockParticipant[]
  speakers: Set<string>
}) {
  const [visibleUserIds, setVisibleUserIds] = useState<string[]>([])
  const lastSpokeAt = useRef(new Map<string, number>())
  const participantsRef = useRef(participants)
  const speakersRef = useRef(speakers)
  participantsRef.current = participants
  speakersRef.current = speakers
  const participantSignature = participants.map((participant) => participant.userId).join('\u0000')
  const speakingSignature = participants
    .filter((participant) => speakers.has(participant.userId))
    .map((participant) => participant.userId)
    .join('\u0000')

  useEffect(() => {
    const activeParticipants = participantsRef.current
    const activeSpeakers = speakersRef.current
    const now = Date.now()
    for (const participant of activeParticipants) {
      if (activeSpeakers.has(participant.userId)) {
        lastSpokeAt.current.set(participant.userId, now)
      }
    }

    setVisibleUserIds((current) => {
      const currentPosition = new Map(current.map((userId, index) => [userId, index]))
      const participantPosition = new Map(
        activeParticipants.map((participant, index) => [participant.userId, index]),
      )
      const next = [...activeParticipants]
        .sort((left, right) => {
          const speakingDifference =
            Number(activeSpeakers.has(right.userId)) - Number(activeSpeakers.has(left.userId))
          if (speakingDifference) return speakingDifference
          const recencyDifference =
            (lastSpokeAt.current.get(right.userId) ?? 0) -
            (lastSpokeAt.current.get(left.userId) ?? 0)
          if (recencyDifference) return recencyDifference
          const leftCurrent = currentPosition.get(left.userId)
          const rightCurrent = currentPosition.get(right.userId)
          if (leftCurrent !== undefined || rightCurrent !== undefined) {
            return (
              (leftCurrent ?? Number.MAX_SAFE_INTEGER) - (rightCurrent ?? Number.MAX_SAFE_INTEGER)
            )
          }
          return (
            (participantPosition.get(left.userId) ?? 0) -
            (participantPosition.get(right.userId) ?? 0)
          )
        })
        .slice(0, MAX_DOCK_PARTICIPANTS)
        .map((participant) => participant.userId)
      return next.length === current.length &&
        next.every((userId, index) => userId === current[index])
        ? current
        : next
    })
  }, [participantSignature, speakingSignature])

  const visible = visibleUserIds
    .map((userId) => participants.find((participant) => participant.userId === userId))
    .filter((participant): participant is DockParticipant => !!participant)
  const extraCount = Math.max(0, participants.length - visible.length)

  return (
    <div
      aria-label="Call participants"
      style={{
        display: 'flex',
        alignItems: 'center',
        minWidth: 0,
        marginLeft: 2,
      }}
    >
      {visible.map((participant, index) => {
        const speaking = speakers.has(participant.userId)
        return (
          <Tooltip
            key={participant.userId}
            title={
              <span style={{ display: 'grid' }}>
                <span>{participant.name}</span>
                <span style={{ opacity: 0.72, fontSize: 11 }}>{participant.userId}</span>
              </span>
            }
          >
            <span
              role="button"
              tabIndex={0}
              aria-label={`Open ${participant.name}'s profile`}
              onClick={(event) => {
                event.stopPropagation()
                showUserProfile(
                  participant.userId,
                  event.currentTarget,
                  participant.name,
                  participant.avatarUrl,
                )
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                showUserProfile(
                  participant.userId,
                  event.currentTarget,
                  participant.name,
                  participant.avatarUrl,
                )
              }}
              style={{
                display: 'inline-flex',
                flex: '0 0 auto',
                marginLeft: index ? -7 : 0,
                padding: 2,
                borderRadius: '50%',
                background: speaking ? '#35c77a' : 'rgba(127,127,127,.35)',
                boxShadow: speaking
                  ? '0 0 0 2px rgba(53,199,122,.28), 0 0 12px rgba(53,199,122,.8)'
                  : 'none',
                transform: speaking ? 'scale(1.08)' : undefined,
                transition: 'background .15s, box-shadow .15s, transform .15s',
                zIndex: visible.length - index,
              }}
            >
              <MemberAvatar
                userId={participant.userId}
                name={participant.name}
                url={participant.avatarUrl}
                size={24}
                showPresenceTooltip={false}
              />
            </span>
          </Tooltip>
        )
      })}
      {extraCount > 0 && (
        <Tooltip title={`${extraCount} more in the call`}>
          <span
            style={{
              display: 'grid',
              placeItems: 'center',
              flex: '0 0 auto',
              width: 28,
              height: 28,
              marginLeft: -5,
              borderRadius: '50%',
              background: 'rgba(127,127,127,.24)',
              border: '1px solid rgba(127,127,127,.35)',
              fontSize: 11,
              fontWeight: 700,
              zIndex: 0,
            }}
          >
            +{extraCount}
          </span>
        </Tooltip>
      )}
    </div>
  )
}

export function VoiceCallHost() {
  const { message } = AntApp.useApp()
  const [room, setRoom] = useState<Room>()
  const [target, setTarget] = useState<HTMLElement>()
  const [dockTarget, setDockTarget] = useState<HTMLElement>()
  const [open, setOpen] = useState(false)
  const [focusedTile, setFocusedTile] = useState<string>()
  const [viewedScreenShares, setViewedScreenShares] = useState<Set<string>>(() => new Set())
  const [leaving, setLeaving] = useState(false)
  const [revision, setRevision] = useState(0)
  const [media, setMedia] = useState<ElementCallMedia[]>([])
  const [headphonesMuted, setHeadphonesMuted] = useState(false)
  const headphonesMutedRef = useRef(false)
  const [connectionStatus, setConnectionStatus] = useState<
    'starting' | 'connecting' | 'connected' | 'reconnecting' | 'failed'
  >('starting')
  const [controls, setControls] = useState({
    muted: false,
    camera: false,
    screen: false,
  })
  const [shareAudio, setShareAudio] = useState(true)
  const shareAudioRef = useRef(true)
  const [screenResolution, setScreenResolution] = useState<ScreenShareResolution>(
    preferredScreenShareResolution,
  )
  const screenResolutionRef = useRef(screenResolution)
  const [screenFrameRate, setScreenFrameRate] = useState<ScreenShareFrameRate>(
    preferredScreenShareFrameRate,
  )
  const screenFrameRateRef = useRef(screenFrameRate)
  const [screenContentHint, setScreenContentHint] = useState<ScreenShareContentHint>(
    preferredScreenShareContentHint,
  )
  const screenContentHintRef = useRef(screenContentHint)
  const [screenCursor, setScreenCursor] = useState(screenShareCursorEnabled)
  const screenCursorRef = useRef(screenCursor)
  const [screenBitrate, setScreenBitrate] = useState(preferredScreenShareBitrate)
  const screenBitrateRef = useRef(screenBitrate)
  const [shareSettingsOpen, setShareSettingsOpen] = useState(false)
  const shareSettingsOpenRef = useRef(false)
  const [inputMode, setInputMode] = useState<VoiceInputMode>(() => {
    const stored = voiceInputMode()
    return stored === 'push_to_talk' && !desktopPushToTalkAvailable() ? 'open' : stored
  })
  const inputModeRef = useRef(inputMode)
  inputModeRef.current = inputMode
  const voiceActivation = inputMode === 'voice_activation'
  const gatedInput = voiceActivation || inputMode === 'push_to_talk'
  const [activationThresholdMode, setActivationThresholdMode] =
    useState<VoiceActivationThresholdMode>(voiceActivationThresholdMode)
  const [activationThresholdDb, setActivationThresholdDb] = useState(voiceActivationThresholdDb)
  const activationThresholdModeRef = useRef(activationThresholdMode)
  const activationThresholdDbRef = useRef(activationThresholdDb)
  activationThresholdModeRef.current = activationThresholdMode
  activationThresholdDbRef.current = activationThresholdDb
  const [pttShortcut, setPttShortcut] = useState(pushToTalkShortcut)
  const [pushToTalkPressed, setPushToTalkPressed] = useState(false)
  const pushToTalkPressedRef = useRef(false)
  const [manuallyMuted, setManuallyMuted] = useState(false)
  const manuallyMutedRef = useRef(false)
  const [localVoiceDetected, setLocalVoiceDetected] = useState(false)
  const localSpeaking =
    localVoiceDetected &&
    (inputMode === 'open'
      ? !controls.muted
      : inputMode === 'voice_activation'
        ? !manuallyMuted
        : pushToTalkPressed && !manuallyMuted)
  const localSpeakingRef = useRef(localSpeaking)
  localSpeakingRef.current = localSpeaking
  const voiceEngineRef = useRef<VoiceActivation | undefined>(undefined)
  const micGateRef = useRef<ReturnType<typeof createMicrophoneGate> | undefined>(undefined)
  const lastAudioSignatureRef = useRef('')
  const iframe = useRef<HTMLIFrameElement>(null)
  const roomRef = useRef<Room | undefined>(room)
  const widgetDisconnectRef = useRef<(() => void) | undefined>(undefined)
  const leavingPromiseRef = useRef<Promise<void> | undefined>(undefined)
  roomRef.current = room
  const tileVideoRefs = useRef(new Map<string, { current: HTMLVideoElement | null }>())
  const [, bumpAudioMenu] = useState(0)
  const client = room ? matrixService.clientForRoom(room.roomId) : undefined
  const widgetId = room ? `foxchat-element-call-${encodeURIComponent(room.roomId)}` : ''
  useEffect(() => {
    const find = () => {
      setTarget(document.querySelector<HTMLElement>('[data-call-stage]') ?? undefined)
      setDockTarget(document.querySelector<HTMLElement>('[data-voice-dock]') ?? undefined)
    }
    const observer = new MutationObserver(find)
    observer.observe(document.body, { subtree: true, childList: true })
    find()
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const join = (event: Event) => {
      const nextRoom = (event as CustomEvent<Room>).detail
      const previousRoom = roomRef.current
      if (previousRoom && previousRoom.roomId !== nextRoom.roomId) {
        const previousClient = matrixService.clientForRoomInstance(previousRoom)
        widgetDisconnectRef.current?.()
        if (previousClient)
          void leaveElementCall(previousClient, previousRoom).catch((error) =>
            console.warn('[element-call] Could not withdraw the previous call membership', error),
          )
      }
      headphonesMutedRef.current = false
      setHeadphonesMuted(false)
      manuallyMutedRef.current = false
      setManuallyMuted(false)
      setFocusedTile(undefined)
      setViewedScreenShares(new Set())
      setConnectionStatus('starting')
      setLeaving(false)
      roomRef.current = nextRoom
      setRoom(nextRoom)
      setOpen(true)
    }
    const navigate = () => setOpen(false)
    window.addEventListener('foxchat-join-voice', join)
    window.addEventListener('foxchat-room-navigated', navigate)
    return () => {
      window.removeEventListener('foxchat-join-voice', join)
      window.removeEventListener('foxchat-room-navigated', navigate)
    }
  }, [])
  useEffect(() => {
    const applyMode = (mode: VoiceInputMode) => {
      const supportedMode = mode === 'push_to_talk' && !desktopPushToTalkAvailable() ? 'open' : mode
      manuallyMutedRef.current = false
      setManuallyMuted(false)
      setInputMode(supportedMode)
    }
    const onModeChange = (event: Event) => applyMode((event as CustomEvent<VoiceInputMode>).detail)
    const onThresholdChange = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          mode: VoiceActivationThresholdMode
          thresholdDb: number
        }>
      ).detail
      setActivationThresholdMode(detail.mode)
      setActivationThresholdDb(detail.thresholdDb)
      voiceEngineRef.current?.setManualThreshold(
        inputModeRef.current === 'voice_activation' && detail.mode === 'manual'
          ? detail.thresholdDb
          : undefined,
      )
    }
    const onShortcutChange = (event: Event) => setPttShortcut((event as CustomEvent<string>).detail)
    const onMicrophoneVolumeChange = (event: Event) =>
      micGateRef.current?.setVolume((event as CustomEvent<number>).detail)
    window.addEventListener(VOICE_INPUT_MODE_CHANGED_EVENT, onModeChange)
    window.addEventListener(VOICE_ACTIVATION_THRESHOLD_CHANGED_EVENT, onThresholdChange)
    window.addEventListener(PUSH_TO_TALK_SHORTCUT_CHANGED_EVENT, onShortcutChange)
    window.addEventListener(MICROPHONE_VOLUME_CHANGED_EVENT, onMicrophoneVolumeChange)
    return () => {
      window.removeEventListener(VOICE_INPUT_MODE_CHANGED_EVENT, onModeChange)
      window.removeEventListener(VOICE_ACTIVATION_THRESHOLD_CHANGED_EVENT, onThresholdChange)
      window.removeEventListener(PUSH_TO_TALK_SHORTCUT_CHANGED_EVENT, onShortcutChange)
      window.removeEventListener(MICROPHONE_VOLUME_CHANGED_EVENT, onMicrophoneVolumeChange)
    }
  }, [])
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('foxchat-call-view-changed', { detail: open }))
  }, [open])
  useEffect(
    () => () => {
      window.dispatchEvent(new CustomEvent('foxchat-call-view-changed', { detail: false }))
    },
    [],
  )
  useEffect(() => {
    shareSettingsOpenRef.current = shareSettingsOpen
  }, [shareSettingsOpen])
  useEffect(() => {
    const report = (event: Event) => {
      const result = (event as CustomEvent<{ requested: boolean; available: boolean }>).detail
      if (result.requested && !result.available)
        message.warning(
          'The selected source did not provide audio. In the browser picker, enable audio if offered; some browsers, windows, and devices cannot share system audio.',
          7,
        )
    }
    window.addEventListener(SCREEN_SHARE_AUDIO_RESULT_EVENT, report)
    return () => window.removeEventListener(SCREEN_SHARE_AUDIO_RESULT_EVENT, report)
  }, [message])
  useEffect(() => {
    const back = () => {
      if (shareSettingsOpenRef.current) setShareSettingsOpen(false)
    }
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [])
  useEffect(() => {
    if (!client || !room || !iframe.current) return
    const disconnectWidget = connectElementCallWidget(
      client,
      room,
      iframe.current,
      widgetId,
      () => shareAudioRef.current,
      () => screenResolutionRef.current,
      () => screenFrameRateRef.current,
      () => screenContentHintRef.current,
      () => screenCursorRef.current,
      () => screenBitrateRef.current,
    )
    const gate = createMicrophoneGate(iframe.current)
    micGateRef.current = gate
    let disconnected = false
    const disconnect = () => {
      if (disconnected) return
      disconnected = true
      disconnectWidget()
      gate.disconnect()
      if (micGateRef.current === gate) micGateRef.current = undefined
      if (widgetDisconnectRef.current === disconnect) widgetDisconnectRef.current = undefined
    }
    widgetDisconnectRef.current = disconnect
    return disconnect
  }, [client, room, widgetId])
  useEffect(() => {
    if (!room) return
    if (inputModeRef.current !== 'open') micGateRef.current?.setEnabled(false)
    const engine = new VoiceActivation(
      (speaking) => {
        setLocalVoiceDetected(speaking)
        if (inputModeRef.current !== 'voice_activation') return
        const manuallyMuted = manuallyMutedRef.current
        micGateRef.current?.setEnabled(!manuallyMuted && speaking, !manuallyMuted && !speaking)
      },
      undefined,
      () => {
        if (inputModeRef.current === 'voice_activation' && !manuallyMutedRef.current)
          micGateRef.current?.extendTail()
      },
      inputModeRef.current === 'voice_activation' && activationThresholdModeRef.current === 'manual'
        ? activationThresholdDbRef.current
        : undefined,
    )
    voiceEngineRef.current = engine
    void engine
      .start(preferredMicrophoneId())
      .catch((error) =>
        console.warn('[voice-activation] Could not start microphone monitoring', error),
      )
    return () => {
      engine.stop()
      voiceEngineRef.current = undefined
      setLocalVoiceDetected(false)
      micGateRef.current?.setEnabled(true)
    }
  }, [room])
  useEffect(() => {
    if (!room) return
    voiceEngineRef.current?.setManualThreshold(
      inputMode === 'voice_activation' && activationThresholdModeRef.current === 'manual'
        ? activationThresholdDbRef.current
        : undefined,
    )
    if (inputMode === 'open') {
      micGateRef.current?.setEnabled(true)
      return
    }
    if (inputMode === 'voice_activation') {
      micGateRef.current?.setEnabled(
        !manuallyMutedRef.current && (voiceEngineRef.current?.isSpeaking ?? false),
      )
      return
    }
    micGateRef.current?.setEnabled(!manuallyMutedRef.current && pushToTalkPressedRef.current)
  }, [room, inputMode])
  useEffect(() => {
    if (!room || inputMode !== 'push_to_talk' || !desktopPushToTalkAvailable()) return

    let disposed = false
    let unregister: (() => Promise<void>) | undefined
    pushToTalkPressedRef.current = false
    setPushToTalkPressed(false)
    micGateRef.current?.setEnabled(false)
    const updatePressed = (pressed: boolean) => {
      if (disposed) return
      pushToTalkPressedRef.current = pressed
      setPushToTalkPressed(pressed)
      micGateRef.current?.setEnabled(pressed && !manuallyMutedRef.current)
    }
    void registerPushToTalk(pttShortcut, updatePressed)
      .then((cleanup) => {
        if (disposed) void cleanup()
        else unregister = cleanup
      })
      .catch((error) => {
        if (disposed) return
        message.error(
          error instanceof Error
            ? `Could not register push to talk: ${error.message}`
            : 'Could not register the push-to-talk shortcut',
        )
      })
    return () => {
      disposed = true
      pushToTalkPressedRef.current = false
      setPushToTalkPressed(false)
      micGateRef.current?.setEnabled(true)
      if (unregister) void unregister()
    }
  }, [room, inputMode, pttShortcut, message])
  useEffect(() => {
    const applyPreroll = () =>
      micGateRef.current?.setDelay(voiceActivation ? voiceActivationPrerollMs() : 0)
    applyPreroll()
    window.addEventListener(VOICE_ACTIVATION_PREROLL_CHANGED_EVENT, applyPreroll)
    return () => window.removeEventListener(VOICE_ACTIVATION_PREROLL_CHANGED_EVENT, applyPreroll)
  }, [room, voiceActivation])
  useEffect(() => {
    const frame = iframe.current
    if (!frame || !room) return
    let observer: MutationObserver | undefined
    let mediaTimer: number | undefined
    let speakerTimer: number | undefined
    let speakerSignature = ''
    const joinedButtons = new WeakSet<Element>()
    const text = (node: Element) =>
      `${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('title') ?? ''} ${node.textContent ?? ''}`.trim()
    const publishSpeakers = () => {
      const activeUserIds = new Set(VoiceAudioMixer.activeMicrophoneUsers())
      const ownUserId = client?.getUserId()
      if (ownUserId && localSpeakingRef.current) activeUserIds.add(ownUserId)
      const userIds = [...activeUserIds]
      const nextSignature = userIds.sort().join('\u0000')
      if (nextSignature === speakerSignature) return
      speakerSignature = nextSignature
      matrixRTCActiveSpeakers.set(room.roomId, new Set(userIds))
      setRevision((value) => value + 1)
      window.dispatchEvent(
        new CustomEvent(voiceSpeakerEvent, {
          detail: { roomId: room.roomId, userIds },
        }),
      )
    }
    const publish = () => {
      const document = frame.contentDocument
      if (!document) return
      for (const audio of document.querySelectorAll<HTMLAudioElement>('audio'))
        if (!VoiceAudioMixer.isManaged(audio)) audio.muted = headphonesMutedRef.current
      const voiceMembers = matrixRTCVoiceMembers(client, room)
      const audioMatches = VoiceAudioMixer.scanAudioElements(
        document,
        voiceMembers,
        client?.getUserId() ?? undefined,
      )
      for (const match of audioMatches)
        VoiceAudioMixer.attach(match.element, match.userId, match.source)
      const taggedCount = document.querySelectorAll('[data-lk-source]').length
      const audioTagCount = document.querySelectorAll('audio').length
      const signature = `${taggedCount}|${audioTagCount}|${audioMatches
        .map((match) => `${match.userId}:${match.source}`)
        .sort()
        .join(',')}`
      if (signature !== lastAudioSignatureRef.current) {
        lastAudioSignatureRef.current = signature
        console.debug('[voice] audio element matches', {
          elementsWithDataLkSource: taggedCount,
          audioTags: audioTagCount,
          matched: audioMatches.map((match) => ({
            userId: match.userId,
            source: match.source,
          })),
          members: voiceMembers.map((member) => member.userId),
        })
      }
      for (const button of document.querySelectorAll('button'))
        if (/^join(?: call)?$/i.test(text(button)) && !joinedButtons.has(button)) {
          joinedButtons.add(button)
          ;(button as HTMLButtonElement).click()
          break
        }
      const pageText = document.body.textContent ?? ''
      const hasCallControls = !!document.querySelector('[data-testid="incall_leave"]')
      setConnectionStatus(
        hasCallControls
          ? 'connected'
          : /reconnect/i.test(pageText)
            ? 'reconnecting'
            : /failed|unable to connect|connection error/i.test(pageText)
              ? 'failed'
              : 'connecting',
      )
      const audioControl = document.querySelector<HTMLElement>('[data-testid="incall_mute"]')
      const cameraControl =
        document.querySelector<HTMLElement>('[data-testid="incall_videomute"]') ??
        document.querySelector<HTMLElement>('[title="Camera Source"] button')
      const screenControl = document.querySelector<HTMLElement>(
        '[data-testid="incall_screenshare"]',
      )
      setControls({
        muted: audioControl?.getAttribute('aria-checked') !== 'true',
        camera: cameraControl?.getAttribute('aria-checked') === 'true',
        screen: screenControl?.getAttribute('aria-checked') === 'true',
      })
      const nextMedia = [...document.querySelectorAll<HTMLVideoElement>('video')].flatMap(
        (video, index) => {
          const candidate = video.srcObject as
            | (MediaStream & { getVideoTracks?: () => MediaStreamTrack[] })
            | null
          const stream =
            candidate && typeof candidate.getVideoTracks === 'function' ? candidate : undefined
          if (!stream || !stream.getVideoTracks().some((track) => track.readyState === 'live'))
            return []
          const container = video.closest<HTMLElement>('[class*="tile"],li,article')
          const hints = [
            container?.textContent,
            container?.getAttribute('aria-label'),
            container?.title,
            video.getAttribute('aria-label'),
            ...Object.values(video.dataset),
            ...Object.values(container?.dataset ?? {}),
          ]
          for (const node of container?.querySelectorAll<HTMLElement>(
            '[aria-label],[title],[data-participant-identity],[data-lk-participant-identity]',
          ) ?? [])
            hints.push(node.getAttribute('aria-label'), node.title, ...Object.values(node.dataset))
          let ancestor: HTMLElement | null = video.parentElement
          for (let depth = 0; ancestor && depth < 7; depth++, ancestor = ancestor.parentElement) {
            hints.push(
              ancestor.getAttribute('aria-label'),
              ancestor.title,
              ...Object.values(ancestor.dataset),
            )
          }
          const identityHints = hints.filter(Boolean).join(' ')
          const label =
            container?.textContent?.trim() ||
            video.getAttribute('aria-label') ||
            `Video ${index + 1}`
          const isOwn =
            video.dataset.lkLocalParticipant === 'true' ||
            video.closest('[data-lk-local-participant="true"]') != null
          const remoteMembers = voiceMembers.filter(
            (member) => member.userId !== client?.getUserId(),
          )
          const isScreen =
            video.dataset.lkSource === 'screen_share' ||
            /screen.?share|screenshare|screen|present/i.test(
              `${label} ${container?.className ?? ''} ${identityHints}`,
            )
          const audioUserId = audioMatches.find(
            (match) => match.element.closest('[class*="tile"],li,article') === container,
          )?.userId
          const uniqueScreenAudioUserId = isScreen
            ? [
                ...new Set(
                  audioMatches
                    .filter((match) => match.source === 'screen_share_audio')
                    .map((match) => match.userId),
                ),
              ]
            : []
          const userId = isOwn
            ? (client?.getUserId() ?? undefined)
            : (audioUserId ??
              remoteMembers.find(
                (member) =>
                  identityHints.includes(member.userId) ||
                  identityHints.includes(matrixMemberDisplayName(member, client)),
              )?.userId ??
              (uniqueScreenAudioUserId.length === 1 ? uniqueScreenAudioUserId[0] : undefined) ??
              (remoteMembers.length === 1 ? remoteMembers[0].userId : undefined))
          return [
            {
              id: stream.id || `${index}`,
              stream,
              label,
              screen: isScreen,
              muted: video.muted,
              own: isOwn,
              userId,
            },
          ]
        },
      )
      setMedia((current) =>
        current.length === nextMedia.length &&
        current.every(
          (item, index) =>
            item.id === nextMedia[index]?.id && item.label === nextMedia[index]?.label,
        )
          ? current
          : nextMedia,
      )
      setRevision((value) => value + 1)
    }
    const attach = () => {
      observer?.disconnect()
      if (mediaTimer !== undefined) window.clearInterval(mediaTimer)
      if (speakerTimer !== undefined) window.clearInterval(speakerTimer)
      setConnectionStatus('connecting')
      const body = frame.contentDocument?.body
      if (!body) return
      observer = new MutationObserver(publish)
      observer.observe(body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'aria-label', 'aria-pressed', 'title'],
        childList: true,
        characterData: true,
      })
      mediaTimer = window.setInterval(publish, 750)
      speakerTimer = window.setInterval(publishSpeakers, 100)
      publish()
      publishSpeakers()
    }
    frame.addEventListener('load', attach)
    attach()
    return () => {
      frame.removeEventListener('load', attach)
      observer?.disconnect()
      if (mediaTimer !== undefined) window.clearInterval(mediaTimer)
      if (speakerTimer !== undefined) window.clearInterval(speakerTimer)
      setMedia([])
      closeAllPopouts()
      window.dispatchEvent(
        new CustomEvent(voiceSpeakerEvent, {
          detail: { roomId: room.roomId, userIds: [] },
        }),
      )
    }
  }, [client, room])
  useEffect(() => {
    const ids = new Set(media.map((item) => item.id))
    for (const id of activePopoutIds()) if (!ids.has(id)) closePopout(id)
  }, [media])
  const clickControl = (testId: string, fallback?: string) => {
    const document = iframe.current?.contentDocument
    const target =
      document?.querySelector<HTMLElement>(`[data-testid="${testId}"]`) ??
      (fallback ? document?.querySelector<HTMLElement>(fallback) : undefined)
    const button = target?.matches('button')
      ? target
      : target?.querySelector<HTMLButtonElement>('button')
    if (button) button.click()
    else message.warning('That call control is not available yet')
  }
  const toggleHeadphones = () => {
    const muted = !headphonesMutedRef.current
    headphonesMutedRef.current = muted
    setHeadphonesMuted(muted)
    VoiceAudioMixer.setMasterMuted(muted)
    for (const audio of iframe.current?.contentDocument?.querySelectorAll<HTMLAudioElement>(
      'audio',
    ) ?? [])
      if (!VoiceAudioMixer.isManaged(audio)) audio.muted = muted
  }
  useEffect(() => {
    if (!room || !gatedInput || !controls.muted) return
    const target = iframe.current?.contentDocument?.querySelector<HTMLElement>(
      '[data-testid="incall_mute"]',
    )
    const button = target?.matches('button')
      ? target
      : target?.querySelector<HTMLButtonElement>('button')
    button?.click()
  }, [room, gatedInput, controls.muted])
  const toggleMute = () => {
    if (!gatedInput) {
      clickControl('incall_mute')
      return
    }
    const muted = !manuallyMutedRef.current
    manuallyMutedRef.current = muted
    setManuallyMuted(muted)
    const inputActive =
      inputMode === 'voice_activation'
        ? (voiceEngineRef.current?.isSpeaking ?? false)
        : pushToTalkPressedRef.current
    micGateRef.current?.setEnabled(!muted && inputActive)
  }
  const leave = async () => {
    if (!client || !room) return
    if (leavingPromiseRef.current) return leavingPromiseRef.current
    const leavingClient = client
    const leavingRoom = room
    setLeaving(true)
    const task = (async () => {
      const target = iframe.current?.contentDocument?.querySelector<HTMLElement>(
        '[data-testid="incall_leave"]',
      )
      const button = target?.matches('button')
        ? (target as HTMLButtonElement)
        : target?.querySelector<HTMLButtonElement>('button')
      // Stop Element Call before withdrawing membership.
      button?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 180))
      widgetDisconnectRef.current?.()
      try {
        await leaveElementCall(leavingClient, leavingRoom)
      } catch (error) {
        // Always tear down local media.
        message.warning(
          error instanceof Error
            ? `Left locally, but the server cleanup is still pending: ${error.message}`
            : 'Left locally, but the server cleanup is still pending',
        )
      } finally {
        if (roomRef.current === leavingRoom) {
          roomRef.current = undefined
          setRoom(undefined)
          setOpen(false)
        }
      }
    })()
    leavingPromiseRef.current = task
    try {
      await task
    } finally {
      if (leavingPromiseRef.current === task) leavingPromiseRef.current = undefined
      setLeaving(false)
    }
  }
  const setShareAudioMode = (audio: boolean) => {
    shareAudioRef.current = audio
    setShareAudio(audio)
  }
  const setScreenResolutionMode = (resolution: ScreenShareResolution) => {
    screenResolutionRef.current = resolution
    setScreenResolution(resolution)
    localStorage.setItem(SCREEN_SHARE_RESOLUTION_KEY, resolution)
  }
  const setScreenFrameRateMode = (frameRate: ScreenShareFrameRate) => {
    screenFrameRateRef.current = frameRate
    setScreenFrameRate(frameRate)
    localStorage.setItem(SCREEN_SHARE_FRAME_RATE_KEY, String(frameRate))
  }
  const setScreenContentHintMode = (contentHint: ScreenShareContentHint) => {
    screenContentHintRef.current = contentHint
    setScreenContentHint(contentHint)
    localStorage.setItem(SCREEN_SHARE_CONTENT_HINT_KEY, contentHint)
  }
  const setScreenCursorMode = (enabled: boolean) => {
    screenCursorRef.current = enabled
    setScreenCursor(enabled)
    localStorage.setItem(SCREEN_SHARE_CURSOR_KEY, String(enabled))
  }
  const setScreenBitrateMode = (bitrate: number) => {
    screenBitrateRef.current = bitrate
    setScreenBitrate(bitrate)
    localStorage.setItem(SCREEN_SHARE_BITRATE_KEY, String(bitrate))
  }
  const openShareSettings = () => {
    if (!shareSettingsOpenRef.current) {
      history.pushState({ ...history.state, foxchatCallShareSettings: true }, '')
    }
    setShareSettingsOpen(true)
  }
  const closeShareSettings = () => {
    if (history.state?.foxchatCallShareSettings) history.back()
    else setShareSettingsOpen(false)
  }
  const startScreenShare = () => {
    clickControl('incall_screenshare')
    closeShareSettings()
  }
  const switchScreenShareSource = () => {
    clickControl('incall_screenshare')
    window.setTimeout(() => clickControl('incall_screenshare'), 400)
  }
  const applyScreenShareQuality = () => {
    switchScreenShareSource()
    closeShareSettings()
  }
  const showCall = () => {
    if (!room) return
    window.dispatchEvent(new CustomEvent('foxchat-open-room', { detail: room.roomId }))
    setOpen(true)
  }
  const togglePopout = (tileKey: string, media: ElementCallMedia) => {
    if (isPopoutOpen(media.id)) {
      closePopout(media.id)
      bumpAudioMenu((value) => value + 1)
      return
    }
    const video = tileVideoRefs.current.get(tileKey)?.current
    if (!video) {
      message.warning('That screen share is not ready yet')
      return
    }
    openPopout(media.id, video, media.label)
    bumpAudioMenu((value) => value + 1)
  }
  useEffect(() => {
    if (!target) return
    const label = {
      starting: 'Starting call…',
      connecting: 'Connecting…',
      connected: 'Connected',
      reconnecting: 'Reconnecting…',
      failed: 'Connection failed',
    }[connectionStatus]
    target.dataset.callOpen = String(open && !!room)
    target.dataset.callStatus = label
    target.dataset.callStatusState = connectionStatus
    return () => {
      delete target.dataset.callOpen
      delete target.dataset.callStatus
      delete target.dataset.callStatusState
    }
  }, [target, open, room, connectionStatus])
  const automationMuted = gatedInput ? manuallyMuted : controls.muted
  const automationClickControl = useRef(clickControl)
  const automationToggleMute = useRef(toggleMute)
  const automationLeave = useRef(leave)
  automationClickControl.current = clickControl
  automationToggleMute.current = toggleMute
  automationLeave.current = leave
  useEffect(() => {
    if (!room) return
    const screenshares = media
      .filter((item) => item.screen && item.userId)
      .map((item) => item.userId!)
    const viewed = media
      .filter((item) => item.screen && item.userId && viewedScreenShares.has(`media:${item.id}`))
      .map((item) => item.userId!)
    window.dispatchEvent(
      new CustomEvent('foxchat-call-state', {
        detail: {
          room_id: room.roomId,
          active: open,
          input: {
            microphone_muted: automationMuted,
            camera_enabled: controls.camera,
            screen_sharing: controls.screen,
          },
          screenshares: [...new Set(screenshares)],
          viewed_screenshares: [...new Set(viewed)],
        },
      }),
    )
  }, [room, open, automationMuted, controls.camera, controls.screen, media, viewedScreenShares])
  useEffect(() => {
    if (!room) return
    const command = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          method: string
          params: Record<string, unknown>
          resolve: (value: unknown) => void
          reject: (reason: unknown) => void
        }>
      ).detail
      if (typeof detail.params.room_id === 'string' && detail.params.room_id !== room.roomId) return
      try {
        if (detail.method === 'call.input.get') {
          detail.resolve({
            room_id: room.roomId,
            microphone_muted: automationMuted,
            camera_enabled: controls.camera,
            screen_sharing: controls.screen,
          })
          return
        }
        if (detail.method === 'call.input.set') {
          if (
            typeof detail.params.microphone_muted === 'boolean' &&
            detail.params.microphone_muted !== automationMuted
          )
            automationToggleMute.current()
          if (
            typeof detail.params.camera_enabled === 'boolean' &&
            detail.params.camera_enabled !== controls.camera
          )
            automationClickControl.current('incall_videomute', '[title="Camera Source"]')
          if (
            typeof detail.params.screen_sharing === 'boolean' &&
            detail.params.screen_sharing !== controls.screen
          )
            automationClickControl.current('incall_screenshare')
          detail.resolve({ room_id: room.roomId, accepted: true })
          return
        }
        if (detail.method === 'call.leave') {
          void automationLeave
            .current()
            .then(() => detail.resolve({ room_id: room.roomId, active: false }))
            .catch(detail.reject)
          return
        }
        const userId = String(detail.params.user_id ?? '')
        if (!userId) throw new Error('user_id is required')
        const share = media.find((item) => item.screen && item.userId === userId)
        if (!share) throw new Error(`No screen share is available for ${userId}`)
        const key = `media:${share.id}`
        if (detail.method === 'call.screenshare.view') {
          setViewedScreenShares((current) => new Set(current).add(key))
          setFocusedTile(key)
          detail.resolve({ room_id: room.roomId, user_id: userId, viewing: true })
          return
        }
        if (detail.method === 'call.screenshare.leave') {
          setViewedScreenShares((current) => {
            const next = new Set(current)
            next.delete(key)
            return next
          })
          setFocusedTile((current) => (current === key ? undefined : current))
          detail.resolve({ room_id: room.roomId, user_id: userId, viewing: false })
        }
      } catch (error) {
        detail.reject(error)
      }
    }
    window.addEventListener('foxchat-automation-call-command', command)
    return () => window.removeEventListener('foxchat-automation-call-command', command)
  }, [room, automationMuted, controls.camera, controls.screen, media, inputMode])
  if (!client || !room) return null
  const displayMuted = gatedInput ? manuallyMuted : controls.muted
  const pushToTalkTransmitting = inputMode === 'push_to_talk' && pushToTalkPressed && !manuallyMuted
  const microphoneModeHint =
    inputMode === 'voice_activation'
      ? ' (voice activation active)'
      : inputMode === 'push_to_talk'
        ? ` (hold ${pushToTalkShortcutLabel(pttShortcut)} to talk${pushToTalkTransmitting ? ', transmitting' : ''})`
        : ''
  const members = matrixRTCVoiceMembers(client, room)
  const ownMember = room.getMember(client.getSafeUserId())
  if (ownMember && !members.some((member) => member.userId === ownMember.userId))
    members.unshift(ownMember)
  const ownUserId = client.getSafeUserId()
  const speakers = new Set(matrixRTCActiveSpeakers.get(room.roomId) ?? [])
  if (localSpeaking) speakers.add(ownUserId)
  const mediaUsers = new Set(media.map((item) => item.userId).filter(Boolean))
  type DashboardTile = {
    key: string
    media?: ElementCallMedia
    member?: (typeof members)[number]
  }
  const tiles: DashboardTile[] = [
    ...media.map((item) => ({
      key: `media:${item.id}`,
      media: item,
      member:
        members.find((member) => member.userId === item.userId) ??
        (item.userId ? (room.getMember(item.userId) ?? undefined) : undefined),
    })),
    ...members
      .filter((member) => !mediaUsers.has(member.userId))
      .map((member) => ({ key: `member:${member.userId}`, member })),
  ]
  const selected = focusedTile ? tiles.find((tile) => tile.key === focusedTile) : undefined
  const isViewedScreenShare = (tile: DashboardTile) =>
    !tile.media?.screen || tile.media.own || viewedScreenShares.has(tile.key)
  const stopViewingScreenShare = (tile: DashboardTile) => {
    setViewedScreenShares((current) => {
      const next = new Set(current)
      next.delete(tile.key)
      return next
    })
    setFocusedTile((current) => (current === tile.key ? undefined : current))
  }
  const viewedScreenTiles = tiles.filter(
    (tile) => tile.media?.screen && !tile.media.own && isViewedScreenShare(tile),
  )
  const nonStageTiles = tiles.filter(
    (tile) => !viewedScreenTiles.some((screen) => screen.key === tile.key),
  )
  const renderCallTile = (tile: DashboardTile, large = false) => {
    const member = tile.member
    const name =
      (member ? matrixMemberDisplayName(member, client) : undefined) ||
      tile.media?.label ||
      tile.media?.userId ||
      'Call participant'
    const userId = member?.userId || tile.media?.userId || (tile.media?.own ? ownUserId : undefined)
    const speaking = !!userId && speakers.has(userId)
    const isOwn = !!userId && userId === ownUserId
    const videoRef = tile.media
      ? (tileVideoRefs.current.get(tile.key) ??
        (() => {
          const ref = { current: null }
          tileVideoRefs.current.set(tile.key, ref)
          return ref
        })())
      : undefined
    const showPopout = !!tile.media?.screen
    const showMute = showPopout && !isOwn && !!userId
    const screenMuted = userId ? VoiceAudioMixer.getScreenshareAudioMuted(userId) : false
    const popoutActive = !!tile.media && isPopoutOpen(tile.media.id)
    const screenShareWaiting = !!tile.media?.screen && !isViewedScreenShare(tile)
    const body = (
      <button
        type="button"
        key={tile.key}
        className={`callTile ${speaking ? 'speaking' : ''}`}
        onClick={() => {
          if (screenShareWaiting) return
          setFocusedTile((current) => (current === tile.key ? undefined : tile.key))
        }}
        style={{
          position: 'relative',
          display: 'grid',
          placeItems: 'center',
          width: '100%',
          height: '100%',
          minHeight: large ? 360 : 190,
          padding: 0,
          overflow: 'hidden',
          border: speaking ? '3px solid #3b9dff' : '1px solid rgba(127,127,127,.2)',
          borderRadius: 16,
          background: 'rgba(127,127,127,.09)',
          color: 'inherit',
          cursor: 'pointer',
        }}
      >
        {tile.media && !screenShareWaiting ? (
          tile.media.screen ? (
            <ZoomableScreenShare media={tile.media} videoRef={videoRef} />
          ) : (
            <ElementCallVideo media={tile.media} videoRef={videoRef} />
          )
        ) : screenShareWaiting ? (
          <span
            style={{
              display: 'grid',
              justifyItems: 'center',
              gap: 12,
              padding: 20,
            }}
          >
            {member ? (
              <MemberAvatar
                userId={member.userId}
                name={name}
                url={client.getUser(member.userId)?.avatarUrl ?? member.getMxcAvatarUrl()}
                size={72}
              />
            ) : (
              <DesktopOutlined style={{ fontSize: 42, opacity: 0.65 }} />
            )}
            <strong>{name} is sharing their screen</strong>
            <Button
              type="primary"
              icon={<DesktopOutlined />}
              onClick={(event) => {
                event.stopPropagation()
                setViewedScreenShares((current) => new Set(current).add(tile.key))
              }}
            >
              View screen
            </Button>
          </span>
        ) : member ? (
          <span style={{ display: 'inline-flex', borderRadius: '50%' }}>
            <MemberAvatar
              userId={member.userId}
              name={name}
              url={client.getUser(member.userId)?.avatarUrl ?? member.getMxcAvatarUrl()}
              size={large ? 112 : 72}
            />
          </span>
        ) : null}
        {(showPopout || showMute) && (
          <span
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              display: 'flex',
              gap: 6,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {showPopout && (
              <Tooltip title={popoutActive ? 'Close popout' : 'Pop out'}>
                <IconBtn
                  size="small"
                  shape="circle"
                  type={popoutActive ? 'primary' : 'default'}
                  icon={<ExpandOutlined />}
                  onClick={() => togglePopout(tile.key, tile.media!)}
                />
              </Tooltip>
            )}
            {showMute && (
              <Tooltip
                title={screenMuted ? 'Unmute screen share audio' : 'Mute screen share audio'}
              >
                <IconBtn
                  size="small"
                  shape="circle"
                  danger={screenMuted}
                  icon={screenMuted ? <AudioMutedOutlined /> : <SoundOutlined />}
                  onClick={() => {
                    VoiceAudioMixer.setScreenshareAudioMuted(userId!, !screenMuted)
                    bumpAudioMenu((value) => value + 1)
                  }}
                />
              </Tooltip>
            )}
          </span>
        )}
        <span
          style={{
            position: 'absolute',
            left: 10,
            bottom: 10,
            maxWidth: 'calc(100% - 20px)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            padding: '4px 8px',
            borderRadius: 8,
            background: 'rgba(0,0,0,.66)',
            color: 'white',
            fontSize: 11,
          }}
        >
          {isOwn ? 'You · ' : ''}
          {name}
          {tile.media?.screen ? ' · Screen' : ''}
        </span>
      </button>
    )
    const audioMenu = userId
      ? participantAudioMenu(
          userId,
          () => bumpAudioMenu((value) => value + 1),
          media.some(
            (item) =>
              item.screen && item.userId === userId && item.stream.getAudioTracks().length > 0,
          ),
        ).items
      : []
    const menuItems =
      tile.media?.screen && !isOwn && !screenShareWaiting
        ? [
            ...audioMenu,
            { type: 'divider' as const },
            {
              key: 'stop-viewing-screen',
              label: 'Stop viewing',
              icon: <StopOutlined />,
              onClick: () => stopViewingScreenShare(tile),
            },
          ]
        : audioMenu
    const hasContextMenu = !isOwn && (!!userId || (!!tile.media?.screen && !screenShareWaiting))
    return hasContextMenu ? (
      <Dropdown key={tile.key} trigger={['contextMenu']} menu={{ items: menuItems }}>
        {body}
      </Dropdown>
    ) : (
      body
    )
  }
  void revision
  return (
    <>
      <iframe
        ref={iframe}
        aria-hidden
        title={`${room.name} call engine`}
        src={elementCallUrl(client, room, widgetId)}
        allow="camera; microphone; display-capture; autoplay; fullscreen"
        style={{
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100vh',
          opacity: 0.001,
          pointerEvents: 'none',
          border: 0,
          zIndex: -1,
        }}
      />
      {target &&
        createPortal(
          <>
            <Button
              type="primary"
              icon={<SoundOutlined />}
              onClick={showCall}
              style={{
                position: 'absolute',
                zIndex: 19,
                right: 20,
                bottom: 92,
                borderRadius: 18,
                boxShadow: '0 8px 26px rgba(0,0,0,.28)',
              }}
            >
              {room.name} · Voice
            </Button>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 20,
                background: 'var(--ant-color-bg-container,#101114)',
                display: open ? 'flex' : 'none',
                flexDirection: 'column',
                padding: 20,
                overflow: 'auto',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginBottom: 24,
                }}
              >
                <SoundOutlined style={{ fontSize: 22, color: '#35c978' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2 style={{ margin: 0, fontSize: 18 }}>{room.name}</h2>
                  <span style={{ opacity: 0.65, fontSize: 12 }}>{members.length} in voice</span>
                </div>
                <Button onClick={() => setOpen(false)}>Back to chat</Button>
              </div>
              {selected ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                    flex: 1,
                    minHeight: 0,
                  }}
                >
                  <div style={{ flex: '1 1 0', minHeight: 280 }}>
                    {renderCallTile(selected, true)}
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridAutoFlow: 'column',
                      gridAutoColumns: 'minmax(130px,190px)',
                      gap: 10,
                      overflowX: 'auto',
                      paddingBottom: 4,
                    }}
                  >
                    {tiles
                      .filter((tile) => tile.key !== selected.key)
                      .map((tile) => (
                        <div key={tile.key} style={{ height: 115 }}>
                          {renderCallTile(tile)}
                        </div>
                      ))}
                  </div>
                </div>
              ) : viewedScreenTiles.length ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                    flex: 1,
                    minHeight: 0,
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${viewedScreenTiles.length},minmax(0,1fr))`,
                      gap: 14,
                      flex: '1 1 0',
                      minHeight: 280,
                      overflowX: 'auto',
                    }}
                  >
                    {viewedScreenTiles.map((tile) => (
                      <div
                        key={tile.key}
                        style={{ minWidth: viewedScreenTiles.length > 2 ? 360 : 0 }}
                      >
                        {renderCallTile(tile, true)}
                      </div>
                    ))}
                  </div>
                  {nonStageTiles.length > 0 && (
                    <div
                      style={{
                        display: 'grid',
                        gridAutoFlow: 'column',
                        gridAutoColumns: 'minmax(130px,190px)',
                        gap: 10,
                        overflowX: 'auto',
                        paddingBottom: 4,
                      }}
                    >
                      {nonStageTiles.map((tile) => (
                        <div key={tile.key} style={{ height: 115 }}>
                          {renderCallTile(tile)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(auto-fit,minmax(min(${tiles.length <= 2 ? 360 : tiles.length <= 4 ? 270 : 210}px,100%),1fr))`,
                    gridAutoRows: `minmax(${tiles.length <= 2 ? 300 : 220}px,1fr)`,
                    gap: 14,
                    flex: 1,
                    alignContent: 'stretch',
                  }}
                >
                  {tiles.map((tile) => renderCallTile(tile))}
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                  gap: 10,
                  paddingTop: 22,
                }}
              >
                <Tooltip
                  title={`${displayMuted ? 'Unmute' : 'Mute'} microphone${microphoneModeHint}`}
                >
                  <Button
                    aria-label={displayMuted ? 'Unmute microphone' : 'Mute microphone'}
                    shape="circle"
                    size="large"
                    danger={displayMuted}
                    type={displayMuted || pushToTalkTransmitting ? 'primary' : 'default'}
                    icon={displayMuted ? <AudioMutedOutlined /> : <AudioOutlined />}
                    onClick={toggleMute}
                    style={
                      displayMuted
                        ? { color: '#fff', background: '#d9363e' }
                        : pushToTalkTransmitting
                          ? { color: '#fff', background: '#2da96b' }
                          : undefined
                    }
                  />
                </Tooltip>
                <Tooltip title={headphonesMuted ? 'Unmute headphones' : 'Mute headphones'}>
                  <Button
                    aria-label={headphonesMuted ? 'Unmute headphones' : 'Mute headphones'}
                    shape="circle"
                    size="large"
                    danger={headphonesMuted}
                    type={headphonesMuted ? 'primary' : 'default'}
                    icon={<CustomerServiceOutlined />}
                    onClick={toggleHeadphones}
                    style={headphonesMuted ? { color: '#fff', background: '#d9363e' } : undefined}
                  />
                </Tooltip>
                <Tooltip title={controls.camera ? 'Stop camera' : 'Start camera'}>
                  <Button
                    aria-label={controls.camera ? 'Stop camera' : 'Start camera'}
                    shape="circle"
                    size="large"
                    type={controls.camera ? 'primary' : 'default'}
                    icon={<VideoCameraOutlined />}
                    onClick={() => {
                      if (!controls.camera) micGateRef.current?.allowCamera()
                      clickControl('incall_videomute', '[title="Camera Source"]')
                    }}
                    style={
                      controls.camera
                        ? { color: '#fff', background: '#2eaf65', borderColor: '#2eaf65' }
                        : undefined
                    }
                  />
                </Tooltip>
                {controls.screen ? (
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        {
                          key: 'source',
                          label: 'Switch source',
                          icon: <SwapOutlined />,
                          onClick: switchScreenShareSource,
                        },
                        {
                          key: 'quality',
                          label: 'Switch quality',
                          icon: <SettingOutlined />,
                          onClick: openShareSettings,
                        },
                        { type: 'divider' as const },
                        {
                          key: 'end',
                          danger: true,
                          label: 'End stream',
                          icon: <StopOutlined />,
                          onClick: () => clickControl('incall_screenshare'),
                        },
                      ],
                    }}
                  >
                    <Tooltip title="Screen sharing options">
                      <Button
                        aria-label="Screen sharing options"
                        shape="circle"
                        size="large"
                        type="primary"
                        icon={<DesktopOutlined />}
                        style={{
                          color: '#fff',
                          background: '#2eaf65',
                          borderColor: '#2eaf65',
                        }}
                      />
                    </Tooltip>
                  </Dropdown>
                ) : (
                  <Tooltip title="Share screen">
                    <Button
                      aria-label="Share screen"
                      shape="circle"
                      size="large"
                      icon={<DesktopOutlined />}
                      onClick={openShareSettings}
                    />
                  </Tooltip>
                )}
                <Button
                  danger
                  size="large"
                  loading={leaving}
                  disabled={leaving}
                  icon={<PhoneOutlined />}
                  onClick={() => void leave()}
                >
                  Leave
                </Button>
              </div>
              <Modal
                open={shareSettingsOpen}
                title={controls.screen ? 'Screen sharing' : 'Share your screen'}
                onCancel={closeShareSettings}
                footer={[
                  <Button key="cancel" onClick={closeShareSettings}>
                    Cancel
                  </Button>,
                  controls.screen ? (
                    <Button
                      key="apply"
                      type="primary"
                      icon={<SwapOutlined />}
                      onClick={applyScreenShareQuality}
                    >
                      Apply and switch
                    </Button>
                  ) : (
                    <Button
                      key="start"
                      type="primary"
                      icon={<DesktopOutlined />}
                      onClick={startScreenShare}
                    >
                      Choose what to share
                    </Button>
                  ),
                ]}
              >
                <div
                  style={{
                    display: 'grid',
                    gap: 22,
                    paddingBlock: 8,
                    maxHeight: 'calc(100dvh - 220px)',
                    overflowY: 'auto',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 10 }}>Resolution</div>
                    <Radio.Group
                      value={screenResolution}
                      onChange={(event) =>
                        setScreenResolutionMode(event.target.value as ScreenShareResolution)
                      }
                      style={{ display: 'grid', gap: 9 }}
                    >
                      {(Object.keys(SCREEN_SHARE_RESOLUTION_LABELS) as ScreenShareResolution[]).map(
                        (resolution) => (
                          <Radio key={resolution} value={resolution}>
                            {SCREEN_SHARE_RESOLUTION_LABELS[resolution]}
                          </Radio>
                        ),
                      )}
                    </Radio.Group>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 10 }}>Frame rate</div>
                    <Radio.Group
                      value={screenFrameRate}
                      onChange={(event) =>
                        setScreenFrameRateMode(event.target.value as ScreenShareFrameRate)
                      }
                      style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}
                    >
                      {SCREEN_SHARE_FRAME_RATES.map((frameRate) => (
                        <Radio key={frameRate} value={frameRate}>
                          {frameRate === 'source' ? 'Original' : `${frameRate} FPS`}
                        </Radio>
                      ))}
                    </Radio.Group>
                  </div>
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                        fontWeight: 600,
                        marginBottom: 4,
                      }}
                    >
                      <span>Bitrate</span>
                      <span>{(screenBitrate / 1_000).toFixed(1)} Mbps</span>
                    </div>
                    <Slider
                      min={500}
                      max={20_000}
                      step={500}
                      value={screenBitrate}
                      onChange={setScreenBitrateMode}
                      tooltip={{
                        formatter: (value) => (value ? `${(value / 1_000).toFixed(1)} Mbps` : null),
                      }}
                      marks={{
                        500: '0.5',
                        6_000: '6',
                        12_000: '12',
                        20_000: '20 Mbps',
                      }}
                      aria-label="Screen share bitrate"
                    />
                    <div style={{ opacity: 0.65, fontSize: 12, marginTop: 8 }}>
                      Higher values improve motion and fine detail but require more upload
                      bandwidth.
                    </div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 10 }}>Content optimization</div>
                    <Radio.Group
                      value={screenContentHint}
                      onChange={(event) =>
                        setScreenContentHintMode(event.target.value as ScreenShareContentHint)
                      }
                      style={{ display: 'grid', gap: 9 }}
                    >
                      <Radio value="detail">
                        Text and slides
                        <span style={{ display: 'block', opacity: 0.65, fontSize: 12 }}>
                          Prioritize fine detail and readability.
                        </span>
                      </Radio>
                      <Radio value="motion">
                        Games and video
                        <span style={{ display: 'block', opacity: 0.65, fontSize: 12 }}>
                          Prioritize smooth motion.
                        </span>
                      </Radio>
                    </Radio.Group>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 18,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>Share audio</div>
                      <div style={{ opacity: 0.65, fontSize: 12, marginTop: 3 }}>
                        Availability depends on the source and your device.
                      </div>
                    </div>
                    <Switch
                      checked={shareAudio}
                      onChange={setShareAudioMode}
                      aria-label="Share screen audio"
                    />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 18,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>Capture mouse cursor</div>
                      <div style={{ opacity: 0.65, fontSize: 12, marginTop: 3 }}>
                        Include the pointer in the shared image when supported.
                      </div>
                    </div>
                    <Switch
                      checked={screenCursor}
                      onChange={setScreenCursorMode}
                      aria-label="Capture mouse cursor"
                    />
                  </div>
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      background: 'rgba(127,127,127,.1)',
                      fontSize: 13,
                      lineHeight: 1.45,
                    }}
                  >
                    Your browser or operating system will ask whether to share a window, browser
                    tab, or entire screen. For security, FoxChat cannot make that selection for you.
                  </div>
                  {controls.screen && (
                    <div style={{ opacity: 0.65, fontSize: 12 }}>
                      Applying these changes restarts capture and opens the source picker again.
                    </div>
                  )}
                </div>
              </Modal>
            </div>
          </>,
          target,
        )}
      {dockTarget &&
        createPortal(
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              margin: '0 10px 8px',
              padding: '8px',
              borderRadius: 14,
              background: 'rgba(115,87,232,.14)',
              border: '1px solid rgba(115,87,232,.28)',
            }}
          >
            <Tooltip title="Back to call">
              <IconBtn
                shape="circle"
                icon={<FullscreenOutlined />}
                style={{ background: 'rgba(127,127,127,.16)' }}
                onClick={showCall}
              />
            </Tooltip>
            <Tooltip
              title={(displayMuted ? 'Unmute microphone' : 'Mute microphone') + microphoneModeHint}
            >
              <IconBtn
                shape="circle"
                danger={displayMuted}
                type={displayMuted || pushToTalkTransmitting ? 'primary' : 'default'}
                icon={displayMuted ? <AudioMutedOutlined /> : <AudioOutlined />}
                style={
                  displayMuted
                    ? { color: '#fff', background: '#d9363e' }
                    : pushToTalkTransmitting
                      ? { color: '#fff', background: '#2da96b' }
                      : { background: 'rgba(127,127,127,.16)' }
                }
                onClick={toggleMute}
              />
            </Tooltip>
            <Tooltip title={headphonesMuted ? 'Unmute headphones' : 'Mute headphones'}>
              <IconBtn
                shape="circle"
                danger={headphonesMuted}
                type={headphonesMuted ? 'primary' : 'default'}
                icon={<CustomerServiceOutlined />}
                style={
                  headphonesMuted
                    ? { color: '#fff', background: '#d9363e' }
                    : { background: 'rgba(127,127,127,.16)' }
                }
                onClick={toggleHeadphones}
              />
            </Tooltip>
            <DockParticipants
              participants={members.map((member) => ({
                userId: member.userId,
                name: matrixMemberDisplayName(member, client),
                avatarUrl:
                  client.getUser(member.userId)?.avatarUrl ?? member.getMxcAvatarUrl() ?? undefined,
              }))}
              speakers={speakers}
            />
            <Tooltip title="Leave call">
              <IconBtn
                shape="circle"
                danger
                type="primary"
                loading={leaving}
                disabled={leaving}
                icon={<PhoneOutlined style={{ transform: 'rotate(135deg)' }} />}
                style={{ color: '#fff', background: '#d9363e', marginLeft: 'auto' }}
                onClick={() => void leave()}
              />
            </Tooltip>
          </div>,
          dockTarget,
        )}
    </>
  )
}
