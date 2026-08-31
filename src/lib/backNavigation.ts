import { useEffect, useRef } from 'react'

type BackLayer = {
  id: symbol
  order: number
  close: () => void
}

type NavigationSnapshot = {
  url: string
  state: unknown
  index: number
}

const NAVIGATION_INDEX = 'foxchatNavigationIndex'

const backLayers = new Map<symbol, BackLayer>()
let nextBackLayerOrder = 0

export function registerBackLayer(close: () => void) {
  const id = Symbol('foxchat-back-layer')
  backLayers.set(id, { id, order: ++nextBackLayerOrder, close })
  return () => {
    backLayers.delete(id)
  }
}

export function closeTopBackLayer() {
  const layer = [...backLayers.values()].sort((first, second) => second.order - first.order)[0]
  if (!layer) return false
  layer.close()
  return true
}

export function useBackLayer(active: boolean, close: () => void, navigationKey?: unknown) {
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!active) return
    return registerBackLayer(() => closeRef.current())
  }, [active, navigationKey])
}

const visible = (element: HTMLElement) => {
  const style = getComputedStyle(element)
  return (
    !element.hidden &&
    element.getClientRects().length > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.pointerEvents !== 'none'
  )
}

const topmost = (elements: HTMLElement[]) =>
  elements
    .map((element, index) => ({
      element,
      index,
      zIndex: Number.parseInt(getComputedStyle(element).zIndex || '0', 10) || 0,
    }))
    .sort((first, second) => second.zIndex - first.zIndex || second.index - first.index)[0]?.element

const click = (element?: HTMLElement | null) => {
  if (!(element instanceof HTMLButtonElement) || element.disabled || !visible(element)) return false
  element.click()
  return true
}

const pressEscape = (target: EventTarget = window) => {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  )
}

/** Close the visually topmost library-managed overlay without walking browser history. */
export function closeTopVisualLayer() {
  const modal = topmost(
    [...document.querySelectorAll<HTMLElement>('.ant-modal-wrap')].filter(visible),
  )
  if (modal) {
    const closeButton = modal.querySelector<HTMLElement>('.ant-modal-close')
    const cancelButton = modal.querySelector<HTMLElement>(
      '.ant-modal-confirm-btns .ant-btn-default, .ant-modal-footer .ant-btn-default',
    )
    if (!click(closeButton)) click(cancelButton)
    // A non-dismissible busy dialog must still keep Back from affecting the layer beneath it.
    return true
  }

  const rightDrawer = topmost(
    [...document.querySelectorAll<HTMLElement>('.ant-drawer-right')].filter((drawer) => {
      if (!visible(drawer)) return false
      const closeButton = drawer.querySelector<HTMLElement>(
        '.ant-drawer-close, [data-foxchat-back-close="true"]',
      )
      const mask = drawer.querySelector<HTMLElement>('.ant-drawer-mask')
      return (!!closeButton && visible(closeButton)) || (!!mask && visible(mask))
    }),
  )
  if (rightDrawer) {
    const closeButton = rightDrawer.querySelector<HTMLElement>(
      '.ant-drawer-close, [data-foxchat-back-close="true"]',
    )
    const mask = rightDrawer.querySelector<HTMLElement>('.ant-drawer-mask')
    if (!click(closeButton)) {
      if (mask && visible(mask)) mask.click()
    }
    return true
  }

  const popup = topmost(
    [
      ...document.querySelectorAll<HTMLElement>(
        '.ant-dropdown, .ant-popover, [role="menu"], .md-code-fullscreen',
      ),
    ].filter(visible),
  )
  if (popup) {
    pressEscape(popup)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    return true
  }
  return false
}

export function leaveOpenSpaceDrawer() {
  const openSpaceDrawer = [
    ...document.querySelectorAll<HTMLElement>('[data-foxchat-space-drawer="true"]'),
  ].some(visible)
  if (!openSpaceDrawer) return false
  window.dispatchEvent(new CustomEvent('foxchat-main-drawer'))
  return true
}

const stateRecord = (state: unknown) =>
  typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : {}

const appNavigationTarget = (value: string) => {
  const url = new URL(value, window.location.href)
  return {
    pathname: url.pathname,
    hash: url.hash,
    room: url.searchParams.get('room'),
    space: url.searchParams.get('space'),
  }
}

const sameAppNavigationTarget = (first: string, second: string) => {
  const left = appNavigationTarget(first)
  const right = appNavigationTarget(second)
  return (
    left.pathname === right.pathname &&
    left.hash === right.hash &&
    left.room === right.room &&
    left.space === right.space
  )
}

/** Use the app navigator for browser/desktop Back while retaining nested dialog history entries. */
export function installHistoryBackHandler(handleBack: () => boolean) {
  const nativePushState = history.pushState
  const nativeReplaceState = history.replaceState
  const nativeBack = history.back
  let allowProgrammaticBack = false
  let programmaticBackTimer: number | undefined
  const initialState = stateRecord(history.state)
  const initialIndex = Number(initialState[NAVIGATION_INDEX]) || 0
  let current: NavigationSnapshot = {
    url: window.location.href,
    state: { ...initialState, [NAVIGATION_INDEX]: initialIndex },
    index: initialIndex,
  }
  nativeReplaceState.call(history, current.state, '', current.url)

  history.pushState = function (state, unused, url) {
    const index = current.index + 1
    nativePushState.call(this, { ...stateRecord(state), [NAVIGATION_INDEX]: index }, unused, url)
    current = { url: window.location.href, state: history.state, index }
  }
  history.replaceState = function (state, unused, url) {
    nativeReplaceState.call(
      this,
      { ...stateRecord(state), [NAVIGATION_INDEX]: current.index },
      unused,
      url,
    )
    current = { url: window.location.href, state: history.state, index: current.index }
  }
  history.back = function () {
    allowProgrammaticBack = true
    window.clearTimeout(programmaticBackTimer)
    programmaticBackTimer = window.setTimeout(() => {
      allowProgrammaticBack = false
    }, 1_000)
    nativeBack.call(this)
  }

  const navigated = (event: PopStateEvent) => {
    const arrivedState = stateRecord(event.state)
    const storedIndex = Number(arrivedState[NAVIGATION_INDEX])
    const arrived: NavigationSnapshot = {
      url: window.location.href,
      state: event.state,
      index: Number.isFinite(storedIndex) ? storedIndex : current.index - 1,
    }
    const backwards = arrived.index < current.index
    if (!backwards || allowProgrammaticBack) {
      allowProgrammaticBack = false
      window.clearTimeout(programmaticBackTimer)
      current = arrived
      return
    }

    // URL-backed overlays and drawers are real app-stack entries. Let the
    // browser land on their parent entry so every popstate consumer sees the
    // same state. Only room/Space changes are converted into the app's
    // room -> Space drawer -> main room list navigation hierarchy.
    if (sameAppNavigationTarget(current.url, arrived.url)) {
      current = arrived
      return
    }

    event.stopImmediatePropagation()
    nativePushState.call(history, current.state, '', current.url)
    handleBack()
    current = {
      url: window.location.href,
      state: history.state,
      index: Number(stateRecord(history.state)[NAVIGATION_INDEX]) || current.index,
    }
  }
  window.addEventListener('popstate', navigated)
  return () => {
    window.removeEventListener('popstate', navigated)
    window.clearTimeout(programmaticBackTimer)
    history.pushState = nativePushState
    history.replaceState = nativeReplaceState
    history.back = nativeBack
  }
}
