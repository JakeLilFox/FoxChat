import { forwardRef, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { marked, type Token } from 'marked'
import { CloseOutlined, CopyOutlined } from '@ant-design/icons'
import { highlightCode } from '../../lib/codeHighlight'
import { openRoomReference, roomReferenceFromHref } from '../../lib/messageText'
import { preprocessMarkdown } from '../../lib/markdownPreprocess'
import { JsonFilePreview } from './JsonFilePreview'
import {
  formatTimestamp,
  timestampDate,
  timestampFromHref,
  timestampTitle,
} from '../../lib/timestamps'

const safeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const copyIcon =
  '<svg width="14" height="14" viewBox="64 64 896 896" fill="currentColor" focusable="false" aria-hidden="true"><path d="M768 832H216V280h264v-72H216c-39.8 0-72 32.2-72 72v552c0 39.8 32.2 72 72 72h552c39.8 0 72-32.2 72-72V568h-72v264zM456 120v448h448V120H456zm376 376H528V192h304v304z"/></svg>'
const fullscreenIcon =
  '<svg width="14" height="14" viewBox="64 64 896 896" fill="currentColor" focusable="false" aria-hidden="true"><path d="M333 149H149v184h72V221h112v-72zm470 184h72V149H691v72h112v112zM221 691h-72v184h184v-72H221V691zm654 0h-72v112H691v72h184V691z"/></svg>'
const checkIcon =
  '<svg width="14" height="14" viewBox="64 64 896 896" fill="currentColor" focusable="false" aria-hidden="true"><path d="M438.6 704.1L220.5 486a8 8 0 00-11.3 0l-56.6 56.6a8 8 0 000 11.3l280.3 280.3a8 8 0 0011.3 0l427-427a8 8 0 000-11.3l-56.6-56.6a8 8 0 00-11.3 0L438.6 704.1z"/></svg>'
const codeBlockStyle =
  'display:block;box-sizing:border-box;width:min(560px,calc(100vw - 150px));max-width:100%;min-width:0;margin:8px 0;overflow:hidden;border:1px solid var(--foxchat-code-border,rgba(127,127,127,.35));border-radius:10px;background:var(--foxchat-code-bg,#222631);box-shadow:0 5px 18px rgba(0,0,0,.16);text-align:left'
const codeToolbarStyle =
  'box-sizing:border-box;height:36px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 8px 0 12px;border-bottom:1px solid var(--foxchat-code-border,rgba(127,127,127,.35));background:var(--foxchat-code-toolbar-bg,#191c25);color:var(--foxchat-code-muted,#9299aa);font:700 10px/1 system-ui,sans-serif;text-transform:uppercase;letter-spacing:.05em'
const codeActionsStyle = 'display:flex;align-items:center;gap:2px'
const codeButtonStyle =
  'width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:6px;padding:0;background:transparent;color:inherit;cursor:pointer'
const codePreStyle =
  'box-sizing:border-box;width:100%;max-width:100%;height:min(300px,38dvh);min-height:90px;margin:0;padding:14px 16px;overflow:auto;overscroll-behavior:contain;background:var(--foxchat-code-bg,#222631);color:var(--foxchat-code-text,#eef0f6);font:12px/1.5 Fira Code,Cascadia Code,Consolas,monospace;tab-size:2;text-align:left'
const codeStyle =
  'display:block;box-sizing:border-box;width:max-content;min-width:100%;min-height:100%;margin:0;padding:0;background:transparent;color:inherit;white-space:pre;overflow-wrap:normal;word-break:normal'

const MarkdownHtml = memo(
  forwardRef<HTMLDivElement, { html: string }>(function MarkdownHtml({ html }, ref) {
    return <div ref={ref} className="md-content" dangerouslySetInnerHTML={{ __html: html }} />
  }),
)

function FullscreenCode({
  code,
  language,
  onClose,
}: {
  code: string
  language: string
  onClose: () => void
}) {
  const highlighted = useMemo(() => highlightCode(code, language), [code, language])
  const label = highlighted.jsonViewer ? 'JSON viewer' : highlighted.label
  return createPortal(
    <div
      className="md-code-fullscreen"
      role="dialog"
      aria-modal="true"
      aria-label={`${label} code`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        display: 'grid',
        placeItems: 'center',
        padding: 'clamp(8px,3vw,36px)',
        background: 'rgba(4,6,11,.92)',
        backdropFilter: 'blur(8px)',
        color: '#eef0f6',
      }}
    >
      <div
        className={`md-code-fullscreen-panel${highlighted.jsonViewer ? ' md-json-viewer' : ''}`}
        onClick={(event) => event.stopPropagation()}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          height: '100%',
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid var(--foxchat-code-border,rgba(127,127,127,.35))',
          borderRadius: 14,
          background: 'var(--foxchat-code-bg,#222631)',
          boxShadow: '0 24px 80px rgba(0,0,0,.55)',
        }}
      >
        <div
          className="md-code-fullscreen-head"
          style={{
            boxSizing: 'border-box',
            height: 48,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '0 12px 0 16px',
            borderBottom: '1px solid var(--foxchat-code-border,rgba(127,127,127,.35))',
            background: 'var(--foxchat-code-toolbar-bg,#191c25)',
            color: 'var(--foxchat-code-muted,#9299aa)',
            font: '700 12px/1 system-ui,sans-serif',
            textTransform: 'uppercase',
          }}
        >
          <span>{label}</span>
          <span style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              aria-label="Copy code"
              title="Copy code"
              onClick={() => void navigator.clipboard.writeText(highlighted.code)}
              style={{
                width: 32,
                height: 32,
                display: 'grid',
                placeItems: 'center',
                border: 0,
                borderRadius: 7,
                padding: 0,
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              }}
            >
              <CopyOutlined />
            </button>
            <button
              type="button"
              aria-label="Exit fullscreen"
              title="Exit fullscreen"
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                display: 'grid',
                placeItems: 'center',
                border: 0,
                borderRadius: 7,
                padding: 0,
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              }}
            >
              <CloseOutlined />
            </button>
          </span>
        </div>
        <pre
          style={{
            boxSizing: 'border-box',
            flex: 1,
            width: '100%',
            minWidth: 0,
            minHeight: 0,
            margin: 0,
            padding: 20,
            overflow: 'scroll',
            overscrollBehavior: 'contain',
            background: 'var(--foxchat-code-bg,#222631)',
            color: 'var(--foxchat-code-text,#eef0f6)',
            font: '13px/1.55 Fira Code,Cascadia Code,Consolas,monospace',
            textAlign: 'left',
            tabSize: 2,
          }}
        >
          <code
            className={`hljs language-${highlighted.language}`}
            style={{
              display: 'block',
              boxSizing: 'border-box',
              width: 'max-content',
              minWidth: '100%',
              minHeight: '100%',
              margin: 0,
              padding: 0,
              background: 'transparent',
              color: 'inherit',
              whiteSpace: 'pre',
              overflowWrap: 'normal',
              wordBreak: 'normal',
            }}
            dangerouslySetInnerHTML={{ __html: highlighted.html }}
          />
        </pre>
      </div>
    </div>,
    document.body,
  )
}

export const MarkdownText = memo(function MarkdownText({ text }: { text: string }) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState<{ code: string; language: string }>()
  const [jsonHosts, setJsonHosts] = useState<
    Array<{ element: HTMLElement; source: string; index: number }>
  >([])
  const rendered = useMemo(() => {
    const processed = preprocessMarkdown(text)
    const jsonBlocks: string[] = []

    const renderer = new (marked.Renderer as any)()

    renderer.link = function (token: Token, _children: string) {
      const href = (token as any).href as string | undefined
      const text = (token as any).text as string | undefined
      if (href && href.startsWith('foxchat://mention/')) {
        return `<span class="md-mention">${safeHtml(text ?? href)}</span>`
      }
      if (href && href.startsWith('foxchat://room/')) {
        const target = roomReferenceFromHref(href)
        return target
          ? `<span class="md-room-mention" data-room-target="${safeHtml(target)}" tabindex="0" role="button" aria-label="Open room ${safeHtml(target)}">${safeHtml(text ?? target)}</span>`
          : `<span class="md-room-mention">${safeHtml(text ?? href)}</span>`
      }
      if (href && href.startsWith('foxchat://spoiler/')) {
        return `<span class="md-spoiler" data-spoiler tabindex="0" role="button" aria-label="Spoiler, click to reveal">${safeHtml(text ?? href)}</span>`
      }
      const timestamp = href ? timestampFromHref(href) : undefined
      if (timestamp) {
        const date = timestampDate(timestamp.seconds)!
        return `<time class="foxchat-timestamp" datetime="${date.toISOString()}" title="${safeHtml(timestampTitle(timestamp.seconds))}" data-timestamp-seconds="${timestamp.seconds}" data-timestamp-style="${timestamp.style}">${safeHtml(formatTimestamp(timestamp.seconds, timestamp.style))}</time>`
      }
      const safeHref = safeHtml(href ?? '')
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="color:#ff8a3d!important">${safeHtml(text ?? '')}</a>`
    }

    renderer.code = function (token: Token) {
      const code = String((token as Token & { text?: string }).text ?? '')
      const requestedLanguage = String((token as Token & { lang?: string }).lang ?? '')
        .trim()
        .split(/\s+/)[0]
      const highlighted = highlightCode(code, requestedLanguage)
      if (highlighted.jsonViewer) {
        const index = jsonBlocks.push(highlighted.code) - 1
        return `<span class="md-json-viewer-host" data-json-viewer-index="${index}"></span>`
      }
      const viewerClass = highlighted.jsonViewer ? ' md-json-viewer' : ''
      const label = highlighted.jsonViewer ? 'JSON viewer' : highlighted.label
      return `<div class="md-code-block${viewerClass}" data-code-language="${highlighted.language}" style="${codeBlockStyle}"><div class="md-code-toolbar" style="${codeToolbarStyle}"><span>${safeHtml(label)}</span><span class="md-code-actions" style="${codeActionsStyle}"><button style="${codeButtonStyle}" type="button" data-code-action="copy" aria-label="Copy code" title="Copy code">${copyIcon}</button><button style="${codeButtonStyle}" type="button" data-code-action="fullscreen" aria-label="View code fullscreen" title="Fullscreen">${fullscreenIcon}</button></span></div><pre style="${codePreStyle}"><code style="${codeStyle}" class="hljs language-${highlighted.language}">${highlighted.html}</code></pre></div>`
    }

    const raw = marked.parse(processed, {
      breaks: true,
      gfm: true,
      renderer,
    })
    return {
      html: typeof raw === 'string' ? raw : String(raw),
      jsonBlocks,
    }
  }, [text])
  const html = rendered.html

  useLayoutEffect(() => {
    const root = contentRef.current
    if (!root) return
    setJsonHosts(
      rendered.jsonBlocks.flatMap((source, index) => {
        const element = root.querySelector<HTMLElement>(`[data-json-viewer-index="${index}"]`)
        return element ? [{ element, source, index }] : []
      }),
    )
  }, [rendered])

  useEffect(() => {
    const root = contentRef.current
    if (!root) return
    const updateTimestamps = () => {
      for (const element of root.querySelectorAll<HTMLElement>('[data-timestamp-seconds]')) {
        const seconds = Number(element.dataset.timestampSeconds)
        const style = element.dataset.timestampStyle
        if (
          !Number.isSafeInteger(seconds) ||
          !style ||
          !['d', 'D', 't', 'T', 'f', 'F', 's', 'S', 'R'].includes(style)
        )
          continue
        element.textContent = formatTimestamp(
          seconds,
          style as Parameters<typeof formatTimestamp>[1],
        )
      }
    }
    updateTimestamps()
    const timestampTimer = root.querySelector('[data-timestamp-style="R"]')
      ? window.setInterval(updateTimestamps, 30_000)
      : undefined
    for (const pre of root.querySelectorAll('pre')) {
      if (pre.parentElement?.classList.contains('md-code-block')) continue
      const code = pre.querySelector('code')
      const language =
        [...(code?.classList ?? [])].find((name) => name.startsWith('language-'))?.slice(9) ||
        'code'
      const block = document.createElement('div')
      block.className = 'md-code-block'
      const toolbar = document.createElement('div')
      toolbar.className = 'md-code-toolbar'
      toolbar.innerHTML = `<span>${safeHtml(language)}</span><span class="md-code-actions"><button type="button" data-code-action="copy" aria-label="Copy code" title="Copy code">${copyIcon}</button><button type="button" data-code-action="fullscreen" aria-label="View code fullscreen" title="Fullscreen">${fullscreenIcon}</button></span>`
      block.dataset.codeLanguage = language
      pre.parentNode?.insertBefore(block, pre)
      block.append(toolbar, pre)
    }
    const click = async (event: MouseEvent) => {
      const spoiler = (event.target as HTMLElement).closest<HTMLElement>('.md-spoiler')
      if (spoiler && root.contains(spoiler)) {
        spoiler.classList.toggle('revealed')
        return
      }
      const roomMention = (event.target as HTMLElement).closest<HTMLElement>('.md-room-mention')
      if (roomMention && root.contains(roomMention)) {
        const target = roomMention.dataset.roomTarget
        if (target) openRoomReference(target)
        return
      }
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-code-action]')
      if (!button || !root.contains(button)) return
      event.preventDefault()
      event.stopPropagation()
      const block = button.closest('.md-code-block')
      const code = block?.querySelector('code')?.textContent ?? ''
      const language =
        (block as HTMLElement | null)?.dataset.codeLanguage ??
        block?.querySelector('.md-code-toolbar > span')?.textContent ??
        'code'
      if (button.dataset.codeAction === 'fullscreen') setFullscreen({ code, language })
      else {
        try {
          await navigator.clipboard.writeText(code)
          const previous = button.innerHTML
          button.innerHTML = checkIcon
          button.title = 'Copied'
          window.setTimeout(() => {
            if (button.isConnected) {
              button.innerHTML = previous
              button.title = 'Copy code'
            }
          }, 1200)
        } catch {
          button.title = 'Copy failed'
        }
      }
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const spoiler = (event.target as HTMLElement).closest<HTMLElement>('.md-spoiler')
      if (spoiler && root.contains(spoiler)) {
        event.preventDefault()
        spoiler.classList.toggle('revealed')
        return
      }
      const roomMention = (event.target as HTMLElement).closest<HTMLElement>('.md-room-mention')
      if (!roomMention || !root.contains(roomMention)) return
      const target = roomMention.dataset.roomTarget
      if (!target) return
      event.preventDefault()
      openRoomReference(target)
    }
    root.addEventListener('click', click)
    root.addEventListener('keydown', keydown)
    return () => {
      if (timestampTimer) window.clearInterval(timestampTimer)
      root.removeEventListener('click', click)
      root.removeEventListener('keydown', keydown)
    }
  }, [html])

  useEffect(() => {
    if (!fullscreen) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(undefined)
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [fullscreen])

  return (
    <>
      <MarkdownHtml ref={contentRef} html={html} />
      {jsonHosts.map(({ element, source, index }) =>
        createPortal(<JsonFilePreview filename="JSON" source={source} />, element, `json-${index}`),
      )}
      {fullscreen && (
        <FullscreenCode
          code={fullscreen.code}
          language={fullscreen.language}
          onClose={() => setFullscreen(undefined)}
        />
      )}
    </>
  )
})
