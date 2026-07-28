// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { isExternalUrl, listenForDesktopExternalLinks } from '../../src/platform/externalLinks'

describe('desktop external links', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete window.__TAURI_INTERNALS__
    document.body.replaceChildren()
  })

  it('allows browser and handler URL schemes but rejects unsafe navigation', () => {
    expect(isExternalUrl('https://example.com/path')).toBe(true)
    expect(isExternalUrl('http://example.com/path')).toBe(true)
    expect(isExternalUrl('mailto:hello@example.com')).toBe(true)
    expect(isExternalUrl('tel:+491234567')).toBe(true)
    expect(isExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isExternalUrl('/settings')).toBe(false)
  })

  it('does not intercept links in the web client', () => {
    const stop = listenForDesktopExternalLinks()
    const link = document.createElement('a')
    link.href = 'https://example.com/web'
    document.body.append(link)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    let intercepted = false
    document.addEventListener(
      'click',
      (event) => {
        intercepted = event.defaultPrevented
        event.preventDefault()
      },
      { once: true },
    )

    link.dispatchEvent(click)

    expect(intercepted).toBe(false)
    stop()
  })

  it('opens external links with the native desktop URL handler', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    window.__TAURI_INTERNALS__ = { invoke }
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('FoxChat Windows')
    const stop = listenForDesktopExternalLinks()
    const link = document.createElement('a')
    link.href = 'https://example.com/desktop'
    document.body.append(link)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })

    link.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled())
    expect(invoke.mock.calls[0]?.[0]).toBe('plugin:opener|open_url')
    expect(invoke.mock.calls[0]?.[1]).toEqual({
      url: 'https://example.com/desktop',
      with: undefined,
    })
    stop()
  })

  it('leaves attachment downloads inside FoxChat', () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    window.__TAURI_INTERNALS__ = { invoke }
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('FoxChat Windows')
    const stop = listenForDesktopExternalLinks()
    const link = document.createElement('a')
    link.href = 'https://example.com/file.json'
    link.download = 'file.json'
    document.body.append(link)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    let intercepted = false
    document.addEventListener(
      'click',
      (event) => {
        intercepted = event.defaultPrevented
        event.preventDefault()
      },
      { once: true },
    )

    link.dispatchEvent(click)

    expect(intercepted).toBe(false)
    expect(invoke).not.toHaveBeenCalled()
    stop()
  })
})
