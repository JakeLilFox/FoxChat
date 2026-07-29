// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  accountLogoutIdFromUrl,
  accountsOpenFromUrl,
  clearAccountLogoutUrl,
  clearRoomDirectoryUrl,
  clearSearchUrl,
  closeAccountLogoutUrl,
  openAccountLogoutUrl,
  openAccountsUrl,
  openRoomDirectoryUrl,
  openSearchUrl,
  openUserProfileUrl,
  roomDirectoryOpenFromUrl,
  roomIdFromUrl,
  roomModalFromUrl,
  searchOpenFromUrl,
  setRoomActionUrl,
  setRoomModalUrl,
  spaceIdFromUrl,
  userProfileIdFromUrl,
  writeRoomUrl,
} from '../../src/lib/urlState'

describe('URL-backed navigation state', () => {
  beforeEach(() => {
    history.replaceState({}, '', '/')
  })

  it('writes and clears room actions while preserving unrelated state', () => {
    history.replaceState({}, '', '/?room=%21room%3Aexample.org')

    setRoomActionUrl('invite')
    expect(new URL(location.href).searchParams.get('roomAction')).toBe('invite')
    expect(roomIdFromUrl()).toBe('!room:example.org')

    setRoomActionUrl(undefined, true)
    expect(new URL(location.href).searchParams.has('roomAction')).toBe(false)
    expect(roomIdFromUrl()).toBe('!room:example.org')
  })

  it('nests account logout confirmation in the accounts history entry', () => {
    openAccountsUrl()
    openAccountLogoutUrl('https://example.org|@alice:example.org|DEVICE')

    expect(accountsOpenFromUrl()).toBe(true)
    expect(accountLogoutIdFromUrl()).toBe('https://example.org|@alice:example.org|DEVICE')
    expect(history.state.foxchatAccountLogout).toBe('https://example.org|@alice:example.org|DEVICE')

    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined)
    closeAccountLogoutUrl()
    expect(back).toHaveBeenCalledOnce()
    back.mockRestore()

    clearAccountLogoutUrl()
    expect(accountLogoutIdFromUrl()).toBeUndefined()
    expect(accountsOpenFromUrl()).toBe(true)
  })

  it('opens and clears search without losing the selected room', () => {
    history.replaceState({}, '', '/?room=%21room%3Aexample.org')
    const changed = vi.fn()
    window.addEventListener('foxchat-search-changed', changed)

    openSearchUrl('room')
    expect(searchOpenFromUrl()).toBe('room')
    clearSearchUrl()

    expect(searchOpenFromUrl()).toBeUndefined()
    expect(roomIdFromUrl()).toBe('!room:example.org')
    expect(changed).toHaveBeenCalledTimes(2)
    window.removeEventListener('foxchat-search-changed', changed)
  })

  it('opens and clears the room directory through replace-safe state', () => {
    openRoomDirectoryUrl()
    expect(roomDirectoryOpenFromUrl()).toBe(true)
    expect(history.state.foxchatDirectory).toBe(true)

    clearRoomDirectoryUrl()
    expect(roomDirectoryOpenFromUrl()).toBe(false)
    expect(history.state.foxchatDirectory).toBeUndefined()
  })

  it('stores encoded profile IDs without disturbing other parameters', () => {
    history.replaceState({}, '', '/?room=%21room%3Aexample.org')
    const request = { anchor: 'member-list' }

    openUserProfileUrl('@alice:example.org', request)

    expect(userProfileIdFromUrl()).toBe('@alice:example.org')
    expect(roomIdFromUrl()).toBe('!room:example.org')
    expect(history.state.foxchatUserProfile).toEqual(request)
  })

  it('navigates rooms and closes room-specific modals atomically', () => {
    history.replaceState(
      { foxchatRoomModal: 'gallery' },
      '',
      '/?room=%21old%3Aexample.org&space=%21oldspace%3Aexample.org&roomModal=gallery',
    )
    const navigated = vi.fn()
    window.addEventListener('foxchat-room-navigated', navigated)

    writeRoomUrl('!new:example.org', false, '!space:example.org')

    expect(roomIdFromUrl()).toBe('!new:example.org')
    expect(spaceIdFromUrl()).toBe('!space:example.org')
    expect(roomModalFromUrl()).toBeUndefined()
    expect(navigated).toHaveBeenCalledOnce()
    expect(navigated.mock.calls[0][0]).toMatchObject({
      detail: {
        roomId: '!new:example.org',
        spaceId: '!space:example.org',
      },
    })
    window.removeEventListener('foxchat-room-navigated', navigated)
  })

  it('clears a room when the desktop URL has no pathname', () => {
    history.replaceState({}, '', '/?room=%21room%3Aexample.org')
    const pathname = vi.spyOn(URL.prototype, 'pathname', 'get').mockReturnValue('')
    const pushState = vi.spyOn(history, 'pushState').mockImplementation(() => undefined)

    writeRoomUrl(undefined)

    expect(pushState).toHaveBeenCalledWith(
      expect.objectContaining({ foxchatRoom: undefined }),
      '',
      '/',
    )
    pushState.mockRestore()
    pathname.mockRestore()
  })

  it('accepts only known room modal values', () => {
    setRoomModalUrl('files')
    expect(roomModalFromUrl()).toBe('files')

    history.replaceState({}, '', '/?roomModal=unknown')
    expect(roomModalFromUrl()).toBeUndefined()
  })
})
