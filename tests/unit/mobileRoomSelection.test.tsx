// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isDrawerOpenFromUrl, roomIdFromUrl } from '../../src/lib/urlState'

const state = vi.hoisted(() => ({ remembered: {} as Record<string, string> }))
vi.mock('../../src/matrix/MatrixClientService', () => {
  const rooms = ['a', 'b', 'space'].map((roomId) => ({
    roomId,
    getType: () => (roomId === 'space' ? 'm.space' : undefined),
    getMyMembership: () => 'join',
  }))
  return {
    AUTO_READ_ALL_ACCOUNTS_CHANGED_EVENT: 'read-preference',
    matrixService: {
      rooms: () => rooms,
      room: (id: string) => rooms.find((room) => room.roomId === id),
      matrixClient: { getSyncState: () => 'SYNCING' },
      effectiveUnreadCount: () => 0,
      subscribe: () => () => {},
      spaceChildIds: () => new Set(),
      watchNativeRoom: async () => {},
      activeAccountId: () => 'account',
      availableAccounts: () => [],
    },
  }
})
vi.mock('../../src/lib/spaceHelpers', () => ({
  containingSpacePath: (id: string) => (id === 'b' ? ['space'] : []),
  lastSpaceRooms: () => state.remembered,
  rememberSpaceRoom: () => {},
}))
vi.mock('../../src/lib/hooks', () => ({
  useMediaQuery: (query: string) => query.includes('max-width'),
}))
vi.mock('../../src/platform/nativeBackground', () => ({ isAndroidApp: () => true }))
vi.mock('../../src/platform/nativeMatrix', () => ({ nativeSetActiveRoom: async () => {} }))
vi.mock('../../src/platform/desktopBadge', () => ({ updateDesktopUnreadBadge: async () => {} }))
vi.mock('../../src/platform/notifications', () => ({
  listenForNativeNotificationReplies: () => () => {},
  listenForNotificationNavigation: () => () => {},
  notifyMatrixEvent: () => {},
}))
vi.mock('../../src/styles', () => ({
  Shell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  themes: { dark: {} },
}))
vi.mock('antd', () => ({
  App: { useApp: () => ({ message: {} }) },
  Drawer: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <aside>{children}</aside> : null,
  Modal: () => null,
  Input: () => null,
  Button: () => null,
  Spin: () => null,
  Segmented: () => null,
}))
vi.mock('../../src/components/rooms', () => ({
  RoomDetails: () => null,
  RoomList: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <nav>
      {['a', 'b', 'space'].map((id) => (
        <button key={id} data-room={id} onClick={() => onSelect(id)}>
          {id}
        </button>
      ))}
    </nav>
  ),
}))
vi.mock('../../src/components/chat', () => ({
  Timeline: ({ room }: { room?: { roomId: string } }) => <main>{room?.roomId}</main>,
}))
vi.mock('../../src/components/spaces', () => ({ SpaceOverview: () => <main>space</main> }))
vi.mock('../../src/components/media', () => ({
  ImageViewerHost: () => null,
  VideoViewerHost: () => null,
}))
vi.mock('../../src/components/profile', () => ({ UserProfileHost: () => null }))
vi.mock('../../src/components/rooms/settings', () => ({ RoomSettingsHost: () => null }))
vi.mock('../../src/components/WelcomeDialog', () => ({ WelcomeDialog: () => null }))
vi.mock('../../src/components/VerificationDialog', () => ({ VerificationDialog: () => null }))

import { ClientApp } from '../../src/components/ClientApp'

describe('Android room picker navigation', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    state.remembered = {}
    history.replaceState({}, '', '/?room=a&drawerOpen=true')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })
  const render = () => act(async () => root.render(<ClientApp mode="dark" onMode={() => {}} />))
  const tap = (id: string) =>
    act(async () => container.querySelector<HTMLButtonElement>(`[data-room="${id}"]`)!.click())

  it('publishes a single room selection with the drawer already closed', async () => {
    await render()
    const observed: boolean[] = []
    const listener = () => observed.push(isDrawerOpenFromUrl())
    window.addEventListener('foxchat-room-navigated', listener)
    try {
      await tap('b')
      expect(observed).toEqual([false])
      expect(roomIdFromUrl()).toBe('b')
      expect(container.querySelector('main')?.textContent).toBe('b')
      expect(container.querySelector('nav')).toBeNull()
    } finally {
      window.removeEventListener('foxchat-room-navigated', listener)
    }
  })

  it('closes the picker with one tap on the already selected room', async () => {
    await render()
    await tap('a')
    expect(isDrawerOpenFromUrl()).toBe(false)
    expect(container.querySelector('nav')).toBeNull()
    expect(container.querySelector('main')?.textContent).toBe('a')
  })

  it('closes the picker when a Space opens its remembered channel', async () => {
    state.remembered = { space: 'b' }
    await render()
    await tap('space')
    expect(roomIdFromUrl()).toBe('b')
    expect(isDrawerOpenFromUrl()).toBe(false)
    expect(container.querySelector('nav')).toBeNull()
  })

  it('does not reopen the picker after selecting a channel immediately after a Space', async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    )
    vi.stubGlobal('innerWidth', 390)
    await render()
    await tap('space')
    expect(container.querySelector('nav')).not.toBeNull()
    await tap('b')
    await act(async () => {
      for (const frame of frames) frame(0)
    })
    expect(roomIdFromUrl()).toBe('b')
    expect(isDrawerOpenFromUrl()).toBe(false)
    expect(container.querySelector('nav')).toBeNull()
  })
})
