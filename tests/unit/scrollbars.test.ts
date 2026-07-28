// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACTIVE_SCROLLBAR_CLASS, trackActiveScrollbars } from '../../src/lib/scrollbars'

describe('trackActiveScrollbars', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('shows a scrollbar while its element is scrolling, then hides it after inactivity', () => {
    vi.useFakeTimers()
    const scroller = document.createElement('div')
    document.body.append(scroller)
    const stop = trackActiveScrollbars(document)

    scroller.dispatchEvent(new Event('scroll'))
    expect(scroller.classList.contains(ACTIVE_SCROLLBAR_CLASS)).toBe(true)

    vi.advanceTimersByTime(699)
    expect(scroller.classList.contains(ACTIVE_SCROLLBAR_CLASS)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(scroller.classList.contains(ACTIVE_SCROLLBAR_CLASS)).toBe(false)
    stop()
  })

  it('cleans up active scrollbar state', () => {
    vi.useFakeTimers()
    const scroller = document.createElement('div')
    document.body.append(scroller)
    const stop = trackActiveScrollbars(document)

    scroller.dispatchEvent(new Event('scroll'))
    stop()

    expect(scroller.classList.contains(ACTIVE_SCROLLBAR_CLASS)).toBe(false)
  })
})
