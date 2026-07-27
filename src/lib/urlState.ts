export type RoomAction = 'join' | 'create' | 'create-space' | 'create-dm' | 'invite'
export const roomActionFromUrl = (): RoomAction | undefined => {
  const value = new URL(window.location.href).searchParams.get('roomAction')
  return value === 'join' ||
    value === 'create' ||
    value === 'create-space' ||
    value === 'create-dm' ||
    value === 'invite'
    ? value
    : undefined
}
export const setRoomActionUrl = (action: RoomAction | undefined, replace = false) => {
  const url = new URL(window.location.href)
  if (action) url.searchParams.set('roomAction', action)
  else url.searchParams.delete('roomAction')
  history[replace ? 'replaceState' : 'pushState'](
    { ...history.state, foxchatRoomAction: action },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
  window.dispatchEvent(new CustomEvent('foxchat-room-action'))
}

export const accountsOpenFromUrl = () =>
  new URL(window.location.href).searchParams.get('accounts') === 'true'
export const openAccountsUrl = () => {
  if (accountsOpenFromUrl()) return
  const url = new URL(window.location.href)
  url.searchParams.set('accounts', 'true')
  history.pushState(
    { ...history.state, foxchatAccounts: true },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}
export const clearAccountsUrl = () => {
  if (!accountsOpenFromUrl()) return
  const url = new URL(window.location.href)
  url.searchParams.delete('accounts')
  url.searchParams.delete('accountLogout')
  history.replaceState(
    {
      ...history.state,
      foxchatAccounts: undefined,
      foxchatAccountLogout: undefined,
    },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}

export const accountLogoutIdFromUrl = () =>
  new URL(window.location.href).searchParams.get('accountLogout') ?? undefined
export const openAccountLogoutUrl = (accountId: string) => {
  if (accountLogoutIdFromUrl() === accountId) return
  const url = new URL(window.location.href)
  url.searchParams.set('accounts', 'true')
  url.searchParams.set('accountLogout', accountId)
  history.pushState(
    {
      ...history.state,
      foxchatAccounts: true,
      foxchatAccountLogout: accountId,
    },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}
export const clearAccountLogoutUrl = () => {
  if (!accountLogoutIdFromUrl()) return
  const url = new URL(window.location.href)
  url.searchParams.delete('accountLogout')
  history.replaceState(
    { ...history.state, foxchatAccountLogout: undefined },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}
export const closeAccountLogoutUrl = () => {
  if (!accountLogoutIdFromUrl()) return
  if (history.state?.foxchatAccountLogout) {
    history.back()
    return
  }
  clearAccountLogoutUrl()
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
}

export const userProfileIdFromUrl = () =>
  new URL(window.location.href).searchParams.get('profile') ?? undefined
export const openUserProfileUrl = (userId: string, request: unknown) => {
  const url = new URL(window.location.href)
  url.searchParams.set('profile', userId)
  history.pushState(
    { ...history.state, foxchatUserProfile: request },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}
// Dismissing a profile card does not consume browser history.
export const clearUserProfileUrl = () => {
  if (!userProfileIdFromUrl()) return
  const url = new URL(window.location.href)
  url.searchParams.delete('profile')
  history.replaceState(
    { ...history.state, foxchatUserProfile: undefined },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}

export const closeAccountsUrl = () => {
  if (!accountsOpenFromUrl()) return
  if (history.state?.foxchatAccounts) {
    history.back()
    return
  }
  clearAccountsUrl()
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
}

export const browseFromUrl = () =>
  new URL(window.location.href).searchParams.get('room') === 'browse'
export const unreadFromUrl = () =>
  new URL(window.location.href).searchParams.get('room') === 'unread'
export const isDrawerOpenFromUrl = () =>
  new URL(window.location.href).searchParams.get('drawerOpen') === 'true'
export type RoomModalView = 'info' | 'gallery' | 'links' | 'files'
export const roomModalFromUrl = () => {
  const value = new URL(window.location.href).searchParams.get('roomModal')
  return value === 'info' || value === 'gallery' || value === 'links' || value === 'files'
    ? value
    : undefined
}
export const setRoomModalUrl = (view: RoomModalView | undefined, replace = false) => {
  const url = new URL(window.location.href)
  if (view) url.searchParams.set('roomModal', view)
  else url.searchParams.delete('roomModal')
  history[replace ? 'replaceState' : 'pushState'](
    { ...history.state, foxchatRoomModal: view },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}
export const openRoomGallery = () => {
  setRoomModalUrl('gallery')
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
}
export const openRoomLinks = () => {
  setRoomModalUrl('links')
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
}
export const openRoomFiles = () => {
  setRoomModalUrl('files')
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
}
export const closeRoomModal = () => {
  setRoomModalUrl(undefined, true)
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
}
export const setDrawerOpenUrl = (open: boolean, replace = false) => {
  if (isDrawerOpenFromUrl() === open) return
  const url = new URL(window.location.href)
  if (open) url.searchParams.set('drawerOpen', 'true')
  else url.searchParams.delete('drawerOpen')
  history[replace ? 'replaceState' : 'pushState'](
    { ...history.state, foxchatDrawerOpen: open },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}
export const settingsOpenFromUrl = () =>
  new URL(window.location.href).searchParams.get('settings') === 'true'
export const openSettingsUrl = () => {
  const url = new URL(window.location.href)
  url.searchParams.set('settings', 'true')
  history.pushState(
    { ...history.state, foxchatSettings: true },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}
// Consume the pushed settings entry so it cannot reappear on the next Back.
export const closeSettingsUrl = () => {
  if (settingsOpenFromUrl()) history.back()
}
export const verificationOpenFromUrl = () =>
  new URL(window.location.href).searchParams.get('verification') === 'true'
export const openVerificationUrl = () => {
  if (verificationOpenFromUrl()) return
  const url = new URL(window.location.href)
  url.searchParams.set('verification', 'true')
  history.pushState(
    { ...history.state, foxchatVerification: true },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}
export const closeVerificationUrl = () => {
  if (!verificationOpenFromUrl()) return
  if (history.state?.foxchatVerification) {
    history.back()
    return
  }
  const url = new URL(window.location.href)
  url.searchParams.delete('verification')
  history.replaceState(
    { ...history.state, foxchatVerification: undefined },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
}
export type SearchScope = 'room' | 'all'
export const searchOpenFromUrl = (): SearchScope | undefined => {
  const value = new URL(window.location.href).searchParams.get('search')
  return value === 'room' || value === 'all' ? value : undefined
}
export const openSearchUrl = (scope: SearchScope) => {
  const url = new URL(window.location.href)
  url.searchParams.set('search', scope)
  history.pushState(
    { ...history.state, foxchatSearch: scope },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
  window.dispatchEvent(new CustomEvent('foxchat-search-changed'))
}
// Consume the pushed search entry so it cannot reappear on the next Back.
export const closeSearchUrl = () => {
  if (searchOpenFromUrl()) history.back()
}
// Avoid racing history.back() with the room navigation that follows.
export const clearSearchUrl = () => {
  const url = new URL(window.location.href)
  url.searchParams.delete('search')
  history.replaceState(
    { ...history.state, foxchatSearch: undefined },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
  window.dispatchEvent(new CustomEvent('foxchat-search-changed'))
}
// "list" shows every thread in the current room; any other value is a thread root event id.
export const threadViewFromUrl = () =>
  new URL(window.location.href).searchParams.get('thread') ?? undefined
export const openThreadUrl = (value: string) => {
  const url = new URL(window.location.href)
  url.searchParams.set('thread', value)
  history.pushState(
    { ...history.state, foxchatThread: value },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
  window.dispatchEvent(new CustomEvent('foxchat-thread-changed'))
}
// Consume the pushed thread entry so it cannot reappear on the next Back.
export const closeThreadUrl = () => {
  if (threadViewFromUrl()) history.back()
}
export const roomDirectoryOpenFromUrl = () =>
  new URL(window.location.href).searchParams.get('directory') === 'true'
export const openRoomDirectoryUrl = () => {
  const url = new URL(window.location.href)
  url.searchParams.set('directory', 'true')
  history.pushState(
    { ...history.state, foxchatDirectory: true },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
  window.dispatchEvent(new CustomEvent('foxchat-directory-changed'))
}
// Consume the pushed directory entry so it cannot reappear on the next Back.
export const closeRoomDirectoryUrl = () => {
  if (roomDirectoryOpenFromUrl()) history.back()
}
// Avoid racing history.back() with navigation after joining a room.
export const clearRoomDirectoryUrl = () => {
  const url = new URL(window.location.href)
  url.searchParams.delete('directory')
  history.replaceState(
    { ...history.state, foxchatDirectory: undefined },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
  window.dispatchEvent(new CustomEvent('foxchat-directory-changed'))
}
export const emojiOpenFromUrl = () =>
  new URL(window.location.href).searchParams.get('emoji') === 'true'
export const openEmojiUrl = () => {
  if (emojiOpenFromUrl()) return
  const url = new URL(window.location.href)
  url.searchParams.set('emoji', 'true')
  history.pushState(
    { ...history.state, foxchatEmoji: true },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}
// Consume the pushed emoji entry so it cannot reappear on the next Back.
export const closeEmojiUrl = () => {
  if (emojiOpenFromUrl()) history.back()
}
export const messageMenuOpenFromUrl = () =>
  new URL(window.location.href).searchParams.get('messageMenu') === 'true'
export const openMessageMenuUrl = () => {
  if (messageMenuOpenFromUrl()) return
  const url = new URL(window.location.href)
  url.searchParams.set('messageMenu', 'true')
  history.pushState(
    { ...history.state, foxchatMessageMenu: true },
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}
// Consume the pushed message-menu entry so it cannot reappear on the next Back.
export const closeMessageMenuUrl = () => {
  if (messageMenuOpenFromUrl()) history.back()
}
export const roomIdFromUrl = () => {
  const value = new URL(window.location.href).searchParams.get('room')
  return value && value !== 'browse' && value !== 'unread' ? value : undefined
}
export const spaceIdFromUrl = () =>
  new URL(window.location.href).searchParams.get('space') ?? undefined
export const writeRoomUrl = (roomId: string | undefined, replace = false, spaceId?: string) => {
  const url = new URL(window.location.href)
  if (roomId) url.searchParams.set('room', roomId)
  else url.searchParams.delete('room')
  if (spaceId) url.searchParams.set('space', spaceId)
  else url.searchParams.delete('space')
  url.searchParams.delete('roomModal')
  const state = {
    ...history.state,
    foxchatRoom: roomId,
    foxchatSpace: spaceId,
    foxchatRoomModal: undefined,
  }
  history[replace ? 'replaceState' : 'pushState'](
    state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
  window.dispatchEvent(new CustomEvent('foxchat-room-navigated', { detail: { roomId, spaceId } }))
}
