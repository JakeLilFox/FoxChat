// @vitest-environment jsdom

import type { Update } from '@tauri-apps/plugin-updater'
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const updateMocks = vi.hoisted(() => ({
  checkForDesktopUpdate: vi.fn(),
  desktopUpdateChecksEnabled: vi.fn(() => true),
  isDesktopUpdateSkipped: vi.fn(() => false),
  skipDesktopUpdate: vi.fn(),
}))

vi.mock('../../src/platform/desktopUpdates', () => updateMocks)

import { useDesktopUpdate } from '../../src/components/desktopUpdateContext'
import { DesktopUpdateProvider } from '../../src/components/DesktopUpdateProvider'

function AutoPopupProbe({ onOpen }: { onOpen: () => void }) {
  const { update, autoOpenPending, consumeAutoOpen } = useDesktopUpdate()

  useEffect(() => {
    if (!update || !autoOpenPending) return
    onOpen()
    consumeAutoOpen()
  }, [autoOpenPending, consumeAutoOpen, onOpen, update])

  return <span>{update?.version ?? 'none'}</span>
}

describe('desktop update provider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    updateMocks.checkForDesktopUpdate.mockReset()
    updateMocks.desktopUpdateChecksEnabled.mockReset()
    updateMocks.desktopUpdateChecksEnabled.mockReturnValue(true)
    updateMocks.isDesktopUpdateSkipped.mockClear()
    updateMocks.skipDesktopUpdate.mockClear()
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT
  })

  it('keeps the update alive and auto-opens its popup only once across drawer remounts', async () => {
    const close = vi.fn(() => Promise.resolve())
    const available = { version: '2.0.0', close } as unknown as Update
    updateMocks.checkForDesktopUpdate.mockResolvedValue({
      bundleType: 'nsis',
      update: available,
    })
    const onOpen = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)

    const render = (showIndicator: boolean) =>
      root.render(
        <DesktopUpdateProvider>
          {showIndicator && <AutoPopupProbe onOpen={onOpen} />}
        </DesktopUpdateProvider>,
      )

    await act(async () => render(true))
    await act(async () => {
      vi.advanceTimersByTime(5_000)
      await Promise.resolve()
    })

    expect(updateMocks.checkForDesktopUpdate).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledOnce()
    expect(container.textContent).toBe('2.0.0')
    expect(close).not.toHaveBeenCalled()

    await act(async () => render(false))
    await act(async () => render(true))

    expect(container.textContent).toBe('2.0.0')
    expect(updateMocks.checkForDesktopUpdate).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()

    await act(async () => root.unmount())
    expect(close).toHaveBeenCalledOnce()
  })

  it('checks once after startup and then every hour', async () => {
    updateMocks.checkForDesktopUpdate.mockResolvedValue({
      currentVersion: '1.0.0',
      update: null,
    })
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <DesktopUpdateProvider>
          <span>App</span>
        </DesktopUpdateProvider>,
      )
    })
    await act(async () => {
      vi.advanceTimersByTime(5_000)
      await Promise.resolve()
    })
    expect(updateMocks.checkForDesktopUpdate).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(60 * 60 * 1_000 - 5_000)
      await Promise.resolve()
    })
    expect(updateMocks.checkForDesktopUpdate).toHaveBeenCalledTimes(2)

    await act(async () => {
      vi.advanceTimersByTime(60 * 60 * 1_000)
      await Promise.resolve()
    })
    expect(updateMocks.checkForDesktopUpdate).toHaveBeenCalledTimes(3)

    await act(async () => root.unmount())
  })

  it('does not schedule update checks for a development build', async () => {
    updateMocks.desktopUpdateChecksEnabled.mockReturnValue(false)
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <DesktopUpdateProvider>
          <span>Development app</span>
        </DesktopUpdateProvider>,
      )
    })
    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 60 * 1_000)
      await Promise.resolve()
    })

    expect(updateMocks.checkForDesktopUpdate).not.toHaveBeenCalled()

    await act(async () => root.unmount())
  })
})
