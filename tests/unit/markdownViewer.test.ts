// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MarkdownText } from '../../src/components/message/MarkdownText'

const roots: Array<ReturnType<typeof createRoot>> = []

beforeAll(() => {
  ;(
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean
    }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.replaceChildren()
})

describe('Markdown JSON viewer rendering', () => {
  it('mounts the interactive viewer for malformed four-tick fences', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    const source = 'sync payload ````JSON\n\n{"next_batch":"417575","rooms":{"join":{}}}```'

    await act(async () => {
      root.render(createElement(MarkdownText, { text: source }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.innerHTML).toContain('data-json-viewer-index')
    const viewer = container.querySelector('[data-testid="json-viewer"]')
    expect(viewer).not.toBeNull()
    expect(viewer?.textContent).toContain('next_batch')
    expect(container.textContent).not.toContain('````JSON')
  })
})
