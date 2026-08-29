// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  closeTopBackLayer,
  closeTopVisualLayer,
  installHistoryBackHandler,
  leaveOpenSpaceDrawer,
  registerBackLayer,
} from '../../src/lib/backNavigation'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
  document.body.replaceChildren()
})

describe('back navigation', () => {
  it('closes registered layers last-in-first-out and forgets layers closed with their own X', () => {
    const closed: string[] = []
    cleanups.push(registerBackLayer(() => closed.push('parent')))
    const removeChild = registerBackLayer(() => closed.push('child'))
    cleanups.push(removeChild)

    expect(closeTopBackLayer()).toBe(true)
    expect(closed).toEqual(['child'])

    removeChild()
    expect(closeTopBackLayer()).toBe(true)
    expect(closed).toEqual(['child', 'parent'])
  })

  it('closes the last modal in the DOM before the one beneath it', () => {
    const parentClose = vi.fn()
    const childClose = vi.fn()
    for (const close of [parentClose, childClose]) {
      const wrap = document.createElement('div')
      wrap.className = 'ant-modal-wrap'
      Object.defineProperty(wrap, 'getClientRects', { value: () => [{ width: 1, height: 1 }] })
      const button = document.createElement('button')
      button.className = 'ant-modal-close'
      Object.defineProperty(button, 'getClientRects', {
        value: () => [{ width: 1, height: 1 }],
      })
      button.addEventListener('click', close)
      wrap.append(button)
      document.body.append(wrap)
    }

    expect(closeTopVisualLayer()).toBe(true)
    expect(childClose).toHaveBeenCalledOnce()
    expect(parentClose).not.toHaveBeenCalled()
  })

  it('leaves a visible Space sidebar for the main drawer', () => {
    const drawer = document.createElement('aside')
    drawer.dataset.foxchatSpaceDrawer = 'true'
    Object.defineProperty(drawer, 'getClientRects', { value: () => [{ width: 1, height: 1 }] })
    document.body.append(drawer)
    const mainDrawer = vi.fn()
    window.addEventListener('foxchat-main-drawer', mainDrawer, { once: true })

    expect(leaveOpenSpaceDrawer()).toBe(true)
    expect(mainDrawer).toHaveBeenCalledOnce()
  })

  it('routes browser room-history Back through the app navigator', async () => {
    history.replaceState({}, '', '/?room=!one:example.org')
    const browserBack = history.back.bind(history)
    const back = vi.fn(() => true)
    cleanups.push(installHistoryBackHandler(back))
    history.pushState({}, '', '/?room=!two:example.org')

    browserBack()
    await vi.waitFor(() => expect(back).toHaveBeenCalledOnce())

    expect(new URL(window.location.href).searchParams.get('room')).toBe('!two:example.org')
  })

  it('allows browser Back to close a URL-backed submodal naturally', async () => {
    history.replaceState({}, '', '/?room=!two:example.org')
    const back = vi.fn(() => true)
    cleanups.push(installHistoryBackHandler(back))
    history.pushState({ foxchatSettings: true }, '', '/?room=!two:example.org&settings=true')

    history.back()
    await vi.waitFor(() =>
      expect(new URL(window.location.href).searchParams.has('settings')).toBe(false),
    )

    expect(back).not.toHaveBeenCalled()
  })
})
