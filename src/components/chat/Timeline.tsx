import { CallMembershipStatus } from '../calls/CallMembershipStatus'
import { EmojiButton } from '../composer'
import { GifButton, type GifSelection } from '../composer'
import { type ChatFollower } from '../composer'
import { MemberAvatar } from '../profile'
import { MatrixEmoteImage, MembershipStatus } from '../message'
import { Message } from '../message'
import { MessageComposerInput } from '../composer'
import { PendingUpload } from '../message'
import { ProfileUpdateStatus } from '../message'
import { PinnedBar } from './PinnedBar'
import { PollComposerModal } from '../composer'
import { TimestampComposerModal } from '../composer'
import { RoomAvatar } from '../rooms'
import { RoomInfoModals } from '../rooms'
import { ThreadHost } from './ThreadHost'
import { isVoiceChannel } from '../calls/voiceRoom'
import { type ChatBackground, currentChatBackground } from '../../lib/chatBackground'
import {
  anonymizeFilenameDefault,
  TIMELINE_APPEARANCE_CHANGED_EVENT,
  type TimelineAppearanceSettings,
  timelineAppearanceSettings,
  type VoiceSystemNotice,
  voiceSystemNoticeEvent,
} from '../../lib/constants'
import {
  type MatrixEmote,
  type StoredEmote,
  inlineEmoteSuggestions,
  recentStorage,
  rememberRecent,
  useRecents,
} from '../../lib/emojiData'
import {
  MESSAGE_WINDOW_SHIFT,
  MESSAGE_WINDOW_SIZE,
  eventBody,
  isAvatarChange,
  isCallMembershipChange,
  isDisplayNameChange,
  isMembershipChange,
  isPreJoinHistoryUnavailable,
  isVisibleMessageEvent,
  roomTopic,
} from '../../lib/eventHelpers'
import { formatFileSize } from '../../lib/format'
import { assignGalleryIds, galleryTimelineItems } from '../../lib/gallery'
import { useMediaQuery, useMediaUrl } from '../../lib/hooks'
import {
  anonymizedFile,
  compressedImageFile,
  sharedFileEvent,
  stripImageMetadata,
  takeSharedFiles,
} from '../../lib/media'
import { logHistoryDiagnostics } from '../../lib/timelineHelpers'
import {
  isSameLocalDay,
  shouldShowTimelineDateHint,
  timelineDateLabel,
  timelineDateTime,
} from '../../lib/timelinePresentation'
import {
  addedVisibleEventCount,
  initialTimelinePosition,
  mergeTimelineEventSegments,
  nextFollowLatest,
  shouldHandleTimelineGrowth,
  shouldFollowAddedEvents,
  visibleReadBoundary,
} from '../../lib/timelineWindow'
import {
  type RoomModalView,
  closeRoomModal,
  closeThreadUrl,
  openSearchUrl,
  openThreadUrl,
  roomModalFromUrl,
  setRoomModalUrl,
  threadViewFromUrl,
  writeRoomUrl,
} from '../../lib/urlState'
import { VoiceRecorder } from '../../lib/voiceRecording'
import { isAndroidApp } from '../../platform/nativeBackground'
import {
  ComposeTray,
  Composer,
  ComposerArea,
  Day,
  EmptyState,
  HistoryStatus,
  IconBtn,
  JumpToLatest,
  Main,
  MembershipLine,
  MentionMenu,
  Messages,
  MobileMenu,
  NoSendNotice,
  SendBtn,
  SendingAsButton,
  TimelineDateHint,
  TimelineDateSeparator,
  TimelineLoadingSkeleton,
  TombstoneBanner,
  TopInfo,
  Topbar,
  TypingLine,
  Unread,
} from '../../styles'
import {
  memo,
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button, Dropdown, Modal, Segmented, Switch, App as AntApp } from 'antd'
import {
  ArrowDownOutlined,
  AudioOutlined,
  BarChartOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  DownOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  MenuOutlined,
  MessageOutlined,
  PaperClipOutlined,
  PhoneOutlined,
  PictureOutlined,
  SearchOutlined,
  SendOutlined,
  TeamOutlined,
  UserSwitchOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import {
  ClientEvent,
  Direction,
  EventTimeline,
  EventType,
  HistoryVisibility,
  MatrixEvent,
  Room,
  RoomEvent,
} from 'matrix-js-sdk'
import {
  AUTO_READ_ALL_ACCOUNTS_CHANGED_EVENT,
  matrixService,
} from '../../matrix/MatrixClientService'

type CachedRoomTimeline = {
  room: Room
  events: MatrixEvent[]
  unreadStart?: string
  windowEndOffset: number
}

const ROOM_TIMELINE_CACHE_LIMIT = 80
const FOLLOW_LATEST_THRESHOLD = 64
const roomTimelineCache = new Map<string, CachedRoomTimeline>()

const timelineRoomIdentity = (room: Room) => {
  const selectedAccountId = matrixService.selectedRoomAccountId(room.roomId)
  return `${selectedAccountId ?? matrixService.roomIdentity(room)}\0${room.roomId}`
}

const isUnavailablePreJoinEvent = (event: MatrixEvent, fallbackRoom?: Room) => {
  if (!event.isDecryptionFailure()) return false
  const client = matrixService.clientForEvent(event)
  const roomId = event.getRoomId()
  const eventRoom = (roomId ? client?.getRoom(roomId) : undefined) ?? fallbackRoom
  return isPreJoinHistoryUnavailable(event, eventRoom, client?.getUserId())
}

const isAvailableTimelineMessage = (event: MatrixEvent, room?: Room) =>
  isVisibleMessageEvent(event) && !isUnavailablePreJoinEvent(event, room)

const linkedTimelineEvents = (start: EventTimeline, directions: Direction[]) => {
  const timelines = [start]
  const seen = new Set([start])
  for (const direction of directions) {
    let neighbour = start.getNeighbouringTimeline(direction)
    while (neighbour && !seen.has(neighbour)) {
      seen.add(neighbour)
      if (direction === Direction.Backward) timelines.unshift(neighbour)
      else timelines.push(neighbour)
      neighbour = neighbour.getNeighbouringTimeline(direction)
    }
  }
  return mergeTimelineEventSegments(...timelines.map((timeline) => timeline.getEvents()))
}
const linkedRoomTimelineEvents = (room: Room) =>
  linkedTimelineEvents(room.getLiveTimeline(), [Direction.Backward])

const cachedEventWindow = (room: Room) => {
  const freshEvents = linkedRoomTimelineEvents(room)
  const previous = roomTimelineCache.get(timelineRoomIdentity(room))?.events ?? []
  const source = mergeTimelineEventSegments(previous, freshEvents)
  const visible = source.filter((event) => isAvailableTimelineMessage(event, room))
  const first = visible.at(-MESSAGE_WINDOW_SIZE)
  if (!first) return source.slice(-MESSAGE_WINDOW_SIZE)
  const firstIndex = source.findIndex(
    (event) => event === first || (!!event.getId() && event.getId() === first.getId()),
  )
  return source.slice(Math.max(0, firstIndex))
}

const initialRoomPosition = (
  room: Room,
  events: MatrixEvent[],
  boundaryEventId?: string | null,
) => {
  const selectedAccountId = matrixService.selectedRoomAccountId(room.roomId)
  const selectedAccount = matrixService
    .roomAccounts(room.roomId)
    .find((account) => account.id === selectedAccountId)
  const positioningRoom = selectedAccount?.client.getRoom(room.roomId) ?? room
  const userId =
    selectedAccount?.client.getUserId() ??
    matrixService.clientForRoomInstance(positioningRoom)?.getUserId()
  const ownUserIds = new Set(matrixService.availableAccounts().map((account) => account.userId))
  const readId = userId ? (positioningRoom.getEventReadUpTo(userId) ?? undefined) : undefined
  const unreadCount = matrixService.effectiveUnreadCount(room.roomId)
  return initialTimelinePosition(
    events.filter((event) => !isUnavailablePreJoinEvent(event, positioningRoom)),
    readId,
    unreadCount,
    ownUserIds,
    boundaryEventId,
  )
}

const cacheRoomTimeline = (room: Room, touch = false) => {
  const roomIdentity = timelineRoomIdentity(room)
  const events = cachedEventWindow(room)
  const position = initialRoomPosition(room, events)
  const entry = {
    room,
    events,
    unreadStart: position.unreadStart,
    windowEndOffset: position.windowEndOffset,
  }
  if (touch) roomTimelineCache.delete(roomIdentity)
  roomTimelineCache.set(roomIdentity, entry)
  while (roomTimelineCache.size > ROOM_TIMELINE_CACHE_LIMIT) {
    roomTimelineCache.delete(roomTimelineCache.keys().next().value!)
  }
  return entry
}

function TimelineView({
  room,
  matrixRevision,
  onMenu,
  onInfo,
}: {
  room?: Room
  matrixRevision: number
  onMenu: () => void
  onInfo: () => void
}) {
  const roomIdentity = room ? timelineRoomIdentity(room) : undefined
  const visibleAccountId = room ? matrixService.selectedRoomAccountId(room.roomId) : undefined
  const { message } = AntApp.useApp()
  const isSmallScreen = useMediaQuery('(max-width:760px)')
  const [draft, setDraft] = useState('')
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false)
  const [availableInlineEmotes, setAvailableInlineEmotes] = useState<MatrixEmote[]>([])
  const recentInlineEmotes = useRecents<StoredEmote>(recentStorage.emojis)
  const [roomModal, setRoomModal] = useState<RoomModalView | undefined>(roomModalFromUrl)
  const [pollOpen, setPollOpen] = useState(false)
  const [timestampOpen, setTimestampOpen] = useState(false)
  const [threadView, setThreadView] = useState<string | undefined>(threadViewFromUrl)
  const roomRef = useRef(room)
  roomRef.current = room
  const visibleAccountIdRef = useRef(visibleAccountId)
  visibleAccountIdRef.current = visibleAccountId
  const draftRef = useRef('')
  const editingRef = useRef<MatrixEvent | undefined>(undefined)
  const pendingImagesRef = useRef<File[]>([])
  const inlineEmotesRef = useRef(new Map<string, MatrixEmote>())
  const composerRevisionRef = useRef(0)
  const [replyingTo, setReplyingTo] = useState<MatrixEvent>()
  const [editing, setEditing] = useState<MatrixEvent>()
  const [pendingImages, setPendingImages] = useState<File[]>([])
  const [rawImages, setRawImages] = useState<Set<File>>(() => new Set())
  const [spoilerImages, setSpoilerImages] = useState<Set<File>>(() => new Set())
  const [preserveMetadataImages, setPreserveMetadataImages] = useState<Set<File>>(() => new Set())
  const [anonymizeFiles, setAnonymizeFiles] = useState<Set<File>>(() => new Set())
  const [voiceMeta, setVoiceMeta] = useState<Map<File, { duration: number; waveform: number[] }>>(
    () => new Map(),
  )
  const [recording, setRecording] = useState(false)
  const [recordingMs, setRecordingMs] = useState(0)
  const recorderRef = useRef<VoiceRecorder | undefined>(undefined)
  const recordingTimerRef = useRef<number>(0)
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [uploads, setUploads] = useState<
    Map<
      string,
      {
        roomId: string
        file: File
        previewUrl?: string
        progress: number
        cancel: () => void
      }
    >
  >(() => new Map())
  const [renderTick, render] = useState(0)
  const [contextTimeline, setContextTimeline] = useState<EventTimeline>()
  const [windowEndOffset, setWindowEndOffset] = useState(0)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [composerElement, setComposerElement] = useState<HTMLDivElement | null>(null)
  const [composerHeight, setComposerHeight] = useState(0)
  useLayoutEffect(() => {
    if (!composerElement) {
      setComposerHeight(0)
      return
    }
    const update = () => setComposerHeight(composerElement.getBoundingClientRect().height)
    const observer = new ResizeObserver(update)
    observer.observe(composerElement)
    update()
    return () => observer.disconnect()
  }, [composerElement])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [positioningTimeline, setPositioningTimeline] = useState(true)
  const [historyPagingEnabled, setHistoryPagingEnabled] = useState(false)
  const [acceptingInvite, setAcceptingInvite] = useState(false)
  const [decliningInvite, setDecliningInvite] = useState(false)
  const [acceptedInvite, setAcceptedInvite] = useState(false)
  const [unreadStart, setUnreadStart] = useState<string>()
  const [voiceNotices, setVoiceNotices] = useState<VoiceSystemNotice[]>([])
  const [timelineAppearance, setTimelineAppearance] = useState<TimelineAppearanceSettings>(
    timelineAppearanceSettings,
  )
  useEffect(() => {
    const update = (event: Event) =>
      setTimelineAppearance((event as CustomEvent<TimelineAppearanceSettings>).detail)
    window.addEventListener(TIMELINE_APPEARANCE_CHANGED_EVENT, update)
    return () => window.removeEventListener(TIMELINE_APPEARANCE_CHANGED_EVENT, update)
  }, [])
  const fileRef = useRef<HTMLInputElement>(null)
  const typingTimer = useRef<number | undefined>(undefined)
  const typingActive = useRef(false)
  const messagesRef = useRef<HTMLDivElement>(null)
  const [timelineDateHintTimestamp, setTimelineDateHintTimestamp] = useState<number>()
  const updateTimelineDateHint = useCallback(() => {
    const box = messagesRef.current
    if (!box) return
    const bounds = box.getBoundingClientRect()
    const isVisible = (node: HTMLElement) => {
      const rect = node.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
    }
    const separatorVisible = [
      ...box.querySelectorAll<HTMLElement>('[data-timeline-date-separator]'),
    ].some(isVisible)
    const firstVisibleEvent = [
      ...box.querySelectorAll<HTMLElement>('[data-timeline-event-timestamp]'),
    ].find(isVisible)
    const timestamp = Number(firstVisibleEvent?.dataset.timelineEventTimestamp)
    if (!shouldShowTimelineDateHint(timestamp, separatorVisible)) {
      setTimelineDateHintTimestamp(undefined)
      return
    }
    setTimelineDateHintTimestamp((current) =>
      current !== undefined && timelineDateTime(current) === timelineDateTime(timestamp)
        ? current
        : timestamp,
    )
  }, [])
  const initializedRoom = useRef<string | undefined>(undefined)

  const initializedPhysicalRoom = useRef<string | undefined>(undefined)
  const skipInitialMarkRead = useRef(false)
  const lastEventId = useRef<string | undefined>(undefined)
  const lastVisibleEventCount = useRef(0)
  const atBottom = useRef(false)
  const followLatest = useRef(false)
  const scrollAnchor = useRef<{ type: 'bottom' } | { type: 'event'; eventId: string } | undefined>(
    undefined,
  )
  const receiptTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    window.clearTimeout(receiptTimer.current)
  }, [visibleAccountId])
  const loadingRef = useRef(false)
  const positionStabilizerCleanup = useRef<() => void>(() => {})
  const positionStabilizerUserCancelled = useRef(false)
  const positionStabilizerSuperseded = useRef(false)
  const mountPositionRetryCleanup = useRef<() => void>(() => {})
  const positioningBoundaryEventId = useRef<string | null | undefined>(undefined)
  const positioningStartedAt = useRef(0)
  const historyPagingReady = useRef(false)
  const historyPagingRoom = useRef<string | undefined>(undefined)
  const timelineUserInteracted = useRef(false)
  const userScrollIntentUntil = useRef(0)
  const pendingJumpRef = useRef<{ eventId: string; attempts: number } | undefined>(undefined)
  const attemptJumpRef = useRef<(eventId: string) => void>(() => {})
  const jumpPaginatingRef = useRef(false)
  useEffect(() => {
    const navigate = () => {
      setRoomModal(roomModalFromUrl())
      setThreadView(threadViewFromUrl())
    }
    window.addEventListener('popstate', navigate)
    window.addEventListener('foxchat-thread-changed', navigate)
    navigate()
    return () => {
      window.removeEventListener('popstate', navigate)
      window.removeEventListener('foxchat-thread-changed', navigate)
    }
  }, [])
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel()
      recorderRef.current = undefined
      window.clearInterval(recordingTimerRef.current)
    }
  }, [roomIdentity])
  useEffect(() => {
    setAcceptedInvite(false)
    setAcceptingInvite(false)
    setDecliningInvite(false)
    if (!room) return
    const client = matrixService.clientForRoomInstance(room)
    const membership = (changed: Room) => {
      if (changed.roomId !== room.roomId) return
      if (changed.getMyMembership() === 'join') setAcceptedInvite(true)
      render((value) => value + 1)
    }
    client?.on(RoomEvent.MyMembership, membership)
    return () => {
      client?.off(RoomEvent.MyMembership, membership)
    }
  }, [room])
  const showRoomModal = (view?: RoomModalView) => {
    if (view) {
      setRoomModal(view)
      setRoomModalUrl(view)
    } else closeRoomModal()
  }
  useEffect(() => {
    const receive = (event: Event) => {
      const notice = (event as CustomEvent<VoiceSystemNotice>).detail
      if (!notice || notice.roomId !== room?.roomId) return
      setVoiceNotices((current) => [...current, notice].slice(-50))
      if (followLatest.current && windowEndOffset === 0)
        requestAnimationFrame(() => {
          const box = messagesRef.current
          if (box) {
            box.scrollTop = box.scrollHeight
            atBottom.current = true
            followLatest.current = true
            setShowJumpToLatest(false)
          }
        })
      else setShowJumpToLatest(true)
    }
    window.addEventListener(voiceSystemNoticeEvent, receive)
    return () => window.removeEventListener(voiceSystemNoticeEvent, receive)
  }, [room, windowEndOffset])
  const [chatBackground, setChatBackground] = useState<ChatBackground | undefined>(
    currentChatBackground,
  )
  const chatBackgroundUrl = useMediaUrl(chatBackground ?? {})
  useEffect(() => {
    const client = matrixService.matrixClient
    const update = (event: Event) =>
      setChatBackground((event as CustomEvent<ChatBackground | undefined>).detail)
    const accountData = (event: MatrixEvent) => {
      if (event.getType() === 'chat.foxchat.appearance')
        setChatBackground(event.getContent<{ chat_background?: ChatBackground }>().chat_background)
    }
    window.addEventListener('foxchat-chat-background', update)
    client?.on(ClientEvent.AccountData, accountData)
    setChatBackground(currentChatBackground())
    return () => {
      window.removeEventListener('foxchat-chat-background', update)
      client?.off(ClientEvent.AccountData, accountData)
    }
  }, [])
  const timeline = contextTimeline ?? room?.getLiveTimeline()
  const timelineEvents = useMemo(() => {
    void matrixRevision
    void renderTick
    const liveTimelineEvents = contextTimeline
      ? linkedTimelineEvents(contextTimeline, [Direction.Backward, Direction.Forward])
      : room
        ? linkedRoomTimelineEvents(room)
        : []
    const cachedTimelineEvents = roomTimelineCache.get(roomIdentity ?? '')?.events ?? []
    const baseTimelineEvents =
      room && !contextTimeline
        ? mergeTimelineEventSegments(cachedTimelineEvents, liveTimelineEvents)
        : liveTimelineEvents
    return room
      ? contextTimeline
        ? baseTimelineEvents.map((event) => matrixService.eventForReading(event))
        : matrixService.combinedRoomEvents(room, baseTimelineEvents)
      : baseTimelineEvents
  }, [room, roomIdentity, contextTimeline, matrixRevision, renderTick])
  const timelineEventsRef = useRef(timelineEvents)
  timelineEventsRef.current = timelineEvents
  const allEvents = useMemo(
    () => timelineEvents.filter((event) => isAvailableTimelineMessage(event, room)),
    [room, timelineEvents],
  )
  const windowEnd = Math.max(0, allEvents.length - windowEndOffset)
  const windowStart = Math.max(0, windowEnd - MESSAGE_WINDOW_SIZE)
  const historyFullyLoaded =
    windowStart === 0 && !!room && !!timeline && !timeline.getPaginationToken(Direction.Backward)
  const preJoinHistoryBoundaryReached = useMemo(() => {
    if (windowStart > 0) return false
    const earliestAvailable = allEvents[0]
    const earliestAvailableIndex = earliestAvailable
      ? timelineEvents.indexOf(earliestAvailable)
      : timelineEvents.length
    return timelineEvents
      .slice(0, earliestAvailableIndex)
      .some((event) => isUnavailablePreJoinEvent(event, room))
  }, [room, timelineEvents, allEvents, windowStart])
  const preJoinHistoryRestricted =
    room?.getHistoryVisibility() === HistoryVisibility.Joined || preJoinHistoryBoundaryReached
  const captureScrollAnchor = useCallback(() => {
    const box = messagesRef.current
    if (!box) return undefined
    const bounds = box.getBoundingClientRect()
    const visible = [...box.querySelectorAll<HTMLElement>('[data-event-id]')].filter((node) => {
      const rect = node.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
    })
    const anchor = visible[0] ?? box.querySelector<HTMLElement>('[data-event-id]')
    return {
      eventId: anchor?.dataset.eventId,
      offset: anchor ? anchor.getBoundingClientRect().top - bounds.top : 0,
      scrollHeight: box.scrollHeight,
    }
  }, [])
  const scrollRestoreActiveRef = useRef(false)
  const restoreScrollAnchor = useCallback(
    (captured: ReturnType<typeof captureScrollAnchor> | undefined) =>
      new Promise<void>((resolve) => {
        const box = messagesRef.current
        if (!box || !captured || scrollRestoreActiveRef.current) {
          resolve()
          return
        }
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (box.scrollTop >= 80) {
              resolve()
              return
            }
            scrollRestoreActiveRef.current = true
            const restore = () => {
              const target = captured.eventId
                ? box.querySelector<HTMLElement>(
                    `[data-event-id="${CSS.escape(captured.eventId)}"]`,
                  )
                : undefined
              if (target) {
                box.scrollTop +=
                  target.getBoundingClientRect().top -
                  box.getBoundingClientRect().top -
                  captured.offset
              } else {
                const grown = box.scrollHeight - captured.scrollHeight
                if (grown) box.scrollTop += grown
              }
            }
            restore()
            const resizeObserver = new ResizeObserver(restore)
            const observeChildren = () =>
              [...box.children].forEach((child) => resizeObserver.observe(child))
            observeChildren()
            resizeObserver.observe(box)
            const mutationObserver = new MutationObserver(() => {
              observeChildren()
              restore()
            })
            mutationObserver.observe(box, { childList: true, subtree: true })
            const stop = () => {
              scrollRestoreActiveRef.current = false
              resizeObserver.disconnect()
              mutationObserver.disconnect()
              box.removeEventListener('wheel', stop)
              box.removeEventListener('touchstart', stop)
              box.removeEventListener('pointerdown', stop)
              resolve()
            }
            box.addEventListener('wheel', stop, { passive: true })
            box.addEventListener('touchstart', stop, { passive: true })
            box.addEventListener('pointerdown', stop)
            window.setTimeout(stop, 500)
          }),
        )
      }),
    [],
  )
  useEffect(() => {
    if (!room || !preJoinHistoryBoundaryReached) return
    if (matrixService.roomAccounts(room.roomId).length < 2) return
    let cancelled = false
    void (async () => {
      for (let attempt = 0; attempt < 6 && !cancelled; attempt++) {
        while (loadingRef.current && !cancelled) {
          await new Promise((resolve) => window.setTimeout(resolve, 100))
        }
        if (cancelled) return
        loadingRef.current = true
        let fetchedMore = false
        try {
          const captured = captureScrollAnchor()
          fetchedMore = await matrixService.backfillCombinedRoomHistory(room.roomId)
          if (cancelled) return
          if (fetchedMore) {
            render((x) => x + 1)
            await restoreScrollAnchor(captured)
          }
        } finally {
          loadingRef.current = false
        }
        if (cancelled || !fetchedMore) return
        await new Promise((resolve) => window.setTimeout(resolve, 250))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [room, preJoinHistoryBoundaryReached, captureScrollAnchor, restoreScrollAnchor])
  const visibleMessages = useMemo(
    () => allEvents.slice(windowStart, windowEnd),
    [allEvents, windowStart, windowEnd],
  )
  const visibleMessagesRef = useRef(visibleMessages)
  visibleMessagesRef.current = visibleMessages
  const attemptJump = (eventId: string) => {
    const box = messagesRef.current
    if (!box || !room) return
    const target = box.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(eventId)}"]`)
    if (target) {
      pendingJumpRef.current = undefined
      scrollAnchor.current = { type: 'event', eventId }
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const messageBox = target.querySelector<HTMLElement>('[data-message-box]')
      window.setTimeout(
        () =>
          messageBox?.animate(
            [
              { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(115,87,232,0)' },
              {
                transform: 'scale(1.025)',
                boxShadow: '0 0 0 5px rgba(115,87,232,.35)',
              },
              { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(115,87,232,0)' },
            ],
            { duration: 900, easing: 'ease-out' },
          ),
        180,
      )
      return
    }
    const localIndex = timelineEvents.findIndex((candidate) => candidate.getId() === eventId)
    if (localIndex === -1) {
      if (jumpPaginatingRef.current) return
      jumpPaginatingRef.current = true
      pendingJumpRef.current = { eventId, attempts: 0 }
      const targetRoom = room
      void (async () => {
        try {
          const targetTimeline = await matrixService.loadEventContext(targetRoom, eventId)
          if (!targetTimeline?.getEvents().some((candidate) => candidate.getId() === eventId))
            throw new Error('The server could not return that message')
          followLatest.current = false
          atBottom.current = false
          setContextTimeline(targetTimeline)
          setWindowEndOffset(0)
          setShowJumpToLatest(true)
        } catch (error) {
          pendingJumpRef.current = undefined
          message.error(
            error instanceof Error
              ? `Could not open that message: ${error.message}`
              : 'Could not open that message',
          )
        } finally {
          jumpPaginatingRef.current = false
          render((x) => x + 1)
        }
      })()
      return
    }
    const attempts =
      (pendingJumpRef.current?.eventId === eventId ? pendingJumpRef.current.attempts : 0) + 1
    if (attempts > 8) {
      pendingJumpRef.current = undefined
      message.error('Could not find that message - it may be too far back in history')
      return
    }
    pendingJumpRef.current = { eventId, attempts }
    followLatest.current = false
    atBottom.current = false
    scrollAnchor.current = undefined
    setShowJumpToLatest(true)
    const visibleIndex =
      timelineEvents
        .slice(0, localIndex + 1)
        .filter((event) => isAvailableTimelineMessage(event, room)).length - 1
    const desiredEnd = Math.min(allEvents.length, visibleIndex + Math.ceil(MESSAGE_WINDOW_SIZE / 2))
    setWindowEndOffset(Math.max(0, allEvents.length - desiredEnd))
  }
  attemptJumpRef.current = attemptJump
  const events = useMemo(() => {
    const firstVisible = visibleMessages[0]
    const lastVisible = visibleMessages.at(-1)
    const firstVisibleIndex = firstVisible
      ? timelineEvents.findIndex(
          (event) =>
            event === firstVisible ||
            (!!firstVisible.getId() && event.getId() === firstVisible.getId()),
        )
      : -1
    const lastVisibleIndex = lastVisible
      ? timelineEvents.findIndex(
          (event) =>
            event === lastVisible ||
            (!!lastVisible.getId() && event.getId() === lastVisible.getId()),
        )
      : -1
    return (
      firstVisibleIndex >= 0
        ? timelineEvents.slice(
            firstVisibleIndex,
            windowEnd === allEvents.length
              ? undefined
              : lastVisibleIndex >= firstVisibleIndex
                ? lastVisibleIndex + 1
                : undefined,
          )
        : timelineEvents
    ).filter(
      (event) =>
        isAvailableTimelineMessage(event, room) ||
        (timelineAppearance.roomMembership && isMembershipChange(event)) ||
        (timelineAppearance.voiceMembership && isCallMembershipChange(event)) ||
        (timelineAppearance.displayName && isDisplayNameChange(event)) ||
        (timelineAppearance.avatar && isAvatarChange(event)),
    )
  }, [timelineEvents, allEvents.length, visibleMessages, windowEnd, timelineAppearance, room])
  const renderedEvents = useMemo(() => galleryTimelineItems(events), [events])
  useEffect(() => {
    let innerFrame = 0
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(updateTimelineDateHint)
    })
    return () => {
      cancelAnimationFrame(outerFrame)
      cancelAnimationFrame(innerFrame)
    }
  }, [positioningTimeline, renderedEvents, roomIdentity, updateTimelineDateHint, windowEndOffset])
  const newestId = allEvents.at(-1)?.getId()
  useLayoutEffect(() => {
    if (windowEndOffset !== 0 || scrollAnchor.current?.type !== 'bottom') return
    const box = messagesRef.current
    if (!box) return
    box.scrollTop = box.scrollHeight
    atBottom.current = true
    followLatest.current = true
    setShowJumpToLatest(false)
  }, [contextTimeline, roomIdentity, windowEndOffset])
  useEffect(() => {
    if (!room) return
    const debugWindow = window as typeof window & {
      foxchatHistoryDebug?: () => void
    }
    const debug = () => {
      const box = messagesRef.current
      logHistoryDiagnostics(room, 'manual', {
        window_size: MESSAGE_WINDOW_SIZE,
        window_end_offset: windowEndOffset,
        rendered_event_count: events.length,
        rendered_message_count: visibleMessages.length,
        scroll_top: box?.scrollTop,
        scroll_height: box?.scrollHeight,
        client_height: box?.clientHeight,
      })
    }
    debugWindow.foxchatHistoryDebug = debug
    return () => {
      if (debugWindow.foxchatHistoryDebug === debug) delete debugWindow.foxchatHistoryDebug
    }
  }, [room, windowEndOffset, events.length, visibleMessages.length])
  const focused = () => document.hasFocus() && document.visibilityState === 'visible'
  const centerEvent = useCallback((eventId?: string) => {
    const box = messagesRef.current
    if (!box || !eventId) return false
    const target = box.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(eventId)}"]`)
    if (!target) return false
    box.scrollTop = Math.max(0, target.offsetTop - (box.clientHeight - target.offsetHeight) / 2)
    atBottom.current =
      box.scrollHeight - box.scrollTop - box.clientHeight <= FOLLOW_LATEST_THRESHOLD
    followLatest.current = false
    return true
  }, [])
  const markVisibleRead = useCallback(() => {
    if (!room || !focused()) return
    const box = messagesRef.current
    if (!box) return
    const bounds = box.getBoundingClientRect()
    const visible = [...box.querySelectorAll<HTMLElement>('[data-event-id]')].filter((node) => {
      const rect = node.getBoundingClientRect()
      return rect.bottom > bounds.top + 4 && rect.top < bounds.bottom - 4
    })
    const id = visible.at(-1)?.dataset.eventId
    const atLiveEdge =
      box.scrollHeight - box.scrollTop - box.clientHeight <= FOLLOW_LATEST_THRESHOLD
    const event = visibleReadBoundary(timelineEventsRef.current, id, atLiveEdge)
    if (event) void matrixService.markRead(event, visibleAccountIdRef.current)
  }, [room])
  useEffect(() => {
    const applyPreference = () => {
      if (matrixService.autoReadAllAccountsEnabled()) markVisibleRead()
    }
    window.addEventListener(AUTO_READ_ALL_ACCOUNTS_CHANGED_EVENT, applyPreference)
    return () => window.removeEventListener(AUTO_READ_ALL_ACCOUNTS_CHANGED_EVENT, applyPreference)
  }, [markVisibleRead])
  const stabilizeTimelinePosition = useCallback(
    (eventId?: string) => {
      const box = messagesRef.current
      if (!box || positionStabilizerUserCancelled.current || positionStabilizerSuperseded.current)
        return
      positionStabilizerCleanup.current()
      let frame = 0
      let stopped = false
      const align = () => {
        if (
          stopped ||
          positionStabilizerUserCancelled.current ||
          positionStabilizerSuperseded.current
        )
          return
        const target = eventId
          ? box.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(eventId)}"]`)
          : undefined
        if (target) {
          const delta = target.getBoundingClientRect().top - box.getBoundingClientRect().top - 22
          if (Math.abs(delta) > 0.5) box.scrollTop += delta
        } else {
          box.scrollTop = box.scrollHeight
        }
        atBottom.current =
          box.scrollHeight - box.scrollTop - box.clientHeight <= FOLLOW_LATEST_THRESHOLD
        followLatest.current = atBottom.current
        setShowJumpToLatest(!atBottom.current)
        requestAnimationFrame(markVisibleRead)
      }
      const schedule = () => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(align)
      }
      const resizeObserver = new ResizeObserver(schedule)
      const observeChildren = () =>
        [...box.children].forEach((child) => resizeObserver.observe(child))
      observeChildren()
      resizeObserver.observe(box)
      const mutationObserver = new MutationObserver(() => {
        observeChildren()
        schedule()
      })
      mutationObserver.observe(box, { childList: true, subtree: true })
      const stop = (event?: Event) => {
        if (stopped) return
        if (event) positionStabilizerUserCancelled.current = true
        stopped = true
        cancelAnimationFrame(frame)
        resizeObserver.disconnect()
        mutationObserver.disconnect()
        window.clearTimeout(timeout)
        box.removeEventListener('wheel', stop)
        box.removeEventListener('touchstart', stop)
        box.removeEventListener('pointerdown', stop)
      }
      box.addEventListener('wheel', stop, { passive: true })
      box.addEventListener('touchstart', stop, { passive: true })
      box.addEventListener('pointerdown', stop)
      const timeout = window.setTimeout(stop, 12_000)
      positionStabilizerCleanup.current = stop
      schedule()
    },
    [markVisibleRead],
  )
  useEffect(() => () => positionStabilizerCleanup.current(), [roomIdentity])
  const loadOlder = useCallback(async () => {
    if (
      !room ||
      !timeline ||
      preJoinHistoryBoundaryReached ||
      historyFullyLoaded ||
      loadingRef.current ||
      !historyPagingReady.current ||
      historyPagingRoom.current !== roomIdentity ||
      pendingJumpRef.current
    )
      return
    const box = messagesRef.current
    if (!box) return
    loadingRef.current = true
    setLoadingHistory(true)
    scrollAnchor.current = undefined
    const captured = captureScrollAnchor()
    try {
      let availableBefore = windowStart
      if (!availableBefore) {
        const before = timeline
          .getEvents()
          .filter((event) => isAvailableTimelineMessage(event, room)).length
        logHistoryDiagnostics(room, 'pagination:start', {
          scroll_top: box.scrollTop,
          scroll_height: box.scrollHeight,
          client_height: box.clientHeight,
          anchor_event_id: captured?.eventId,
        })
        let paginationResult = true
        let pagesLoaded = 0
        while (
          availableBefore < MESSAGE_WINDOW_SHIFT &&
          paginationResult &&
          timeline.getPaginationToken(Direction.Backward) &&
          pagesLoaded < 4
        ) {
          const rawBefore = timeline.getEvents().length
          const visibleBeforePage = timeline
            .getEvents()
            .filter((event) => isAvailableTimelineMessage(event, room)).length
          let paginationTimeout: number | undefined
          paginationResult = await Promise.race([
            matrixService.paginateTimeline(room, timeline, true),
            new Promise<never>((_, reject) => {
              paginationTimeout = window.setTimeout(
                () => reject(new Error('Loading earlier messages timed out')),
                20_000,
              )
            }),
          ]).finally(() => window.clearTimeout(paginationTimeout))
          pagesLoaded++
          render((x) => x + 1)

          if (timeline.getEvents().length > rawBefore) {
            const decryptionDeadline = Date.now() + 1_000
            while (
              timeline.getEvents().filter((event) => isAvailableTimelineMessage(event, room))
                .length === visibleBeforePage &&
              Date.now() < decryptionDeadline
            ) {
              await new Promise<void>((resolve) => window.setTimeout(resolve, 50))
            }
          }
          availableBefore = Math.max(
            0,
            timeline.getEvents().filter((event) => isAvailableTimelineMessage(event, room)).length -
              before,
          )
        }
        logHistoryDiagnostics(room, 'pagination:complete', {
          pagination_result: paginationResult,
          pages_loaded: pagesLoaded,
          loaded_messages: availableBefore,
          scroll_top: box.scrollTop,
          scroll_height: box.scrollHeight,
          client_height: box.clientHeight,
        })
      }
      const shift = Math.min(MESSAGE_WINDOW_SHIFT, availableBefore)
      if (shift) setWindowEndOffset((offset) => offset + shift)
      render((x) => x + 1)
      await restoreScrollAnchor(captured)
    } catch (e) {
      logHistoryDiagnostics(room, 'pagination:error', {
        error: e instanceof Error ? e.message : String(e),
      })
      message.error(e instanceof Error ? e.message : 'Could not load older messages')
    } finally {
      loadingRef.current = false
      setLoadingHistory(false)
    }
  }, [
    room,
    roomIdentity,
    timeline,
    message,
    windowStart,
    preJoinHistoryBoundaryReached,
    historyFullyLoaded,
    captureScrollAnchor,
    restoreScrollAnchor,
  ])
  const loadNewer = useCallback(
    async (options: { auto?: boolean } = {}) => {
      if (
        !room ||
        !contextTimeline ||
        loadingRef.current ||
        !historyPagingReady.current ||
        historyPagingRoom.current !== roomIdentity
      )
        return
      const box = messagesRef.current
      if (!box) return
      loadingRef.current = true
      setLoadingHistory(true)
      scrollAnchor.current = undefined
      const bounds = box.getBoundingClientRect()
      const visible = [...box.querySelectorAll<HTMLElement>('[data-event-id]')].filter((node) => {
        const rect = node.getBoundingClientRect()
        return rect.bottom > bounds.top && rect.top < bounds.bottom
      })
      const anchor = visible.at(-1) ?? visible[0]
      const anchorId = anchor?.dataset.eventId
      const anchorOffset = anchor ? anchor.getBoundingClientRect().top - bounds.top : 0
      try {
        let paginationTimeout: number | undefined
        await Promise.race([
          matrixService.paginateTimeline(room, contextTimeline, false),
          new Promise<never>((_, reject) => {
            paginationTimeout = window.setTimeout(
              () => reject(new Error('Loading newer messages timed out')),
              20_000,
            )
          }),
        ]).finally(() => window.clearTimeout(paginationTimeout))
        render((x) => x + 1)
        if (!contextTimeline.getPaginationToken(Direction.Forward)) {
          if (options.auto) return
          followLatest.current = true
          scrollAnchor.current = { type: 'bottom' }
          setContextTimeline(undefined)
          setWindowEndOffset(0)
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              stabilizeTimelinePosition()
              requestAnimationFrame(markVisibleRead)
            }),
          )
          return
        }
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (anchorId) {
                const target = box.querySelector<HTMLElement>(
                  `[data-event-id="${CSS.escape(anchorId)}"]`,
                )
                if (target)
                  box.scrollTop +=
                    target.getBoundingClientRect().top -
                    box.getBoundingClientRect().top -
                    anchorOffset
              }
              resolve()
            }),
          ),
        )
      } catch (e) {
        message.error(e instanceof Error ? e.message : 'Could not load newer messages')
      } finally {
        loadingRef.current = false
        setLoadingHistory(false)
      }
    },
    [room, roomIdentity, contextTimeline, message, stabilizeTimelinePosition, markVisibleRead],
  )
  useEffect(() => {
    if (!room || !historyPagingEnabled || historyPagingRoom.current !== roomIdentity) return
    const frame = requestAnimationFrame(() => {
      const box = messagesRef.current
      const hasOlder = !!timeline?.getPaginationToken(Direction.Backward)
      if (
        !preJoinHistoryBoundaryReached &&
        hasOlder &&
        box &&
        (allEvents.length === 0 || box.scrollHeight <= box.clientHeight + 2)
      )
        void loadOlder()
    })
    return () => cancelAnimationFrame(frame)
  }, [
    room,
    roomIdentity,
    timeline,
    timelineEvents.length,
    allEvents.length,
    loadOlder,
    historyPagingEnabled,
    preJoinHistoryBoundaryReached,
  ])
  useEffect(() => {
    if (
      !room ||
      !contextTimeline ||
      !historyPagingEnabled ||
      historyPagingRoom.current !== roomIdentity
    )
      return
    const frame = requestAnimationFrame(() => {
      const box = messagesRef.current
      const hasNewer = !!contextTimeline.getPaginationToken(Direction.Forward)
      if (hasNewer && box && (allEvents.length === 0 || box.scrollHeight <= box.clientHeight + 2))
        void loadNewer({ auto: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [
    room,
    roomIdentity,
    contextTimeline,
    timelineEvents.length,
    allEvents.length,
    loadNewer,
    historyPagingEnabled,
    loadingHistory,
  ])
  useEffect(
    () =>
      matrixService.subscribe({
        onEvent: (_event, changedRoom) => {
          if (!changedRoom) return
          for (const cached of [...roomTimelineCache.values()]) {
            if (cached.room.roomId === changedRoom.roomId) cacheRoomTimeline(cached.room)
          }
        },
        onLocalEchoUpdated: (_event, changedRoom) => {
          for (const cached of [...roomTimelineCache.values()]) {
            if (cached.room.roomId === changedRoom.roomId) cacheRoomTimeline(cached.room)
          }
        },
        onRoom: (changedRoom) => {
          for (const cached of [...roomTimelineCache.values()]) {
            if (cached.room.roomId === changedRoom.roomId) cacheRoomTimeline(cached.room)
          }
        },
      }),
    [],
  )
  useLayoutEffect(() => {
    const activeRoom = roomRef.current
    skipInitialMarkRead.current = initializedPhysicalRoom.current === activeRoom?.roomId
    initializedPhysicalRoom.current = activeRoom?.roomId
    historyPagingReady.current = false
    historyPagingRoom.current = undefined
    timelineUserInteracted.current = false
    userScrollIntentUntil.current = 0
    setHistoryPagingEnabled(false)
    initializedRoom.current = undefined
    lastEventId.current = undefined
    lastVisibleEventCount.current = 0
    atBottom.current = false
    followLatest.current = false
    scrollAnchor.current = undefined
    positionStabilizerUserCancelled.current = false
    positionStabilizerSuperseded.current = false
    setContextTimeline(undefined)
    setWindowEndOffset(0)
    setShowJumpToLatest(false)
    setVoiceNotices([])
    render((x) => x + 1)
    if (!activeRoom) {
      setUnreadStart(undefined)
      setPositioningTimeline(true)
      return
    }
    const wasCached = roomTimelineCache.has(roomIdentity ?? '')
    cacheRoomTimeline(activeRoom, true)
    const mountEvents = matrixService.combinedRoomEvents(
      activeRoom,
      linkedRoomTimelineEvents(activeRoom),
    )
    positioningBoundaryEventId.current = mountEvents.at(-1)?.getId() ?? null
    const position = initialRoomPosition(activeRoom, mountEvents)
    followLatest.current = !position.unreadStart
    atBottom.current = !position.unreadStart
    setUnreadStart(position.unreadStart)
    setWindowEndOffset(position.windowEndOffset)
    positioningStartedAt.current = Date.now()
    setPositioningTimeline(!wasCached)
    void matrixService.retryRoomDecryption(activeRoom).then(() => render((x) => x + 1))
  }, [roomIdentity])
  useEffect(() => {
    if (!room || !positioningTimeline) return
    const liveEvents = contextTimeline
      ? linkedTimelineEvents(contextTimeline, [Direction.Backward, Direction.Forward])
      : linkedRoomTimelineEvents(room)
    const position = initialRoomPosition(
      room,
      matrixService.combinedRoomEvents(
        room,
        liveEvents.length > 0
          ? liveEvents
          : (roomTimelineCache.get(roomIdentity ?? '')?.events ?? []),
      ),
      positioningBoundaryEventId.current,
    )
    setUnreadStart(position.unreadStart)
    setWindowEndOffset(position.windowEndOffset)

    const elapsed = Date.now() - positioningStartedAt.current
    const delay = Math.max(0, Math.min(450, 1_800 - elapsed))
    const timer = window.setTimeout(() => setPositioningTimeline(false), delay)
    return () => window.clearTimeout(timer)
  }, [room, roomIdentity, matrixRevision, positioningTimeline, timeline, contextTimeline])
  useLayoutEffect(() => {
    if (!room) return
    const box = messagesRef.current
    if (!box) return
    if (initializedRoom.current !== roomIdentity) {
      initializedRoom.current = roomIdentity
      lastEventId.current = newestId
      lastVisibleEventCount.current = allEvents.length
      return
    }
    const newestChanged = !!newestId && newestId !== lastEventId.current
    const addedEvents = addedVisibleEventCount(lastVisibleEventCount.current, allEvents.length)
    if (shouldHandleTimelineGrowth(newestChanged, addedEvents, loadingRef.current)) {
      positionStabilizerCleanup.current()
      mountPositionRetryCleanup.current()
      positionStabilizerSuperseded.current = true
      const bottomDistance = box.scrollHeight - box.scrollTop - box.clientHeight
      const followBottom = shouldFollowAddedEvents(
        followLatest.current,
        windowEndOffset,
        bottomDistance,
        FOLLOW_LATEST_THRESHOLD,
      )
      if (followBottom && !contextTimeline) {
        scrollAnchor.current = { type: 'bottom' }
        atBottom.current = true
        followLatest.current = true
        setShowJumpToLatest(false)
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (scrollAnchor.current?.type !== 'bottom') return
            box.scrollTop = box.scrollHeight
            atBottom.current = true
            followLatest.current = true
            setShowJumpToLatest(false)
            markVisibleRead()
          }),
        )
      } else if (followBottom) {
        // Context timeline: window grows with loaded events without flipping followLatest/atBottom. only explicit "Jump to latest" or manual scroll back resets it.
      } else if (addedEvents > 0) {
        followLatest.current = false
        scrollAnchor.current = undefined
        setWindowEndOffset((offset) => offset + addedEvents)
        setShowJumpToLatest(true)
      }
      if (newestChanged) lastEventId.current = newestId
    }
    lastVisibleEventCount.current = allEvents.length
  }, [
    room,
    roomIdentity,
    newestId,
    allEvents.length,
    windowEndOffset,
    centerEvent,
    markVisibleRead,
    positioningTimeline,
    contextTimeline,
  ])
  useLayoutEffect(() => {
    if (!room || positioningTimeline || initializedRoom.current !== roomIdentity) return
    const skipMarkRead = skipInitialMarkRead.current
    const position = () => stabilizeTimelinePosition(unreadStart)
    const enableHistoryPaging = () => {
      if (initializedRoom.current !== roomIdentity) return
      historyPagingRoom.current = roomIdentity
      historyPagingReady.current = true
      setHistoryPagingEnabled(true)
    }
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        position()
        requestAnimationFrame(() => {
          if (!skipMarkRead) markVisibleRead()
          requestAnimationFrame(enableHistoryPaging)
        })
      }),
    )
    const retryPositionAndRead = () => {
      position()
      if (!skipMarkRead) requestAnimationFrame(markVisibleRead)
    }
    const firstRetry = window.setTimeout(retryPositionAndRead, 350)
    const secondRetry = window.setTimeout(retryPositionAndRead, 1_200)
    const cleanup = () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(firstRetry)
      window.clearTimeout(secondRetry)
    }
    mountPositionRetryCleanup.current = cleanup
    return cleanup
  }, [
    room,
    roomIdentity,
    positioningTimeline,
    unreadStart,
    markVisibleRead,
    stabilizeTimelinePosition,
  ])
  useEffect(() => {
    if (
      (!acceptedInvite && room?.getMyMembership() !== 'join') ||
      isAndroidApp() ||
      window.matchMedia('(max-width:760px), (pointer:coarse)').matches
    )
      return
    const frame = requestAnimationFrame(() =>
      messagesRef.current?.parentElement
        ?.querySelector<HTMLElement>('[contenteditable="true"]')
        ?.focus({ preventScroll: true }),
    )
    return () => cancelAnimationFrame(frame)
  }, [room, acceptedInvite])
  useLayoutEffect(() => {
    const box = messagesRef.current
    if (!box) return
    let frame = 0
    let observer: ResizeObserver | undefined
    const release = () => {
      scrollAnchor.current = undefined
      observer?.disconnect()
    }
    const stabilize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const anchor = scrollAnchor.current
        if (anchor?.type === 'event') centerEvent(anchor.eventId)
        else if (anchor?.type === 'bottom') {
          box.scrollTop = box.scrollHeight
          atBottom.current = true
          followLatest.current = true
          setShowJumpToLatest(false)
        }
      })
    }
    observer = new ResizeObserver(stabilize)
    ;[...box.children].forEach((child) => observer?.observe(child))
    box.addEventListener('wheel', release, { passive: true })
    box.addEventListener('touchstart', release, { passive: true })
    box.addEventListener('pointerdown', release)
    const timeout = window.setTimeout(release, 1500)
    stabilize()
    return () => {
      window.clearTimeout(timeout)
      cancelAnimationFrame(frame)
      observer?.disconnect()
      box.removeEventListener('wheel', release)
      box.removeEventListener('touchstart', release)
      box.removeEventListener('pointerdown', release)
    }
  }, [room, newestId, centerEvent])
  useEffect(() => {
    const focused = () => markVisibleRead()
    window.addEventListener('focus', focused)
    document.addEventListener('visibilitychange', focused)
    return () => {
      window.removeEventListener('focus', focused)
      document.removeEventListener('visibilitychange', focused)
      window.clearTimeout(receiptTimer.current)
    }
  }, [markVisibleRead])
  useEffect(() => {
    draftRef.current = ''
    pendingImagesRef.current = []
    inlineEmotesRef.current.clear()
    composerRevisionRef.current++
    setReplyingTo(undefined)
    setEditing(undefined)
    setPendingImages([])
    setRawImages(new Set())
    setSpoilerImages(new Set())
    setPreserveMetadataImages(new Set())
    setAnonymizeFiles(new Set())
    setVoiceMeta(new Map())
    const focusComposer = () =>
      window.setTimeout(
        () =>
          messagesRef.current?.parentElement
            ?.querySelector<HTMLElement>('[contenteditable="true"]')
            ?.focus({ preventScroll: true }),
        1,
      )
    const reply = (event: Event) => {
      const target = (event as CustomEvent<MatrixEvent>).detail
      if (target.getRoomId() === room?.roomId) {
        setEditing(undefined)
        setReplyingTo(target)
        focusComposer()
      }
    }
    const edit = (event: Event) => {
      const target = (event as CustomEvent<MatrixEvent>).detail
      if (target.getRoomId() !== room?.roomId) return
      const lines = String(target.getContent().body ?? '').split('\n')
      while (lines[0]?.startsWith('> ')) lines.shift()
      if (lines[0] === '') lines.shift()
      const relation = target.getContent()['m.relates_to'] as
        | { rel_type?: string; 'm.in_reply_to'?: { event_id: string } }
        | undefined
      const replyId = relation?.rel_type ? undefined : relation?.['m.in_reply_to']?.event_id
      const localReplyTarget = replyId ? room?.findEventById(replyId) : undefined
      setReplyingTo(localReplyTarget)
      setPendingImages([])
      setRawImages(new Set())
      setSpoilerImages(new Set())
      setPreserveMetadataImages(new Set())
      setAnonymizeFiles(new Set())
      setEditing(target)
      setDraft(lines.join('\n'))
      if (replyId && !localReplyTarget) {
        const roomId = target.getRoomId()
        if (roomId)
          void matrixService.loadReplyEvent(roomId, replyId).then((value) => {
            if (value && editingRef.current?.getId() === target.getId()) setReplyingTo(value)
          })
      }
    }
    const jump = (event: Event) => {
      const { eventId, roomId } = (event as CustomEvent<{ eventId: string; roomId: string }>).detail
      if (roomId !== room?.roomId) return
      attemptJumpRef.current(eventId)
    }
    window.addEventListener('foxchat-reply', reply)
    window.addEventListener('foxchat-edit', edit)
    window.addEventListener('foxchat-jump-to-event', jump)
    return () => {
      window.removeEventListener('foxchat-reply', reply)
      window.removeEventListener('foxchat-edit', edit)
      window.removeEventListener('foxchat-jump-to-event', jump)
    }
  }, [room])
  const firstVisibleEventId = visibleMessages[0]?.getId()
  const lastVisibleEventId = visibleMessages.at(-1)?.getId()
  useEffect(() => {
    const pending = pendingJumpRef.current
    if (!pending) return
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => attemptJumpRef.current(pending.eventId)),
    )
    return () => cancelAnimationFrame(raf)
  }, [windowEndOffset, firstVisibleEventId, lastVisibleEventId, renderTick])
  useEffect(() => {
    draftRef.current = draft
  }, [draft])
  useEffect(() => {
    editingRef.current = editing
  }, [editing])
  useEffect(() => {
    pendingImagesRef.current = pendingImages
  }, [pendingImages])
  useEffect(() => {
    const previews = pendingImages.map((file) =>
      file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
    )
    setImagePreviews(previews)
    return () => previews.filter(Boolean).forEach(URL.revokeObjectURL)
  }, [pendingImages])
  useEffect(() => {
    if (!room) return
    const attach = () => {
      const files = takeSharedFiles(room.roomId)
      if (files?.length) setPendingImages((current) => [...current, ...files])
    }
    attach()
    window.addEventListener(sharedFileEvent, attach)
    return () => window.removeEventListener(sharedFileEvent, attach)
  }, [room])
  useEffect(() => {
    if (!room) return
    const paste = (event: ClipboardEvent) => {
      if (!acceptedInvite && room.getMyMembership() !== 'join') return
      const images = [...(event.clipboardData?.items ?? [])]
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => !!file)
        .map((image, index) => {
          const extension = image.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
          return new File(
            [image],
            image.name || `pasted-image-${Date.now()}-${index + 1}.${extension}`,
            { type: image.type },
          )
        })
      if (!images.length) return
      event.preventDefault()
      setPendingImages((current) => [...current, ...images])
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  }, [room, acceptedInvite])
  useEffect(() => {
    if (!room) return
    const keydown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        !(target instanceof HTMLElement) ||
        !target.isContentEditable ||
        !messagesRef.current?.parentElement?.contains(target)
      )
        return
      if (event.key === 'Escape' && editing) {
        event.preventDefault()
        setEditing(undefined)
        setDraft('')
        setReplyingTo(undefined)
        return
      }
      if (event.key !== 'ArrowUp' || draft || replyingTo || editing || pendingImages.length) return
      const userId = matrixService.matrixClient?.getUserId()
      const last = [...room.getLiveTimeline().getEvents()]
        .reverse()
        .find(
          (item) =>
            item.getSender() === userId &&
            isVisibleMessageEvent(item) &&
            item.getType() === EventType.RoomMessage &&
            item.getContent().msgtype === 'm.text' &&
            item.getId(),
        )
      if (last) {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('foxchat-edit', { detail: last }))
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [room, draft, replyingTo, editing, pendingImages.length])
  const typingRoomId = room?.roomId
  useEffect(
    () => () => {
      window.clearTimeout(typingTimer.current)
      typingActive.current = false
      if (typingRoomId) void matrixService.setTyping(typingRoomId, false)
    },
    [typingRoomId],
  )
  useEffect(() => {
    const main = messagesRef.current?.parentElement
    const phone = main?.querySelector<HTMLElement>('.anticon-phone')?.closest('button')
    const video = main?.querySelector<HTMLElement>('.anticon-video-camera')?.closest('button')
    if (!phone || !room) return
    const enabled = isVoiceChannel(room)
    phone.style.display = enabled ? '' : 'none'
    if (video) video.style.display = 'none'
    if (!enabled) return
    phone.title = 'Join voice channel'
    const join = () =>
      window.dispatchEvent(new CustomEvent<Room>('foxchat-join-voice', { detail: room }))
    phone.addEventListener('click', join)
    return () => phone.removeEventListener('click', join)
  }, [room])
  const latestMessage = allEvents.at(-1)
  const followers = useMemo(() => {
    void matrixRevision
    void renderTick
    const ownFollowerAccountIds = new Set(
      matrixService.availableAccounts().map((account) => account.userId),
    )
    const followerIds = latestMessage
      ? (room
          ?.getUsersReadUpTo(latestMessage)
          .filter((userId) => !ownFollowerAccountIds.has(userId)) ?? [])
      : []
    return followerIds.map((userId) => {
      const member = room?.getMember(userId)
      return {
        userId,
        name: member?.name || userId,
        avatarUrl: member?.getMxcAvatarUrl(),
      }
    })
  }, [room, latestMessage, matrixRevision, renderTick])
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent<ChatFollower[]>('foxchat-followers', {
        detail: followers,
      }),
    )
    return () => {
      window.dispatchEvent(new CustomEvent<ChatFollower[]>('foxchat-followers', { detail: [] }))
    }
  }, [followers])
  if (!room)
    return (
      <Main>
        <Topbar>
          <MobileMenu aria-label="Open room list" onClick={onMenu} icon={<MenuOutlined />} />
          <TopInfo>
            <h2>FoxChat</h2>
            <div className="status">Matrix client</div>
          </TopInfo>
        </Topbar>
        <EmptyState>
          <div>
            <TeamOutlined style={{ fontSize: 45 }} />
            <h3>Select a room</h3>
            <p>Your synchronized Matrix rooms appear on the left.</p>
          </div>
        </EmptyState>
      </Main>
    )
  const acceptInvite = async () => {
    if (!room || acceptingInvite) return
    setAcceptingInvite(true)
    try {
      const invite = matrixService.roomInvites().find((candidate) => candidate.room === room)
      if (invite) {
        await matrixService.joinRoomAs(room.roomId, invite.accountId)
        matrixService.selectRoomAccount(room.roomId, invite.accountId, true)
      } else {
        await matrixService.joinRoom(room.roomId)
      }
      setAcceptedInvite(true)
      render((value) => value + 1)
      message.success(`Joined ${room.name}`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not accept invitation')
    } finally {
      setAcceptingInvite(false)
    }
  }
  const declineInvite = async () => {
    if (!room || decliningInvite) return
    const invite = matrixService.roomInvites().find((candidate) => candidate.room === room)
    if (!invite) {
      message.error('This invitation is no longer available')
      return
    }
    setDecliningInvite(true)
    try {
      await matrixService.declineRoomInvite(room.roomId, invite.accountId)
      message.success(`Declined invitation to ${room.name}`)
      writeRoomUrl(undefined)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not decline invitation')
    } finally {
      setDecliningInvite(false)
    }
  }
  const onScroll = () => {
    const box = messagesRef.current
    if (!box) return
    updateTimelineDateHint()
    if (!historyPagingReady.current || historyPagingRoom.current !== roomIdentity) return
    const bottomDistance = box.scrollHeight - box.scrollTop - box.clientHeight
    atBottom.current = windowEndOffset === 0 && bottomDistance <= FOLLOW_LATEST_THRESHOLD
    const hasUserScrollIntent = Date.now() <= userScrollIntentUntil.current
    followLatest.current = nextFollowLatest(
      followLatest.current,
      atBottom.current,
      hasUserScrollIntent,
    )
    if (!atBottom.current && !followLatest.current) {
      if (scrollAnchor.current?.type === 'bottom') scrollAnchor.current = undefined
    }
    setShowJumpToLatest(!atBottom.current && !followLatest.current)
    const userMovedTimeline = timelineUserInteracted.current
    if (
      userMovedTimeline &&
      box.scrollTop < 80 &&
      !preJoinHistoryBoundaryReached &&
      !historyFullyLoaded
    )
      void loadOlder()
    else if (userMovedTimeline && bottomDistance < 80 && windowEndOffset > 0) {
      const bounds = box.getBoundingClientRect()
      const anchor = [...box.querySelectorAll<HTMLElement>('[data-event-id]')].find(
        (node) => node.getBoundingClientRect().bottom > bounds.top,
      )
      const anchorId = anchor?.dataset.eventId
      const anchorOffset = anchor ? anchor.getBoundingClientRect().top - bounds.top : 0
      setWindowEndOffset((offset) => Math.max(0, offset - MESSAGE_WINDOW_SHIFT))
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const target = anchorId
            ? box.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(anchorId)}"]`)
            : undefined
          if (target)
            box.scrollTop +=
              target.getBoundingClientRect().top - box.getBoundingClientRect().top - anchorOffset
          else box.scrollTop = box.scrollHeight
        }),
      )
    } else if (
      userMovedTimeline &&
      bottomDistance < 80 &&
      windowEndOffset === 0 &&
      contextTimeline
    ) {
      void loadNewer()
    }
    window.clearTimeout(receiptTimer.current)
    receiptTimer.current = window.setTimeout(markVisibleRead, 180)
  }
  const jumpToLatest = () => {
    mountPositionRetryCleanup.current()
    positionStabilizerUserCancelled.current = false
    positionStabilizerSuperseded.current = false
    userScrollIntentUntil.current = 0
    followLatest.current = true
    scrollAnchor.current = { type: 'bottom' }
    setContextTimeline(undefined)
    setWindowEndOffset(0)
    setShowJumpToLatest(false)
    const latest = visibleReadBoundary(timelineEventsRef.current, undefined, true)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        stabilizeTimelinePosition()
        requestAnimationFrame(() => {
          if (initializedRoom.current === roomIdentity) {
            const box = messagesRef.current
            if (box && scrollAnchor.current?.type === 'bottom') {
              box.scrollTop = box.scrollHeight
              atBottom.current = true
              followLatest.current = true
              setShowJumpToLatest(false)
            }
            markVisibleRead()
          }
          if (latest) void matrixService.markRead(latest, visibleAccountIdRef.current)
        })
      }),
    )
  }
  const send = () => {
    const body = draftRef.current.trim()

    const images = [...pendingImages]
    const galleryIds = assignGalleryIds(images, (file) => file.type.startsWith('image/'))
    if (!body && !images.length) return
    if (!canSendMessages) {
      message.error('No joined account can send messages in this room')
      return
    }
    const reply = replyingTo
    const edit = editing
    const raw = new Set(rawImages)
    const spoilers = new Set(spoilerImages)
    const preserveMetadata = new Set(preserveMetadataImages)
    const anonymize = new Set(anonymizeFiles)
    const voice = new Map(voiceMeta)
    const inlineEmotes = [...inlineEmotesRef.current]
      .filter(([token]) => body.includes(token))
      .map(([token, emote]) => ({ token, url: emote.url, body: emote.body }))
    draftRef.current = ''
    pendingImagesRef.current = []
    inlineEmotesRef.current.clear()
    composerRevisionRef.current++
    const clearedRevision = composerRevisionRef.current
    setDraft('')
    setPendingImages([])
    setRawImages(new Set())
    setSpoilerImages(new Set())
    setPreserveMetadataImages(new Set())
    setAnonymizeFiles(new Set())
    setVoiceMeta(new Map())
    setReplyingTo(undefined)
    setEditing(undefined)
    window.clearTimeout(typingTimer.current)
    typingActive.current = false
    void matrixService.setTyping(room.roomId, false)
    const roomId = room.roomId
    const sendAccountId = matrixService.selectedRoomAccountId(roomId)
    if (edit) {
      void matrixService.editMessage(edit, body, reply?.getId()).catch((e) => {
        message.error(e instanceof Error ? e.message : 'Message failed')
        if (composerRevisionRef.current === clearedRevision && !draftRef.current) {
          composerRevisionRef.current++
          draftRef.current = body
          setDraft(body)
          setEditing(edit)
          setReplyingTo(reply)
        }
      })
      return
    }
    jumpToLatest()
    const uploads: Promise<void>[] = []
    for (const image of images) {
      const client = matrixService.clientForRoom(roomId)
      const txnId =
        client?.makeTxnId() ?? `foxchat-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const previewUrl = image.type.startsWith('image/') ? URL.createObjectURL(image) : undefined
      const abortController = new AbortController()
      let cancelled = false
      setUploads((current) => {
        const next = new Map(current)
        next.set(txnId, {
          roomId,
          file: image,
          previewUrl,
          progress: 0,
          cancel: () => {
            cancelled = true
            abortController.abort()
          },
        })
        return next
      })
      uploads.push(
        (async () => {
          try {
            const voiceInfo = voice.get(image)
            const onProgress = (loaded: number, total: number) => {
              setUploads((current) => {
                const entry = current.get(txnId)
                if (!entry) return current
                const next = new Map(current)
                next.set(txnId, {
                  ...entry,
                  progress: total ? loaded / total : entry.progress,
                })
                return next
              })
            }
            if (voiceInfo) {
              if (cancelled) return
              await matrixService.sendVoiceMessage(
                roomId,
                image,
                voiceInfo.duration,
                voiceInfo.waveform,
                txnId,
                onProgress,
                sendAccountId,
              )
              render((x) => x + 1)
              return
            }
            const compressedFile = raw.has(image) ? image : await compressedImageFile(image)
            const stripMetadata = image.type.startsWith('image/') && !preserveMetadata.has(image)
            const preparedFile =
              stripMetadata && compressedFile === image
                ? await stripImageMetadata(image)
                : compressedFile
            const toUpload = anonymize.has(image) ? anonymizedFile(preparedFile) : preparedFile
            if (cancelled) return
            await matrixService.sendFile(
              roomId,
              toUpload,
              txnId,
              onProgress,
              abortController,
              spoilers.has(image),
              sendAccountId,
              galleryIds.get(image),
            )
            render((x) => x + 1)
          } catch (e) {
            if (!cancelled) message.error(e instanceof Error ? e.message : 'Upload failed')
          } finally {
            if (previewUrl) URL.revokeObjectURL(previewUrl)
            setUploads((current) => {
              if (!current.has(txnId)) return current
              const next = new Map(current)
              next.delete(txnId)
              return next
            })
          }
        })(),
      )
    }
    if (body) {
      void (async () => {
        if (uploads.length) await Promise.allSettled(uploads)
        const task = inlineEmotes.length
          ? matrixService.sendTextWithEmotes(roomId, body, inlineEmotes, reply, sendAccountId)
          : reply
            ? matrixService.sendReply(roomId, body, reply, sendAccountId)
            : matrixService.sendText(roomId, body, sendAccountId)
        task
          .then(() => render((x) => x + 1))
          .catch((e) => {
            message.error(e instanceof Error ? e.message : 'Message failed')
            if (
              composerRevisionRef.current === clearedRevision &&
              !draftRef.current &&
              !pendingImagesRef.current.length
            ) {
              composerRevisionRef.current++
              draftRef.current = body
              inlineEmotesRef.current = new Map(
                inlineEmotes.map((emote) => [
                  emote.token,
                  {
                    name: emote.token.slice(1, -1),
                    body: emote.body,
                    url: emote.url,
                  },
                ]),
              )
              setDraft(body)
              setReplyingTo(reply)
            }
          })
      })()
    }
  }
  const shareLocation = () => {
    const sendAccountId = matrixService.selectedRoomAccountId(room.roomId)
    if (!navigator.geolocation) {
      message.error("Location sharing isn't supported on this device")
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void matrixService
          .sendLocation(
            room.roomId,
            position.coords.latitude,
            position.coords.longitude,
            sendAccountId,
          )
          .then(() => render((x) => x + 1))
          .catch((e) => message.error(e instanceof Error ? e.message : 'Could not share location'))
      },
      () => message.error('Location permission denied'),
    )
  }
  const startRecording = async () => {
    try {
      const recorder = new VoiceRecorder()
      await recorder.start()
      recorderRef.current = recorder
      setRecordingMs(0)
      setRecording(true)
      recordingTimerRef.current = window.setInterval(() => setRecordingMs((ms) => ms + 200), 200)
    } catch {
      message.error('Microphone permission denied')
    }
  }
  const stopRecording = async (keep: boolean) => {
    const recorder = recorderRef.current
    recorderRef.current = undefined
    window.clearInterval(recordingTimerRef.current)
    setRecording(false)
    if (!recorder) return
    if (!keep) {
      recorder.cancel()
      return
    }
    try {
      const result = await recorder.stop()
      const file = new File([result.blob], `voice-${Date.now()}.webm`, {
        type: result.mimeType || 'audio/webm',
      })
      setPendingImages((current) => [...current, file])
      setVoiceMeta((current) =>
        new Map(current).set(file, {
          duration: result.duration,
          waveform: result.waveform,
        }),
      )
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not finish the recording')
    }
  }
  const sendSticker = async (emote: MatrixEmote) => {
    try {
      await matrixService.sendSticker(
        room.roomId,
        emote.body,
        emote.url,
        emote.info,
        replyingTo,
        matrixService.selectedRoomAccountId(room.roomId),
      )
      setReplyingTo(undefined)
      render((x) => x + 1)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Sticker failed')
    }
  }
  const sendGif = async (selection: GifSelection) => {
    try {
      const accountId = matrixService.selectedRoomAccountId(room.roomId)
      if (selection.type === 'live')
        await matrixService.sendGif(
          room.roomId,
          selection.gif,
          selection.query,
          replyingTo,
          accountId,
        )
      else await matrixService.sendSavedGif(room.roomId, selection.item, replyingTo, accountId)
      setReplyingTo(undefined)
      render((x) => x + 1)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'GIF failed')
    }
  }
  const insertInlineEmote = (emote: MatrixEmote) => {
    const token = `:${emote.name}:`
    inlineEmotesRef.current.set(token, emote)
    change(`${draftRef.current}${token} `)
    requestAnimationFrame(() =>
      messagesRef.current?.parentElement
        ?.querySelector<HTMLElement>('[contenteditable="true"]')
        ?.focus(),
    )
  }
  const rememberInlineEmote = (emote: MatrixEmote) => {
    const token = `:${emote.name}:`
    inlineEmotesRef.current.set(token, emote)
    rememberRecent(
      recentStorage.emojis,
      {
        name: emote.name,
        body: emote.body,
        url: emote.url,
        info: emote.info,
        usage: emote.usage,
      },
      (item) => item.url,
    )
    return token
  }
  const change = (nextValue: string) => {
    let value = nextValue
    const completedEmote = value.match(/(^|\s):([^:\s]+):$/)
    if (completedEmote) {
      const name = completedEmote[2].toLocaleLowerCase()
      const emote = inlineEmoteSuggestions(
        name,
        availableInlineEmotes,
        recentInlineEmotes,
        availableInlineEmotes.length,
      ).find((candidate) => candidate.name.toLocaleLowerCase() === name)
      if (emote) {
        const token = rememberInlineEmote(emote)
        value = `${value.slice(0, value.length - completedEmote[2].length - 2)}${token} `
      }
    }
    draftRef.current = value
    composerRevisionRef.current++
    setDraft(value)
    setSuggestionsDismissed(false)
    const typing = !!value.trim()
    if (typing && !typingActive.current) {
      typingActive.current = true
      void matrixService.setTyping(room.roomId, true)
    } else if (!typing && typingActive.current) {
      typingActive.current = false
      void matrixService.setTyping(room.roomId, false)
    }
    window.clearTimeout(typingTimer.current)
    if (typing)
      typingTimer.current = window.setTimeout(() => {
        typingActive.current = false
        void matrixService.setTyping(room.roomId, false)
      }, 4000)
  }
  const insertTimestamp = (syntax: string) => {
    const current = draftRef.current
    const prefix = current && !/\s$/.test(current) ? ' ' : ''
    change(`${current}${prefix}${syntax} `)
    requestAnimationFrame(() =>
      messagesRef.current?.parentElement
        ?.querySelector<HTMLElement>('[contenteditable="true"]')
        ?.focus(),
    )
  }
  const mentionMatch = draft.match(/(^|\s)([@#])([^\s@#]*)$/)
  const mentionQuery = (mentionMatch?.[3] ?? '').toLocaleLowerCase()
  const mentionOptions =
    mentionMatch?.[2] === '@'
      ? room
          .getJoinedMembers()
          .filter(
            (member) =>
              !mentionQuery ||
              (member.name || '').toLocaleLowerCase().includes(mentionQuery) ||
              member.userId.toLocaleLowerCase().includes(mentionQuery),
          )
          .slice(0, 8)
          .map((member) => ({
            key: member.userId,
            label: member.name || member.userId,
            id: member.userId,
            avatar: (
              <MemberAvatar
                userId={member.userId}
                name={member.name || member.userId}
                url={member.getMxcAvatarUrl()}
                size={28}
                roomId={room.roomId}
              />
            ),
          }))
      : mentionMatch?.[2] === '#'
        ? matrixService
            .rooms()
            .filter(
              (candidate) =>
                candidate.getMyMembership() === 'join' &&
                (!mentionQuery ||
                  candidate.name.toLocaleLowerCase().includes(mentionQuery) ||
                  (candidate.getCanonicalAlias() ?? '').toLocaleLowerCase().includes(mentionQuery)),
            )
            .slice(0, 8)
            .map((candidate) => ({
              key: candidate.roomId,
              label: candidate.name,
              id: candidate.getCanonicalAlias() || candidate.roomId,
              avatar: <RoomAvatar room={candidate} size={28} />,
            }))
        : []
  const chooseMention = (id: string) => {
    if (!mentionMatch) return
    const start = draft.length - mentionMatch[2].length - mentionMatch[3].length
    change(`${draft.slice(0, start)}${id} `)
    requestAnimationFrame(() =>
      messagesRef.current?.parentElement
        ?.querySelector<HTMLElement>('[contenteditable="true"]')
        ?.focus(),
    )
  }
  const emoteMatch = draft.match(/(^|\s):([^:\s]+)$/)
  const emoteOptions = emoteMatch
    ? inlineEmoteSuggestions(emoteMatch[2], availableInlineEmotes, recentInlineEmotes)
    : []
  const chooseInlineEmote = (emote: MatrixEmote) => {
    if (!emoteMatch) return
    const start = draft.length - emoteMatch[2].length - 1
    const token = rememberInlineEmote(emote)
    change(`${draft.slice(0, start)}${token} `)
    requestAnimationFrame(() =>
      messagesRef.current?.parentElement
        ?.querySelector<HTMLElement>('[contenteditable="true"]')
        ?.focus(),
    )
  }
  const ownAccountIds = new Set(matrixService.availableAccounts().map((account) => account.userId))
  const typingMembers = room
    .getJoinedMembers()
    .filter((member) => member.typing && !ownAccountIds.has(member.userId))
  const typingNames = typingMembers.map((member) => member.name || member.userId)
  const typingLabel =
    typingNames.length === 1
      ? `${typingNames[0]} is typing`
      : typingNames.length === 2
        ? `${typingNames[0]} and ${typingNames[1]} are typing`
        : typingNames.length > 2
          ? `${typingNames.slice(0, 2).join(', ')} and ${typingNames.length - 2} other${typingNames.length === 3 ? '' : 's'} are typing`
          : ''
  const roomSubtitle =
    roomTopic(room) ||
    `${room.getJoinedMemberCount()} members${room.hasEncryptionStateEvent() ? ' · end-to-end encrypted' : ''}`
  const tombstone = room.currentState
    .getStateEvents(EventType.RoomTombstone, '')
    ?.getContent<{ body?: string; replacement_room?: string }>()
  const readingUserId = matrixService.clientForRoomInstance(room)?.getUserId() ?? ''
  const sendingAccounts = matrixService.roomAccounts(room.roomId)
  const sendingAccountId =
    matrixService.selectedRoomAccountId(room.roomId) ?? sendingAccounts[0]?.id
  const sendingAccount = sendingAccounts.find((account) => account.id === sendingAccountId)
  const sendingAccountUserId = sendingAccount?.userId || readingUserId
  const sendingRoom = sendingAccount?.client.getRoom(room.roomId)
  const canSendMessages = sendingRoom?.maySendMessage() === true
  const composerEmpty = !editing && !draft.trim() && pendingImages.length === 0
  const addPendingFiles = (files: File[]) => {
    if (!canSendMessages || !files.length) return
    setPendingImages((current) => [...current, ...files])
    if (anonymizeFilenameDefault()) setAnonymizeFiles((current) => new Set([...current, ...files]))
  }
  const sendingAccountPicker = (
    <Dropdown
      disabled={sendingAccounts.length < 2}
      trigger={['click']}
      menu={{
        selectedKeys: sendingAccountId ? [sendingAccountId] : [],
        items: sendingAccounts.map((account) => ({
          key: account.id,
          icon: <UserSwitchOutlined />,
          label: account.userId,
          onClick: () => matrixService.selectRoomAccount(room.roomId, account.id),
        })),
      }}
    >
      <SendingAsButton
        type="button"
        disabled={sendingAccounts.length < 2}
        aria-label={
          sendingAccounts.length > 1
            ? `Change sending account. Currently ${sendingAccountUserId}`
            : `Sending as ${sendingAccountUserId}`
        }
      >
        <UserSwitchOutlined /> Sending as {sendingAccountUserId}
        {sendingAccounts.length > 1 && (
          <>
            {' '}
            <DownOutlined />
          </>
        )}
      </SendingAsButton>
    </Dropdown>
  )
  const roomUploads = [...uploads.entries()]
    .filter(
      ([txnId, upload]) =>
        upload.roomId === room.roomId &&
        !timelineEvents.some((event) => event.getTxnId() === txnId),
    )
    .map(([txnId, upload]) => ({ txnId, ...upload }))
  return (
    <>
      <Main
        onDragOverCapture={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDropCapture={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          event.stopPropagation()
          addPendingFiles([...event.dataTransfer.files])
        }}
      >
        <Topbar
          data-testid="room-header"
          style={{ cursor: 'pointer' }}
          onClick={(event) => {
            if (!(event.target as HTMLElement).closest('button,a,input')) onInfo()
          }}
        >
          <MobileMenu aria-label="Open room list" onClick={onMenu} icon={<MenuOutlined />} />
          <RoomAvatar room={room} size={41} />
          <TopInfo>
            <h2>{room.name}</h2>
            {typingLabel ? (
              <TypingLine>
                {typingLabel}
                <span className="dots" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
              </TypingLine>
            ) : (
              <div className="status">{roomSubtitle}</div>
            )}
          </TopInfo>
          <IconBtn
            aria-label="Search this room"
            shape="circle"
            icon={<SearchOutlined />}
            onClick={() => openSearchUrl('room')}
          />
          <IconBtn
            aria-label="Threads"
            shape="circle"
            icon={<MessageOutlined />}
            onClick={() => openThreadUrl('list')}
          />
          <IconBtn shape="circle" icon={<PhoneOutlined />} />
          <IconBtn shape="circle" icon={<VideoCameraOutlined />} />
          <IconBtn
            aria-label="Room information"
            onClick={onInfo}
            shape="circle"
            icon={<InfoCircleOutlined />}
          />
        </Topbar>
        <PinnedBar room={room} />
        {tombstone?.replacement_room && (
          <TombstoneBanner>
            {tombstone.body || 'This room has been replaced.'}{' '}
            <a onClick={() => writeRoomUrl(tombstone.replacement_room)}>Go to the new room</a>
          </TombstoneBanner>
        )}
        <Messages
          data-testid="timeline"
          key={roomIdentity}
          ref={messagesRef}
          $background={chatBackgroundUrl}
          $fixedBackground={isAndroidApp()}
          onScroll={onScroll}
          onWheel={() => {
            timelineUserInteracted.current = true
            userScrollIntentUntil.current = Date.now() + 750
          }}
          onTouchStart={() => {
            timelineUserInteracted.current = true
            userScrollIntentUntil.current = Date.now() + 1_500
          }}
          onPointerDown={(event) => {
            timelineUserInteracted.current = true
            if (event.target === event.currentTarget)
              userScrollIntentUntil.current = Date.now() + 30_000
          }}
          onPointerUp={() => {
            userScrollIntentUntil.current = Date.now() + 250
          }}
          onTouchEnd={() => {
            userScrollIntentUntil.current = Date.now() + 500
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return
            event.preventDefault()
            if (!canSendMessages) return
            const files = [...event.dataTransfer.files]
            addPendingFiles(files)
          }}
        >
          {timelineDateHintTimestamp !== undefined && (
            <TimelineDateHint>
              <time dateTime={timelineDateTime(timelineDateHintTimestamp)}>
                {timelineDateLabel(timelineDateHintTimestamp)}
              </time>
            </TimelineDateHint>
          )}
          <HistoryStatus>
            {loadingHistory && !preJoinHistoryRestricted ? 'Loading earlier messages…' : ''}
          </HistoryStatus>
          <Day data-testid={preJoinHistoryRestricted ? 'history-visibility-status' : undefined}>
            {!acceptedInvite && room.getMyMembership() === 'invite'
              ? 'You were invited'
              : preJoinHistoryRestricted
                ? 'History before you joined is not available in this room'
                : historyFullyLoaded
                  ? 'Beginning of the conversation'
                  : 'Messages are synchronized with your homeserver'}
          </Day>
          {!acceptedInvite && room.getMyMembership() === 'invite' ? (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
              <Button
                type="primary"
                loading={acceptingInvite}
                disabled={decliningInvite}
                onClick={() => void acceptInvite()}
              >
                Accept invitation
              </Button>
              <Button
                danger
                loading={decliningInvite}
                disabled={acceptingInvite}
                onClick={() =>
                  Modal.confirm({
                    title: `Decline invitation to ${room.name}?`,
                    okText: 'Decline',
                    okButtonProps: { danger: true },
                    onOk: declineInvite,
                  })
                }
              >
                Decline
              </Button>
            </div>
          ) : positioningTimeline ? (
            <TimelineLoadingSkeleton aria-label="Loading messages">
              {[82, 64, 74, 48, 70].map((width, index) => (
                <div className="row" key={index}>
                  <div className="avatar" />
                  <div className="content">
                    <div className="line name" />
                    <div
                      className="line body"
                      style={{ '--skeleton-width': `${width}%` } as CSSProperties}
                    />
                  </div>
                </div>
              ))}
            </TimelineLoadingSkeleton>
          ) : (
            renderedEvents.map(({ event: e, gallery }, index) => {
              const previousItem = renderedEvents[index - 1]
              const previousEvent = previousItem?.gallery?.at(-1) ?? previousItem?.event
              const startsLocalDay =
                !previousEvent || !isSameLocalDay(previousEvent.getTs(), e.getTs())
              return (
                <div
                  key={e.getTxnId() ?? e.getId() ?? `${e.getTs()}`}
                  data-event-id={e.getId()}
                  data-timeline-event-timestamp={e.getTs()}
                >
                  {startsLocalDay && (
                    <TimelineDateSeparator role="separator" data-timeline-date-separator>
                      <time dateTime={timelineDateTime(e.getTs())}>
                        {timelineDateLabel(e.getTs())}
                      </time>
                    </TimelineDateSeparator>
                  )}
                  {(e.getId() === unreadStart ||
                    gallery?.some((galleryEvent) => galleryEvent.getId() === unreadStart)) && (
                    <Unread>Unread messages</Unread>
                  )}
                  {isMembershipChange(e) ? (
                    <MembershipStatus event={e} />
                  ) : isCallMembershipChange(e) ? (
                    <CallMembershipStatus event={e} />
                  ) : isDisplayNameChange(e) || isAvatarChange(e) ? (
                    <ProfileUpdateStatus
                      event={e}
                      showDisplayName={timelineAppearance.displayName}
                      showAvatar={timelineAppearance.avatar}
                    />
                  ) : (
                    <Message
                      event={e}
                      gallery={gallery}
                      revision={`${matrixRevision}:${renderTick}`}
                    />
                  )}
                </div>
              )
            })
          )}
          {timelineAppearance.voiceMembership &&
            voiceNotices.map((notice) => (
              <MembershipLine
                key={notice.id}
                title={new Date(notice.timestamp).toLocaleTimeString()}
              >
                {notice.text}
              </MembershipLine>
            ))}
          {roomUploads.map((upload) => (
            <PendingUpload
              key={upload.txnId}
              file={upload.file}
              progress={upload.progress}
              previewUrl={upload.previewUrl}
              onCancel={upload.cancel}
            />
          ))}
        </Messages>
        {showJumpToLatest && (
          <JumpToLatest
            type="button"
            onClick={jumpToLatest}
            aria-label="Jump to latest messages"
            style={composerHeight ? { bottom: `calc(${composerHeight}px + 12px)` } : undefined}
          >
            <ArrowDownOutlined /> Latest messages
          </JumpToLatest>
        )}
        {(acceptedInvite || room.getMyMembership() === 'join') && (
          <ComposerArea
            ref={setComposerElement}
            data-message-editing={editing ? 'true' : undefined}
          >
            {!canSendMessages && (
              <NoSendNotice>
                None of your joined accounts can send messages in this room
              </NoSendNotice>
            )}
            {(replyingTo || editing || pendingImages.length > 0) && (
              <ComposeTray>
                {editing && (
                  <div className="item">
                    <div className="replyText">
                      <b>Editing message</b>
                    </div>
                    <button
                      className="remove"
                      title="Cancel edit"
                      onClick={() => {
                        setEditing(undefined)
                        setDraft('')
                        setReplyingTo(undefined)
                      }}
                    >
                      <CloseOutlined />
                    </button>
                  </div>
                )}
                {replyingTo && (
                  <div className="item">
                    <div className="replyText">
                      <b>Replying to {replyingTo.sender?.name || replyingTo.getSender()}</b>
                      <br />
                      {eventBody(replyingTo)}
                    </div>
                    <button
                      className="remove"
                      title="Cancel reply"
                      onClick={() => setReplyingTo(undefined)}
                    >
                      <CloseOutlined />
                    </button>
                  </div>
                )}
                {pendingImages.map((image, index) => (
                  <div className="item" key={`${image.name}-${image.lastModified}-${index}`}>
                    {imagePreviews[index] && (
                      <div className="imagePreview">
                        <img src={imagePreviews[index]} alt="Image preview" />
                      </div>
                    )}
                    <div className="replyText">
                      {voiceMeta.has(image) ? (
                        <>
                          <b>Voice message</b>
                          <br />
                          {Math.floor(voiceMeta.get(image)!.duration / 60000)}:
                          {String(
                            Math.floor((voiceMeta.get(image)!.duration % 60000) / 1000),
                          ).padStart(2, '0')}
                        </>
                      ) : (
                        <>
                          <b>{image.name}</b>
                          <br />
                          {formatFileSize(image.size)}
                          {image.type.startsWith('image/') && (
                            <>
                              <div style={{ marginTop: 8 }}>
                                <Segmented
                                  size="small"
                                  value={rawImages.has(image) ? 'raw' : 'compressed'}
                                  options={[
                                    { label: 'Compressed', value: 'compressed' },
                                    { label: 'Raw', value: 'raw' },
                                  ]}
                                  onChange={(value) =>
                                    setRawImages((current) => {
                                      const next = new Set(current)
                                      if (value === 'raw') next.add(image)
                                      else next.delete(image)
                                      return next
                                    })
                                  }
                                />
                              </div>
                              <div
                                style={{
                                  marginTop: 8,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                }}
                              >
                                <Switch
                                  size="small"
                                  checked={spoilerImages.has(image)}
                                  onChange={(checked) =>
                                    setSpoilerImages((current) => {
                                      const next = new Set(current)
                                      if (checked) next.add(image)
                                      else next.delete(image)
                                      return next
                                    })
                                  }
                                />
                                <span style={{ fontSize: 12 }}>Hide as spoiler</span>
                              </div>
                              <div
                                style={{
                                  marginTop: 8,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                }}
                              >
                                <Switch
                                  size="small"
                                  checked={!preserveMetadataImages.has(image)}
                                  onChange={(checked) =>
                                    setPreserveMetadataImages((current) => {
                                      const next = new Set(current)
                                      if (checked) next.delete(image)
                                      else next.add(image)
                                      return next
                                    })
                                  }
                                />
                                <span
                                  style={{ fontSize: 12 }}
                                  title="Removes location, camera, capture time, and other embedded metadata before upload"
                                >
                                  Strip sensitive metadata
                                </span>
                              </div>
                            </>
                          )}
                          <div
                            style={{
                              marginTop: 8,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <Switch
                              size="small"
                              checked={anonymizeFiles.has(image)}
                              onChange={(checked) =>
                                setAnonymizeFiles((current) => {
                                  const next = new Set(current)
                                  if (checked) next.add(image)
                                  else next.delete(image)
                                  return next
                                })
                              }
                            />
                            <span style={{ fontSize: 12 }}>Anonymize filename</span>
                          </div>
                        </>
                      )}
                    </div>
                    <button
                      className="remove"
                      title="Remove image"
                      aria-label="Remove image"
                      onClick={() => {
                        setPendingImages((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                        setRawImages((current) => {
                          const next = new Set(current)
                          next.delete(image)
                          return next
                        })
                        setAnonymizeFiles((current) => {
                          const next = new Set(current)
                          next.delete(image)
                          return next
                        })
                        setSpoilerImages((current) => {
                          const next = new Set(current)
                          next.delete(image)
                          return next
                        })
                        setPreserveMetadataImages((current) => {
                          const next = new Set(current)
                          next.delete(image)
                          return next
                        })
                        setVoiceMeta((current) => {
                          const next = new Map(current)
                          next.delete(image)
                          return next
                        })
                      }}
                    >
                      <CloseOutlined />
                    </button>
                  </div>
                ))}
              </ComposeTray>
            )}
            <Composer data-testid="composer-bar">
              {emoteOptions.length > 0 && !suggestionsDismissed && (
                <MentionMenu role="listbox" aria-label="Emoji suggestions">
                  {emoteOptions.map((emote, index) => (
                    <button
                      key={`${emote.name}:${emote.url}`}
                      type="button"
                      role="option"
                      aria-selected={index === 0}
                      className={index === 0 ? 'active' : undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseInlineEmote(emote)}
                    >
                      <span className="emotePreview">
                        <MatrixEmoteImage emote={emote} />
                      </span>
                      <span className="meta">
                        <div className="label">:{emote.name}:</div>
                        <div className="id">{emote.body}</div>
                      </span>
                    </button>
                  ))}
                </MentionMenu>
              )}
              {mentionOptions.length > 0 && !suggestionsDismissed && (
                <MentionMenu>
                  {mentionOptions.map((option, index) => (
                    <button
                      key={option.key}
                      type="button"
                      className={index === 0 ? 'active' : undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseMention(option.id)}
                    >
                      {option.avatar}
                      <span className="meta">
                        <div className="label">{option.label}</div>
                        <div className="id">{option.id}</div>
                      </span>
                    </button>
                  ))}
                </MentionMenu>
              )}
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])]
                  addPendingFiles(files)
                  e.target.value = ''
                }}
              />
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'file',
                      label: 'Upload file',
                      icon: <FileTextOutlined />,
                      onClick: () => fileRef.current?.click(),
                    },
                    {
                      key: 'image',
                      label: 'Upload image',
                      icon: <PictureOutlined />,
                      onClick: () => fileRef.current?.click(),
                    },
                    {
                      key: 'location',
                      label: 'Share location',
                      icon: <EnvironmentOutlined />,
                      onClick: shareLocation,
                    },
                    {
                      key: 'poll',
                      label: 'Create poll',
                      icon: <BarChartOutlined />,
                      onClick: () => setPollOpen(true),
                    },
                    {
                      key: 'timestamp',
                      label: 'Create timestamp',
                      icon: <ClockCircleOutlined />,
                      onClick: () => setTimestampOpen(true),
                    },
                  ],
                }}
              >
                <IconBtn shape="circle" icon={<PaperClipOutlined />} />
              </Dropdown>
              <MessageComposerInput
                value={draft}
                emotes={inlineEmotesRef.current}
                onChange={change}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Escape' &&
                    !suggestionsDismissed &&
                    (emoteOptions.length > 0 || mentionOptions.length > 0)
                  ) {
                    e.preventDefault()
                    e.stopPropagation()
                    setSuggestionsDismissed(true)
                  } else if ((e.key === 'Tab' || e.key === 'Enter') && emoteOptions[0]) {
                    e.preventDefault()
                    chooseInlineEmote(emoteOptions[0])
                  } else if (e.key === 'Tab' && mentionOptions[0]) {
                    e.preventDefault()
                    chooseMention(mentionOptions[0].id)
                  } else if (e.key === 'Enter' && !e.shiftKey && !isAndroidApp()) {
                    e.preventDefault()
                    if (mentionOptions[0]) chooseMention(mentionOptions[0].id)
                    else void send()
                  } else if (e.key === 'Enter' && mentionOptions[0]) {
                    e.preventDefault()
                    chooseMention(mentionOptions[0].id)
                  }
                }}
                placeholder={
                  editing
                    ? replyingTo
                      ? `Edit reply to ${replyingTo.sender?.name || replyingTo.getSender()}`
                      : 'Edit message'
                    : replyingTo
                      ? `Reply to ${replyingTo.sender?.name || replyingTo.getSender()}`
                      : `Message ${room.name}`
                }
                onDropFiles={addPendingFiles}
              />
              <EmojiButton
                room={room}
                onUnicode={(emoji) => change(draftRef.current + emoji)}
                onEmote={insertInlineEmote}
                onSticker={(emote) => void sendSticker(emote)}
                onSelectGif={(selection) => void sendGif(selection)}
                onAvailableEmotes={setAvailableInlineEmotes}
              />
              {!isSmallScreen && (
                <GifButton room={room} onSelect={(selection) => void sendGif(selection)} />
              )}
              {recording ? (
                <>
                  <span
                    style={{
                      fontSize: 12,
                      opacity: 0.75,
                      minWidth: 38,
                      textAlign: 'center',
                    }}
                  >
                    {Math.floor(recordingMs / 60000)}:
                    {String(Math.floor((recordingMs % 60000) / 1000)).padStart(2, '0')}
                  </span>
                  <IconBtn
                    aria-label="Cancel recording"
                    shape="circle"
                    icon={<CloseOutlined />}
                    onClick={() => void stopRecording(false)}
                  />
                  <IconBtn
                    aria-label="Finish recording"
                    shape="circle"
                    icon={<CheckOutlined />}
                    onClick={() => void stopRecording(true)}
                  />
                </>
              ) : (
                <>
                  {isSmallScreen && composerEmpty ? (
                    <SendBtn
                      aria-label="Record a voice message"
                      onClick={() => void startRecording()}
                      icon={<AudioOutlined />}
                    />
                  ) : (
                    <>
                      {!isSmallScreen && (
                        <IconBtn
                          aria-label="Record a voice message"
                          shape="circle"
                          icon={<AudioOutlined />}
                          onClick={() => void startRecording()}
                        />
                      )}
                      <SendBtn
                        aria-label="Send message"
                        disabled={!canSendMessages}
                        onClick={() => void send()}
                        icon={<SendOutlined />}
                      />
                    </>
                  )}
                </>
              )}
            </Composer>
            {sendingAccountPicker}
          </ComposerArea>
        )}
      </Main>
      <RoomInfoModals room={room} view={roomModal} onView={showRoomModal} />
      <PollComposerModal
        open={pollOpen}
        roomId={room.roomId}
        accountId={matrixService.selectedRoomAccountId(room.roomId)}
        onClose={() => setPollOpen(false)}
      />
      <TimestampComposerModal
        open={timestampOpen}
        onClose={() => setTimestampOpen(false)}
        onInsert={insertTimestamp}
      />
      <ThreadHost
        room={room}
        view={threadView}
        revision={`${matrixRevision}:${renderTick}`}
        onClose={() => {
          setThreadView(undefined)
          closeThreadUrl()
        }}
      />
    </>
  )
}

export const Timeline = memo(TimelineView)
