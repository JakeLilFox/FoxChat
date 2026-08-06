// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

const badgeMocks = vi.hoisted(() => {
  const closeImage = vi.fn(() => Promise.resolve())
  return {
    setBadgeCount: vi.fn(() => Promise.resolve()),
    setOverlayIcon: vi.fn(() => Promise.resolve()),
    closeImage,
    newImage: vi.fn(() => Promise.resolve({ rid: 1, close: closeImage })),
  }
})

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    setBadgeCount: badgeMocks.setBadgeCount,
    setOverlayIcon: badgeMocks.setOverlayIcon,
  }),
}))
vi.mock('@tauri-apps/api/image', () => ({ Image: { new: badgeMocks.newImage } }))

import {
  resetDesktopUnreadBadgeForTests,
  updateDesktopUnreadBadge,
} from '../../src/platform/desktopBadge'

describe('desktop unread badge', () => {
  afterEach(() => {
    resetDesktopUnreadBadgeForTests()
    badgeMocks.setBadgeCount.mockClear()
    badgeMocks.setOverlayIcon.mockClear()
    badgeMocks.closeImage.mockClear()
    badgeMocks.newImage.mockClear()
    delete window.__TAURI__
    vi.restoreAllMocks()
  })

  it('uses the native numeric badge API on supported desktop platforms', async () => {
    window.__TAURI__ = {}

    await updateDesktopUnreadBadge(7)
    await updateDesktopUnreadBadge(7)
    await updateDesktopUnreadBadge(0)

    expect(badgeMocks.setBadgeCount).toHaveBeenNthCalledWith(1, 7)
    expect(badgeMocks.setBadgeCount).toHaveBeenNthCalledWith(2, undefined)
  })

  it('renders the unread number as a Windows taskbar overlay icon', async () => {
    window.__TAURI__ = {}
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Windows NT 10.0')
    const context = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(32 * 32 * 4) })),
      stroke: vi.fn(),
    }
    const createElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = createElement(tagName, options)
      if (tagName === 'canvas')
        vi.spyOn(element as HTMLCanvasElement, 'getContext').mockReturnValue(
          context as unknown as CanvasRenderingContext2D,
        )
      return element
    })

    await updateDesktopUnreadBadge(12)

    expect(context.fillText).toHaveBeenCalledWith('12', 16, 17)
    expect(context.arc).toHaveBeenCalledWith(16, 16, 16, 0, Math.PI * 2)
    expect(context.stroke).not.toHaveBeenCalled()
    expect(badgeMocks.newImage).toHaveBeenCalledWith(expect.any(Uint8Array), 32, 32)
    expect(badgeMocks.setOverlayIcon).toHaveBeenCalledWith(expect.objectContaining({ rid: 1 }))
    expect(badgeMocks.closeImage).toHaveBeenCalledOnce()
  })

  it('re-applies the latest count after a slow update resolves late, instead of getting stuck', async () => {
    window.__TAURI__ = {}

    await updateDesktopUnreadBadge(1)
    badgeMocks.setBadgeCount.mockClear()

    let resolveFirst: () => void = () => {}
    badgeMocks.setBadgeCount.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveFirst = resolve)),
    )

    const first = updateDesktopUnreadBadge(5)
    const second = updateDesktopUnreadBadge(0)
    await second

    await vi.waitFor(() => expect(badgeMocks.setBadgeCount).toHaveBeenCalledWith(5))
    resolveFirst()
    await first

    const calls = badgeMocks.setBadgeCount.mock.calls.map(([value]) => value)
    expect(calls).toEqual([5, undefined])

    badgeMocks.setBadgeCount.mockClear()
    await updateDesktopUnreadBadge(0)
    expect(badgeMocks.setBadgeCount).not.toHaveBeenCalled()
    await updateDesktopUnreadBadge(3)
    expect(badgeMocks.setBadgeCount).toHaveBeenCalledWith(3)
  })
})
