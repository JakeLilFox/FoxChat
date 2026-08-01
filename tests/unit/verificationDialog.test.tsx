// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  VerificationPhase,
  VerificationRequestEvent,
  type ShowSasCallbacks,
  type VerificationRequest,
  type Verifier,
} from 'matrix-js-sdk/lib/crypto-api'

const message = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock('antd', () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Modal: ({ children, title }: { children?: ReactNode; title?: ReactNode }) => (
    <div role="dialog" aria-label={String(title)}>
      {children}
    </div>
  ),
  App: { useApp: () => ({ message }) },
}))
vi.mock('@ant-design/icons', () => ({ CheckOutlined: () => <span /> }))

import { VerificationDialog } from '../../src/components/VerificationDialog'

const roots: Array<ReturnType<typeof createRoot>> = []

afterEach(() => {
  while (roots.length) act(() => roots.pop()?.unmount())
  document.body.replaceChildren()
})

describe('VerificationDialog', () => {
  it('starts SAS when an accepted request becomes Ready after accept resolves', async () => {
    let phase = VerificationPhase.Requested
    let change: (() => void) | undefined
    const verifier = {
      getShowSasCallbacks: vi.fn(() => null),
      on: vi.fn(),
      off: vi.fn(),
      verify: vi.fn(() => Promise.resolve()),
    } as unknown as Verifier
    const accept = vi.fn(() => Promise.resolve())
    const startVerification = vi.fn(() => Promise.resolve(verifier))
    const request = {
      get verifier() {
        return undefined
      },
      get phase() {
        return phase
      },
      initiatedByMe: false,
      pending: true,
      accept,
      startVerification,
      on: vi.fn((event: VerificationRequestEvent, listener: () => void) => {
        if (event === VerificationRequestEvent.Change) change = listener
      }),
      off: vi.fn(),
    } as unknown as VerificationRequest
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<VerificationDialog request={request} onClose={vi.fn()} />)
    })
    const acceptButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Accept verification request'),
    )
    expect(acceptButton).toBeDefined()

    await act(async () => acceptButton!.click())
    expect(accept).toHaveBeenCalledOnce()
    expect(startVerification).not.toHaveBeenCalled()

    phase = VerificationPhase.Ready
    await act(async () => change?.())

    expect(startVerification).toHaveBeenCalledOnce()
    expect(startVerification).toHaveBeenCalledWith('m.sas.v1')
    expect(verifier.verify).toHaveBeenCalledOnce()
  })

  it('renders SAS emoji retained by a verifier whose ShowSas event already fired', async () => {
    const callbacks: ShowSasCallbacks = {
      sas: {
        emoji: [
          ['1', 'Dog'],
          ['2', 'Cat'],
          ['3', 'Lion'],
          ['4', 'Horse'],
          ['5', 'Unicorn'],
          ['6', 'Pig'],
          ['7', 'Elephant'],
        ],
      },
      confirm: vi.fn(() => Promise.resolve()),
      mismatch: vi.fn(),
      cancel: vi.fn(),
    }
    const verifier = {
      getShowSasCallbacks: vi.fn(() => callbacks),
      on: vi.fn(),
      off: vi.fn(),
      verify: vi.fn(() => Promise.resolve()),
    } as unknown as Verifier
    const request = {
      verifier,
      phase: VerificationPhase.Started,
      initiatedByMe: false,
      pending: true,
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as VerificationRequest
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<VerificationDialog request={request} onClose={vi.fn()} />)
    })

    expect(
      [...document.querySelectorAll('[data-testid="verification-sas-label"]')].map(
        (element) => element.textContent,
      ),
    ).toEqual(['Dog', 'Cat', 'Lion', 'Horse', 'Unicorn', 'Pig', 'Elephant'])
    expect(document.body.textContent).toContain('They match')
    expect(verifier.verify).toHaveBeenCalledOnce()
  })
})
