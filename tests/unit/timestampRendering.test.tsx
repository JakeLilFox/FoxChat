// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownText } from '../../src/components/message/MarkdownText'
import { MatrixMessageText } from '../../src/components/message/MatrixMessageText'

describe('timestamp message rendering', () => {
  it('renders plain message syntax as a local time element', () => {
    const html = renderToStaticMarkup(<MarkdownText text="Meet <t:1785142440:F>" />)

    expect(html).toContain('class="foxchat-timestamp"')
    expect(html).toContain('data-timestamp-seconds="1785142440"')
    expect(html).not.toContain('&lt;t:1785142440:F&gt;</p>')
  })

  it('keeps timestamp syntax literal inside inline code', () => {
    const html = renderToStaticMarkup(<MarkdownText text="Use `<t:1785142440:F>`" />)

    expect(html).toContain('<code>&lt;t:1785142440:F&gt;</code>')
    expect(html).not.toContain('class="foxchat-timestamp"')
  })

  it('finds timestamp syntax in Matrix formatted text but not code', () => {
    const html = renderToStaticMarkup(
      <MatrixMessageText
        body="Meet <t:1785142440:R> and use `<t:1785142440:F>`"
        content={{
          format: 'org.matrix.custom.html',
          formatted_body: 'Meet &lt;t:1785142440:R&gt; and use <code>&lt;t:1785142440:F&gt;</code>',
        }}
      />,
    )

    expect(html.match(/class="foxchat-timestamp"/g)).toHaveLength(1)
    expect(html).toContain('<code>&lt;t:1785142440:F&gt;</code>')
  })

  it('preserves text after an unescaped tag in Matrix formatted HTML', () => {
    const html = renderToStaticMarkup(
      <MatrixMessageText
        body="Meet <t:1785142440:F> in the lobby"
        content={{
          format: 'org.matrix.custom.html',
          formatted_body: 'Meet <t:1785142440:F> in the lobby',
        }}
      />,
    )

    expect(html).toContain('class="foxchat-timestamp"')
    expect(html).toContain(' in the lobby')
  })
})
