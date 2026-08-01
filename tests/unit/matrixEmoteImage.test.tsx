// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MatrixEmoteImage } from '../../src/components/message/MatrixEmoteImage'
import { useMediaUrl } from '../../src/lib/hooks'

vi.mock('../../src/lib/hooks', () => ({ useMediaUrl: vi.fn() }))

const roots: Array<ReturnType<typeof createRoot>> = []
const originalIntersectionObserver = globalThis.IntersectionObserver

afterEach(() => {
  while (roots.length) act(() => roots.pop()?.unmount())
  vi.mocked(useMediaUrl).mockReset()
  globalThis.IntersectionObserver = originalIntersectionObserver
})

describe('MatrixEmoteImage', () => {
  it('defers picker media loading until the thumbnail nears the viewport', () => {
    let intersect: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined
    const disconnect = vi.fn()
    globalThis.IntersectionObserver = class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback as unknown as typeof intersect
      }
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = disconnect
      takeRecords = () => []
      root = null
      rootMargin = '160px'
      thresholds = [0]
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    roots.push(root)

    act(() => {
      root.render(
        <MatrixEmoteImage
          lazy
          emote={{ name: 'fox', body: 'Fox', url: 'mxc://example.org/fox' }}
        />,
      )
    })
    expect(vi.mocked(useMediaUrl).mock.calls.at(-1)?.[0]).toBeUndefined()

    act(() => intersect?.([{ isIntersecting: true }]))

    expect(vi.mocked(useMediaUrl).mock.calls.at(-1)?.[0]).toEqual({
      url: 'mxc://example.org/fox',
      info: undefined,
    })
    expect(disconnect).toHaveBeenCalled()
  })
})
