import { ImageViewerHost, VideoViewerHost } from './media'
import { RoomDetails } from './rooms'
import { RoomList } from './rooms'
import { RoomSettingsHost } from './rooms/settings'
import { SpaceOverview } from './spaces'
import { Timeline } from './chat'
import { UserProfileHost } from './profile'
import { VerificationDialog } from './VerificationDialog'
import { WelcomeDialog } from './WelcomeDialog'
import { type ThemeMode } from '../lib/constants'
import {
  closeTopBackLayer,
  closeTopVisualLayer,
  installHistoryBackHandler,
  leaveOpenSpaceDrawer,
} from '../lib/backNavigation'
import { useMediaQuery } from '../lib/hooks'
import { MOBILE_LAYOUT_BREAKPOINT, shouldUseMobileLayout } from '../lib/responsiveLayout'
import { containingSpacePath, lastSpaceRooms, rememberSpaceRoom } from '../lib/spaceHelpers'
import { desktopDetailsOpen, setDesktopDetailsOpen } from '../lib/uiPreferences'
import {
  accountsOpenFromUrl,
  browseFromUrl,
  closeRoomDirectoryUrl,
  closeSearchUrl,
  closeSettingsUrl,
  closeVerificationUrl,
  emojiOpenFromUrl,
  isDrawerOpenFromUrl,
  messageMenuOpenFromUrl,
  openSettingsUrl,
  openVerificationUrl,
  roomActionFromUrl,
  roomDirectoryOpenFromUrl,
  roomIdFromUrl,
  roomModalFromUrl,
  searchOpenFromUrl,
  setDrawerOpenUrl,
  settingsOpenFromUrl,
  spaceIdFromUrl,
  threadViewFromUrl,
  unreadFromUrl,
  userProfileIdFromUrl,
  verificationOpenFromUrl,
  writeRoomUrl,
} from '../lib/urlState'
import { Shell, themes } from '../styles'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Drawer, Input, Modal, Segmented, Spin, App as AntApp } from 'antd'
import { Room, RoomType } from 'matrix-js-sdk'
import { VerificationPhase, type VerificationRequest } from 'matrix-js-sdk/lib/crypto-api'
import { AUTO_READ_ALL_ACCOUNTS_CHANGED_EVENT, matrixService } from '../matrix/MatrixClientService'
import {
  listenForNativeNotificationReplies,
  listenForNotificationNavigation,
  notifyMatrixEvent,
} from '../platform/notifications'
import { updateDesktopUnreadBadge } from '../platform/desktopBadge'
import { isAndroidApp } from '../platform/nativeBackground'

const MessageSearchOverlay = lazy(() =>
  import('./MessageSearchOverlay').then((module) => ({ default: module.MessageSearchOverlay })),
)
const RoomDirectoryModal = lazy(() =>
  import('./rooms/RoomDirectoryModal').then((module) => ({
    default: module.RoomDirectoryModal,
  })),
)
const SettingsDialog = lazy(() =>
  import('./SettingsDialog').then((module) => ({ default: module.SettingsDialog })),
)
const UnreadInbox = lazy(() =>
  import('./unread/UnreadInbox').then((module) => ({ default: module.UnreadInbox })),
)

const visibleEscapeLayer = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '.ant-modal-wrap, .ant-dropdown, .ant-popover, [role="menu"], [role="dialog"][aria-modal="true"], .md-code-fullscreen',
    ),
  ].some((element) => {
    if (element.closest('.ant-drawer')) return false
    const style = getComputedStyle(element)
    return (
      !element.hidden &&
      element.getClientRects().length > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.pointerEvents !== 'none'
    )
  })

export function ClientApp({
  mode,
  onMode,
  justRegistered,
}: {
  mode: ThemeMode
  onMode: () => void
  justRegistered?: boolean
}) {
  const { message } = AntApp.useApp()
  const wideDetailsViewport = useMediaQuery('(min-width: 1101px)')
  const narrowViewport = useMediaQuery(`(max-width: ${MOBILE_LAYOUT_BREAKPOINT}px)`)
  const narrowHeightViewport = useMediaQuery(`(max-height: ${MOBILE_LAYOUT_BREAKPOINT}px)`)
  const mobileLayout = shouldUseMobileLayout(narrowViewport, isAndroidApp(), narrowHeightViewport)
  const desktopDetails = wideDetailsViewport && !mobileLayout
  const [desktopInfo, setDesktopInfo] = useState(desktopDetailsOpen)
  const [welcomeOpen, setWelcomeOpen] = useState(() => !!justRegistered)
  useEffect(() => {
    if (desktopDetails) setDesktopDetailsOpen(desktopInfo)
  }, [desktopDetails, desktopInfo])
  const [rooms, setRooms] = useState<Room[]>(() => matrixService.rooms())
  const [matrixRevision, setMatrixRevision] = useState(0)
  const desktopUnreadCount = useMemo(
    () => rooms.reduce((total, room) => total + matrixService.effectiveUnreadCount(room.roomId), 0),
    [rooms],
  )
  useEffect(() => {
    void updateDesktopUnreadBadge(desktopUnreadCount)
  }, [desktopUnreadCount])
  useEffect(() => () => void updateDesktopUnreadBadge(0), [])
  const [lastChangedRoomIds, setLastChangedRoomIds] = useState<ReadonlySet<string>>(
    () => new Set(['*']),
  )
  const [timelineRevision, setTimelineRevision] = useState(0)
  const [selected, setSelected] = useState<string | undefined>(() => roomIdFromUrl())
  const [pendingRoomNavigation, setPendingRoomNavigation] = useState<string | undefined>()
  const [space, setSpace] = useState<string | undefined>(() => spaceIdFromUrl())
  const [spaceOverview, setSpaceOverview] = useState(() => browseFromUrl())
  const [initialSyncReady, setInitialSyncReady] = useState(() =>
    ['PREPARED', 'SYNCING'].includes(
      String(matrixService.matrixClient?.getSyncState()).toUpperCase(),
    ),
  )
  const [mobile, setMobile] = useState(() => isDrawerOpenFromUrl())
  const mobileRef = useRef(mobile)
  mobileRef.current = mobile
  const mobileLayoutRef = useRef(mobileLayout)
  mobileLayoutRef.current = mobileLayout
  const [info, setInfo] = useState(false)
  const [callViewOpen, setCallViewOpen] = useState(false)
  const [unreadInbox, setUnreadInbox] = useState(unreadFromUrl)
  const [settings, setSettings] = useState(() => settingsOpenFromUrl())
  const [directory, setDirectory] = useState(() => roomDirectoryOpenFromUrl())
  const [search, setSearch] = useState(() => searchOpenFromUrl())
  const [recovery, setRecovery] = useState(false)
  const [recoveryMethod, setRecoveryMethod] = useState<'key' | 'passphrase'>('key')
  const [recoverySecret, setRecoverySecret] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [verification, setVerification] = useState<VerificationRequest>()
  const [requestingVerification, setRequestingVerification] = useState(false)
  const roomRefreshFrame = useRef<number | undefined>(undefined)
  const changedRoomIds = useRef(new Set<string>())
  const selectedRoomId = useRef(selected)
  selectedRoomId.current = selected
  const showVerification = useCallback((request: VerificationRequest) => {
    setVerification(request)
    openVerificationUrl()
  }, [])
  const hideVerification = useCallback(() => {
    setVerification(undefined)
    closeVerificationUrl()
  }, [])
  useEffect(() => {
    const stopNavigation = listenForNotificationNavigation()
    const stopReplies = listenForNativeNotificationReplies()
    return () => {
      stopNavigation()
      stopReplies()
    }
  }, [])
  useLayoutEffect(() => {
    const androidWindow = window as typeof window & {
      __foxchatHandleAndroidBack?: () => boolean
    }
    const handleAndroidBack = () => {
      if (closeTopVisualLayer() || closeTopBackLayer()) return true
      if (leaveOpenSpaceDrawer()) return true
      if (!mobileLayoutRef.current) return false
      if (!mobileRef.current) {
        mobileRef.current = true
        setMobile(true)
        setDrawerOpenUrl(true, true)
        return true
      }
      return false
    }
    androidWindow.__foxchatHandleAndroidBack = handleAndroidBack
    const stopHistoryBack = installHistoryBackHandler(handleAndroidBack)
    return () => {
      stopHistoryBack()
      if (androidWindow.__foxchatHandleAndroidBack === handleAndroidBack)
        delete androidWindow.__foxchatHandleAndroidBack
    }
  }, [])
  useEffect(() => {
    const callViewChanged = (event: Event) => {
      const next = (event as CustomEvent<boolean>).detail
      setCallViewOpen(next)
      if (next) {
        if (desktopDetails) setDesktopInfo(false)
        setInfo(false)
      }
    }
    window.addEventListener('foxchat-call-view-changed', callViewChanged)
    return () => window.removeEventListener('foxchat-call-view-changed', callViewChanged)
  }, [desktopDetails])
  useEffect(() => {
    const refresh = (roomId?: string, refreshTimelineGlobally = false) => {
      if (roomId) changedRoomIds.current.add(roomId)
      if (refreshTimelineGlobally) changedRoomIds.current.add('*')
      if (roomRefreshFrame.current !== undefined) return
      roomRefreshFrame.current = requestAnimationFrame(() => {
        roomRefreshFrame.current = undefined
        const changed = changedRoomIds.current
        changedRoomIds.current = new Set()
        setLastChangedRoomIds(changed)
        setRooms((current) => {
          if (changed.has('*')) return [...matrixService.rooms()]
          const byId = new Map(current.map((room) => [room.roomId, room]))
          for (const roomId of changed) {
            const next = matrixService.joinedRoom(roomId)
            if (next) byId.set(roomId, next)
            else byId.delete(roomId)
          }
          return [...byId.values()]
        })
        setMatrixRevision((value) => value + 1)
        if (changed.has('*') || (!!selectedRoomId.current && changed.has(selectedRoomId.current)))
          setTimelineRevision((value) => value + 1)
      })
    }
    const unsubscribe = matrixService.subscribe({
      onRoom: (changedRoom) => refresh(changedRoom.roomId),
      onEvent: (event, eventRoom) => {
        refresh(eventRoom?.roomId ?? event.getRoomId())
        void notifyMatrixEvent(event, eventRoom)
      },
      onLocalEchoUpdated: (event, eventRoom) => refresh(eventRoom.roomId ?? event.getRoomId()),
      onVerificationRequest: showVerification,
      onSync: (state) => {
        const normalized = state.toUpperCase()
        if (['PREPARED', 'SYNCING'].includes(normalized)) setInitialSyncReady(true)
        // Room callbacks carry ordinary sync changes.
        if (normalized === 'PREPARED') refresh(undefined, true)
        if (
          normalized.includes('CRYPTO_KEYS_CHANGED') ||
          normalized.includes('CRYPTO_DEVICES_UPDATED') ||
          normalized.includes('CRYPTO_USER_TRUST_STATUS_CHANGED')
        )
          refresh(undefined, true)
      },
    })
    const unreadPreferenceChanged = () => refresh(undefined, true)
    window.addEventListener(AUTO_READ_ALL_ACCOUNTS_CHANGED_EVENT, unreadPreferenceChanged)
    return () => {
      unsubscribe()
      window.removeEventListener(AUTO_READ_ALL_ACCOUNTS_CHANGED_EVENT, unreadPreferenceChanged)
      if (roomRefreshFrame.current !== undefined) cancelAnimationFrame(roomRefreshFrame.current)
    }
  }, [showVerification])
  useEffect(() => {
    let start: { x: number; y: number } | undefined
    const openDrawer = () => {
      mobileRef.current = true
      setMobile(true)
      setDrawerOpenUrl(true)
    }
    const closeDrawer = () => {
      mobileRef.current = false
      setMobile(false)
      setDrawerOpenUrl(false)
    }
    const begin = (x: number, y: number, target: EventTarget | null) => {
      if (window.innerWidth > 760) return
      const element = target instanceof Element ? target : undefined
      if (mobileRef.current || element?.closest('main')) start = { x, y }
    }
    const finish = (x: number, y: number) => {
      if (!start) return false
      const dx = x - start.x
      const dy = Math.abs(y - start.y)
      start = undefined
      if (dy >= 55) return false
      if (mobileRef.current && dx < -70) {
        closeDrawer()
        return true
      }
      if (!mobileRef.current && dx > 70) {
        openDrawer()
        return true
      }
      return false
    }
    const down = (event: PointerEvent) => begin(event.clientX, event.clientY, event.target)
    const up = (event: PointerEvent) => {
      if (finish(event.clientX, event.clientY)) event.preventDefault()
    }
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      const touch = event.touches[0]
      begin(touch.clientX, touch.clientY, event.target)
    }
    const touchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0]
      if (touch && finish(touch.clientX, touch.clientY)) event.preventDefault()
    }
    const cancel = () => {
      start = undefined
    }
    // Android may cancel pointer events while touch events continue.
    const pointerCancel = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') cancel()
    }
    document.addEventListener('pointerdown', down, { passive: true })
    document.addEventListener('pointerup', up, { passive: false })
    document.addEventListener('pointercancel', pointerCancel, { passive: true })
    document.addEventListener('touchstart', touchStart, { passive: true })
    document.addEventListener('touchend', touchEnd, { passive: false })
    document.addEventListener('touchcancel', cancel, { passive: true })
    window.addEventListener('foxchat-open-drawer', openDrawer)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', pointerCancel)
      document.removeEventListener('touchstart', touchStart)
      document.removeEventListener('touchend', touchEnd)
      document.removeEventListener('touchcancel', cancel)
      window.removeEventListener('foxchat-open-drawer', openDrawer)
    }
  }, [])
  useEffect(() => {
    let pendingRoomTimer: number | undefined
    const back = () => {
      const browsing = browseFromUrl()
      const requestedRoom = roomIdFromUrl()
      setSpaceOverview(browsing)
      setSpace(spaceIdFromUrl())
      if (!browsing) setSelected(requestedRoom)
      setPendingRoomNavigation((current) =>
        current && current !== requestedRoom ? undefined : current,
      )
      setUnreadInbox(unreadFromUrl())
      setMobile(isDrawerOpenFromUrl())
      setSettings(settingsOpenFromUrl())
      setDirectory(roomDirectoryOpenFromUrl())
      setSearch(searchOpenFromUrl())
      if (!verificationOpenFromUrl()) setVerification(undefined)
    }
    const directoryChanged = () => setDirectory(roomDirectoryOpenFromUrl())
    const searchChanged = () => setSearch(searchOpenFromUrl())
    const roomNavigated = (event: Event) => {
      const requestedRoom = (event as CustomEvent<{ roomId?: string }>).detail?.roomId
      const pending =
        requestedRoom && requestedRoom !== 'browse' && requestedRoom !== 'unread'
          ? requestedRoom
          : undefined
      setPendingRoomNavigation(pending)
      if (pendingRoomTimer !== undefined) window.clearTimeout(pendingRoomTimer)
      if (pending)
        pendingRoomTimer = window.setTimeout(
          () => setPendingRoomNavigation((current) => (current === pending ? undefined : current)),
          30_000,
        )
      setRooms([...matrixService.rooms()])
      back()
    }
    window.addEventListener('popstate', back)
    window.addEventListener('foxchat-room-navigated', roomNavigated)
    window.addEventListener('foxchat-directory-changed', directoryChanged)
    window.addEventListener('foxchat-search-changed', searchChanged)
    return () => {
      window.removeEventListener('popstate', back)
      window.removeEventListener('foxchat-room-navigated', roomNavigated)
      window.removeEventListener('foxchat-directory-changed', directoryChanged)
      window.removeEventListener('foxchat-search-changed', searchChanged)
      if (pendingRoomTimer !== undefined) window.clearTimeout(pendingRoomTimer)
    }
  }, [])
  const childIds = useMemo(() => {
    void rooms
    return matrixService.spaceChildIds()
  }, [rooms])
  const roots = useMemo(
    () => rooms.filter((r) => r.getType() === RoomType.Space || !childIds.has(r.roomId)),
    [rooms, childIds],
  )
  const selectedRoom = rooms.find((r) => r.roomId === selected)
  const room = selectedRoom?.getType() === RoomType.Space ? undefined : selectedRoom
  const spaceRoom = rooms.find((r) => r.roomId === space)
  const openedRoomId = room?.roomId
  useEffect(() => {
    if (openedRoomId && !spaceOverview) rememberSpaceRoom(openedRoomId)
  }, [openedRoomId, spaceOverview])
  useEffect(() => {
    if (!openedRoomId) return
    const closeCurrentChat = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        settings ||
        directory ||
        !!search ||
        recovery ||
        !!verification ||
        mobile ||
        info ||
        callViewOpen ||
        accountsOpenFromUrl() ||
        !!roomActionFromUrl() ||
        !!userProfileIdFromUrl() ||
        !!roomModalFromUrl() ||
        !!threadViewFromUrl() ||
        emojiOpenFromUrl() ||
        messageMenuOpenFromUrl() ||
        !!document.querySelector('[data-message-editing="true"]') ||
        visibleEscapeLayer()
      )
        return
      event.preventDefault()
      setSelected(undefined)
      setSpaceOverview(false)
      if (desktopDetails) setDesktopInfo(false)
      setInfo(false)
      writeRoomUrl(undefined, false, space)
    }
    window.addEventListener('keydown', closeCurrentChat)
    return () => window.removeEventListener('keydown', closeCurrentChat)
  }, [
    openedRoomId,
    space,
    settings,
    directory,
    search,
    recovery,
    verification,
    mobile,
    info,
    callViewOpen,
    desktopDetails,
  ])
  const open = useCallback(
    (id: string) => {
      setUnreadInbox(false)
      const next = rooms.find((r) => r.roomId === id)
      if (next?.getType() === RoomType.Space) {
        const remembered = lastSpaceRooms()[id]
        const rememberedRoom = remembered
          ? rooms.find(
              (candidate) =>
                candidate.roomId === remembered &&
                candidate.getType() !== RoomType.Space &&
                candidate.getMyMembership() === 'join',
            )
          : undefined
        if (rememberedRoom && containingSpacePath(rememberedRoom.roomId).includes(id)) {
          const rememberedSpace = containingSpacePath(rememberedRoom.roomId).at(-1)
          setSpaceOverview(false)
          setSpace(rememberedSpace)
          setSelected(rememberedRoom.roomId)
          writeRoomUrl(rememberedRoom.roomId, false, rememberedSpace)
          return
        }
        setSpaceOverview(true)
        if (window.innerWidth <= 760)
          requestAnimationFrame(() => {
            setMobile(true)
            setDrawerOpenUrl(true)
          })
        if (id === space && browseFromUrl()) return
        setSpace(id)
        writeRoomUrl('browse', false, id)
        return
      }
      setSpaceOverview(false)
      const path = containingSpacePath(id)
      const nextSpace = path.at(-1)
      setSpace(nextSpace)
      if (id === roomIdFromUrl() && !browseFromUrl()) {
        if (id !== selected) setSelected(id)
        return
      }
      setSelected(id)
      writeRoomUrl(id, false, nextSpace)
    },
    [rooms, selected, space],
  )
  useEffect(() => {
    const openMention = (event: Event) => open((event as CustomEvent<string>).detail)
    window.addEventListener('foxchat-open-room', openMention)
    const pending = (window as typeof window & { __foxchatPendingNotificationRoom?: string })
      .__foxchatPendingNotificationRoom
    if (pending) {
      delete (window as typeof window & { __foxchatPendingNotificationRoom?: string })
        .__foxchatPendingNotificationRoom
      open(pending)
    }
    return () => window.removeEventListener('foxchat-open-room', openMention)
  }, [open])
  useEffect(() => {
    if (unreadFromUrl()) {
      if (!unreadInbox) setUnreadInbox(true)
      if (spaceOverview) setSpaceOverview(false)
      return
    }
    if (unreadInbox) setUnreadInbox(false)
    const requestedRoom = roomIdFromUrl()
    const requestedSpace = spaceIdFromUrl()
    const validSpace =
      requestedSpace &&
      rooms.some(
        (candidate) =>
          candidate.roomId === requestedSpace && candidate.getType() === RoomType.Space,
      )
        ? requestedSpace
        : undefined
    if (browseFromUrl()) {
      if (requestedSpace && !validSpace && !initialSyncReady) return
      if (validSpace) {
        setSpaceOverview(true)
        if (validSpace !== space) setSpace(validSpace)
        return
      }
    }
    if (requestedRoom) {
      const requested = rooms.find(
        (candidate) => candidate.roomId === requestedRoom && candidate.getType() !== RoomType.Space,
      )
      if (requested) {
        if (pendingRoomNavigation === requestedRoom) setPendingRoomNavigation(undefined)
        const containingSpace = validSpace ?? containingSpacePath(requestedRoom).at(-1)
        if (selected !== requestedRoom) setSelected(requestedRoom)
        if (containingSpace !== space) setSpace(containingSpace)
        if (spaceOverview) setSpaceOverview(false)
        if (spaceIdFromUrl() !== containingSpace) writeRoomUrl(requestedRoom, true, containingSpace)
        return
      }
      if (!initialSyncReady || pendingRoomNavigation === requestedRoom) return
    }
    if (!initialSyncReady) return
    if (selected !== undefined) setSelected(undefined)
    if (space !== validSpace) setSpace(validSpace)
    if (spaceOverview) setSpaceOverview(false)
    if (requestedRoom || requestedSpace !== validSpace) writeRoomUrl(undefined, true, validSpace)
  }, [rooms, selected, space, spaceOverview, unreadInbox, initialSyncReady, pendingRoomNavigation])
  const restore = async () => {
    if (!recoverySecret) return
    setRestoring(true)
    try {
      const result =
        recoveryMethod === 'key'
          ? await matrixService.unlockSecretStorage(recoverySecret)
          : await matrixService.unlockSecretStorageWithPassphrase(recoverySecret)
      message.success(
        'background' in result && result.background
          ? 'Encrypted history recovery enabled'
          : `Restored ${result.imported} of ${result.total} encryption keys`,
      )
      setRecovery(false)
      setRecoverySecret('')
      setRooms([...matrixService.rooms()])
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not restore key backup')
    } finally {
      setRestoring(false)
    }
  }
  const verify = async (deviceId?: string) => {
    setRequestingVerification(true)
    try {
      const request = deviceId
        ? await matrixService.requestDeviceVerification(
            matrixService.matrixClient!.getSafeUserId(),
            deviceId,
          )
        : await matrixService.requestOwnDeviceVerification()
      // The crypto SDK can hand back a previously cancelled/completed request instead of
      // starting a new one if it still considers the old one "in flight". Opening the dialog
      // on that stale request would just show a dead end with no way to retry.
      if (
        request.phase === VerificationPhase.Cancelled ||
        request.phase === VerificationPhase.Done
      ) {
        message.error(
          'The previous verification attempt is still settling. Please try again in a moment, or start verification from the other device instead.',
        )
        return
      }
      showVerification(request)
      // Keep Settings beneath the verification history entry.
      setSettings(false)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not request verification')
    } finally {
      setRequestingVerification(false)
    }
  }
  const showSpaceOverview = (target: Room) => {
    setSpace(target.roomId)
    setSpaceOverview(true)
    if (mobileLayout) {
      setMobile(false)
      setDrawerOpenUrl(false)
    } else if (desktopDetails) {
      setDesktopInfo(true)
    } else {
      setInfo(true)
    }
    if (!browseFromUrl() || spaceIdFromUrl() !== target.roomId)
      writeRoomUrl('browse', false, target.roomId)
  }
  const toggleInfo = useCallback(() => {
    if (callViewOpen) return
    if (desktopDetails) setDesktopInfo((open) => !open)
    else setInfo(true)
  }, [callViewOpen, desktopDetails])
  const showChannelInfo = useCallback(() => {
    setSpaceOverview(false)
    toggleInfo()
  }, [toggleInfo])
  const showTimelineMenu = useCallback(() => {
    setMobile(true)
    setDrawerOpenUrl(true)
  }, [])
  const showSettings = () => {
    setSettings(true)
    openSettingsUrl()
  }
  const showUnreadInbox = () => {
    setUnreadInbox(true)
    setSpaceOverview(false)
    if (desktopDetails) setDesktopInfo(false)
    setInfo(false)
    if (mobileLayout) {
      setMobile(false)
      setDrawerOpenUrl(false)
    }
    if (!unreadFromUrl()) writeRoomUrl('unread')
  }
  const openUnreadMessage = (roomId: string, eventId: string) => {
    setUnreadInbox(false)
    open(roomId)
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('foxchat-jump-to-event', {
          detail: { eventId, roomId },
        }),
      )
    }, 260)
  }
  const hideSettings = () => {
    setSettings(false)
    closeSettingsUrl()
  }
  const hideDirectory = () => {
    setDirectory(false)
    closeRoomDirectoryUrl()
  }
  const hideSearch = () => {
    setSearch(undefined)
    closeSearchUrl()
  }
  const searchAccountId =
    search === 'room' && selected
      ? matrixService.selectedRoomAccountId(selected)
      : (matrixService.activeAccountId() ?? matrixService.availableAccounts()[0]?.id)
  return (
    <>
      <Shell
        $detailsOpen={desktopDetails && desktopInfo}
        $mobileLayout={mobileLayout}
        data-mobile-layout={mobileLayout}
      >
        {!mobileLayout && (
          <RoomList
            rooms={roots}
            allRooms={rooms}
            allChildIds={childIds}
            revision={matrixRevision}
            changedRoomIds={lastChangedRoomIds}
            selected={spaceOverview ? space : selected}
            spaceOverview={spaceOverview}
            onSpaceOverview={showSpaceOverview}
            onSelect={open}
            mode={mode}
            onMode={onMode}
            onSettings={showSettings}
            onUnreadInbox={showUnreadInbox}
          />
        )}
        {unreadInbox ? (
          <Suspense fallback={<Spin />}>
            <UnreadInbox
              rooms={rooms}
              revision={matrixRevision}
              onMenu={() => {
                setMobile(true)
                setDrawerOpenUrl(true)
              }}
              onOpen={openUnreadMessage}
            />
          </Suspense>
        ) : spaceOverview && spaceRoom ? (
          <SpaceOverview
            room={spaceRoom}
            onMenu={() => {
              setMobile(true)
              setDrawerOpenUrl(true)
            }}
            onInfo={toggleInfo}
            onSelect={open}
          />
        ) : (
          <Timeline
            room={room}
            matrixRevision={timelineRevision}
            onMenu={showTimelineMenu}
            onInfo={showChannelInfo}
          />
        )}
      </Shell>
      <Drawer
        open={mobile}
        placement="left"
        width={350}
        closable={false}
        styles={{
          body: { padding: mobileLayout ? '30px 0 0' : 0, overflow: 'hidden' },
        }}
        onClose={() => {
          setMobile(false)
          setDrawerOpenUrl(false)
        }}
      >
        {mobile && (
          <RoomList
            mobile
            rooms={roots}
            allRooms={rooms}
            allChildIds={childIds}
            revision={matrixRevision}
            changedRoomIds={lastChangedRoomIds}
            selected={spaceOverview ? space : selected}
            spaceOverview={spaceOverview}
            onSpaceOverview={(target) => {
              showSpaceOverview(target)
            }}
            onSelect={(id) => {
              open(id)
              if (matrixService.room(id)?.getType() !== RoomType.Space) {
                setMobile(false)
                setDrawerOpenUrl(false)
              }
            }}
            mode={mode}
            onMode={onMode}
            onUnreadInbox={showUnreadInbox}
            onSettings={() => {
              setMobile(false)
              setDrawerOpenUrl(false)
              showSettings()
            }}
          />
        )}
      </Drawer>
      <Drawer
        open={!callViewOpen && (desktopDetails ? desktopInfo : info)}
        zIndex={900}
        placement="right"
        width={320}
        mask={!desktopDetails}
        closable={false}
        keyboard={!desktopDetails}
        styles={{
          content: { background: themes[mode].panel },
          body: {
            padding: mobileLayout ? '30px 0 0' : 0,
            overflow: 'hidden',
            background: themes[mode].panel,
            color: themes[mode].text,
          },
        }}
        onClose={() => {
          if (desktopDetails) setDesktopInfo(false)
          else setInfo(false)
        }}
      >
        <RoomDetails drawer room={spaceOverview ? spaceRoom : room} />
      </Drawer>
      <RoomSettingsHost />
      {directory && (
        <Suspense fallback={null}>
          <RoomDirectoryModal open onClose={hideDirectory} />
        </Suspense>
      )}
      {search && (
        <Suspense fallback={null}>
          <MessageSearchOverlay
            open
            scope={search}
            roomId={selected}
            accountId={searchAccountId}
            onClose={hideSearch}
          />
        </Suspense>
      )}
      <UserProfileHost />
      <ImageViewerHost />
      <VideoViewerHost />
      {settings && (
        <Suspense fallback={null}>
          <SettingsDialog
            open
            onClose={hideSettings}
            mode={mode}
            onMode={onMode}
            onRecover={() => {
              hideSettings()
              setRecovery(true)
            }}
            onVerify={(id) => void verify(id)}
          />
        </Suspense>
      )}
      <Modal
        title="Restore encrypted history"
        open={recovery}
        okText="Restore keys"
        confirmLoading={restoring}
        onOk={() => void restore()}
        onCancel={() => setRecovery(false)}
      >
        <Segmented
          block
          value={recoveryMethod}
          onChange={(value) => {
            setRecoveryMethod(value as 'key' | 'passphrase')
            setRecoverySecret('')
          }}
          options={[
            { label: 'Recovery key', value: 'key' },
            { label: 'Passphrase', value: 'passphrase' },
          ]}
        />
        <p>
          {recoveryMethod === 'key'
            ? 'Enter the recovery key generated when encrypted backup was enabled.'
            : 'Enter the optional passphrase chosen when encrypted backup was set up.'}
        </p>
        <Input.Password
          data-testid="recovery-secret-input"
          value={recoverySecret}
          onChange={(e) => setRecoverySecret(e.target.value)}
          onPressEnter={() => void restore()}
          placeholder={recoveryMethod === 'key' ? 'xxxx xxxx xxxx …' : 'Recovery passphrase'}
          autoFocus
        />
      </Modal>
      {requestingVerification && (
        <Modal open footer={null} closable={false}>
          <Spin /> Sending verification request to your other devices…
        </Modal>
      )}
      {verification && <VerificationDialog request={verification} onClose={hideVerification} />}
      <WelcomeDialog open={welcomeOpen} onClose={() => setWelcomeOpen(false)} />
    </>
  )
}
