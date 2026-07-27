import { InlineMatrixEmote } from './InlineMatrixEmote'
import { formattedTags, matrixUserIdFromHref } from '../../lib/messageText'
import { showUserProfile } from '../../lib/userProfile'
import { createElement, Fragment, useMemo, useState, type JSX, type ReactNode } from 'react'
import { MarkdownText } from './MarkdownText'

function SpoilerSpan({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <span
      className={`md-spoiler${revealed ? ' revealed' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="Spoiler, click to reveal"
      onClick={() => setRevealed(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          setRevealed(true)
        }
      }}
    >
      {children}
    </span>
  )
}

export function MatrixMessageText({
  content,
  body,
}: {
  content: Record<string, any>
  body: string
}) {
  const nodes = useMemo(() => {
    if (content.format !== 'org.matrix.custom.html' || typeof content.formatted_body !== 'string')
      return null
    const parsed = new DOMParser().parseFromString(content.formatted_body, 'text/html')
    let key = 0
    const read = (node: Node): ReactNode => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent
      if (!(node instanceof HTMLElement)) return null
      if (node.tagName === 'MX-REPLY') return null
      const children = [...node.childNodes].map(read)
      if (node.tagName === 'IMG' && node.hasAttribute('data-mx-emoticon')) {
        const src = node.getAttribute('src') || ''
        const alt = node.getAttribute('alt') || node.getAttribute('title') || body
        return src.startsWith('mxc://') ? (
          <InlineMatrixEmote
            key={key++}
            src={src}
            alt={alt}
            title={node.getAttribute('title') || undefined}
          />
        ) : (
          alt
        )
      }
      if (node.tagName === 'SPAN' && node.hasAttribute('data-mx-spoiler'))
        return <SpoilerSpan key={key++}>{children}</SpoilerSpan>
      if (!formattedTags.has(node.tagName)) return <Fragment key={key++}>{children}</Fragment>
      if (node.tagName === 'BR') return <br key={key++} />
      if (node.tagName === 'HR') return <hr key={key++} />
      const tag = node.tagName.toLowerCase() as keyof JSX.IntrinsicElements
      if (tag === 'a') {
        const href = node.getAttribute('href') || ''
        const mentionedUser = matrixUserIdFromHref(href)
        if (mentionedUser)
          return (
            <a
              key={key++}
              href={href}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                showUserProfile(
                  mentionedUser,
                  event.currentTarget,
                  node.textContent || mentionedUser,
                )
              }}
            >
              {children}
            </a>
          )
        const safe = /^(https?:|mailto:)/i.test(href) ? href : undefined
        return safe ? (
          <a
            key={key++}
            href={safe}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#ff8a3d' }}
          >
            {children}
          </a>
        ) : (
          <Fragment key={key++}>{children}</Fragment>
        )
      }
      return createElement(tag, { key: key++ }, children)
    }
    return [...parsed.body.childNodes].map(read)
  }, [content.format, content.formatted_body, body])
  return body.includes('```') ? (
    <MarkdownText text={body} />
  ) : nodes ? (
    <span className="md-content matrix-formatted-message">{nodes}</span>
  ) : (
    <MarkdownText text={body} />
  )
}
