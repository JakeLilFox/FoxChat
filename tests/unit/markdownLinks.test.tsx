// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownText } from '../../src/components/message/MarkdownText'

describe('Markdown links', () => {
  it('renders local-file links as text while retaining safe web links', () => {
    const html = renderToStaticMarkup(
      <MarkdownText text="[local file](file:///private/report.txt) [website](https://example.com)" />,
    )

    expect(html).toContain('local file')
    expect(html).not.toContain('file:///')
    expect(html).toContain('href="https://example.com"')
  })
})
