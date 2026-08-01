import { type MatrixEmote } from '../../lib/emojiData'
import { RichComposerInput } from '../../styles'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { matrixService } from '../../matrix/MatrixClientService'

const serializeComposer = (root: HTMLElement) => {
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (!(node instanceof HTMLElement)) return ''
    if (node.dataset.token) return node.dataset.token
    if (node.tagName === 'BR') return '\n'
    const text = [...node.childNodes].map(read).join('')
    return node.tagName === 'DIV' || node.tagName === 'P' ? `${text}\n` : text
  }
  return [...root.childNodes].map(read).join('').replace(/\n$/, '')
}
const loadComposerEmoteUrl = async (emote: MatrixEmote) => {
  const client = emote.client ?? matrixService.clientForMedia(emote.url)
  const candidates = [
    {
      url: client?.mxcUrlToHttp(emote.url, undefined, undefined, undefined, false, true, true),
      token: client?.getAccessToken(),
    },
    { url: client?.mxcUrlToHttp(emote.url), token: undefined },
  ]
  for (const candidate of candidates) {
    if (!candidate.url) continue
    try {
      const response = await fetch(candidate.url, {
        headers: candidate.token ? { Authorization: `Bearer ${candidate.token}` } : {},
      })
      if (response.ok) return URL.createObjectURL(await response.blob())
    } catch {
      /* Try the legacy endpoint. */
    }
  }
}
export function MessageComposerInput({
  value,
  emotes,
  placeholder,
  onChange,
  onKeyDown,
  onDropFiles,
}: {
  value: string
  emotes: Map<string, MatrixEmote>
  placeholder: string
  onChange: (value: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  onDropFiles: (files: File[]) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const mediaUrls = useRef<string[]>([])
  const generation = useRef(0)
  useEffect(() => () => mediaUrls.current.forEach(URL.revokeObjectURL), [])
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const tokens = [...emotes.keys()].sort((a, b) => b.length - a.length)
    const hasUntokenizedEmote = tokens.some((token) => root.textContent?.includes(token))
    if (serializeComposer(root) === value && !hasUntokenizedEmote) return
    const active = document.activeElement === root
    const currentGeneration = ++generation.current
    mediaUrls.current.forEach(URL.revokeObjectURL)
    mediaUrls.current = []
    root.replaceChildren()
    const pattern = tokens.length
      ? new RegExp(
          tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
          'g',
        )
      : undefined
    let cursor = 0
    for (const match of pattern ? value.matchAll(pattern) : []) {
      const index = match.index ?? cursor
      const before = value.slice(cursor, index)
      if (before) root.append(document.createTextNode(before))
      const emote = emotes.get(match[0])
      if (emote) {
        const atom = document.createElement('span')
        atom.className = 'composerEmote'
        atom.contentEditable = 'false'
        atom.dataset.token = match[0]
        atom.title = emote.body
        const image = document.createElement('img')
        image.alt = emote.body
        void loadComposerEmoteUrl(emote).then((url) => {
          if (!url) return
          if (generation.current !== currentGeneration) {
            URL.revokeObjectURL(url)
            return
          }
          mediaUrls.current.push(url)
          image.src = url
        })
        atom.append(image)
        root.append(atom)
      }
      cursor = index + match[0].length
    }
    const after = value.slice(cursor)
    if (after) root.append(document.createTextNode(after))
    if (active || value.length) {
      root.focus({ preventScroll: true })
      const selection = getSelection()
      const range = document.createRange()
      range.selectNodeContents(root)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
  }, [value, emotes])
  const changed = () => {
    if (ref.current) onChange(serializeComposer(ref.current))
  }
  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const selection = getSelection()
    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      selection?.isCollapsed &&
      selection.anchorNode
    ) {
      const container = selection.anchorNode
      const offset = selection.anchorOffset
      const node =
        container.nodeType === Node.TEXT_NODE
          ? event.key === 'Backspace' && offset === 0
            ? container.previousSibling
            : event.key === 'Delete' && offset === (container.textContent?.length ?? 0)
              ? container.nextSibling
              : null
          : event.key === 'Backspace'
            ? container.childNodes[offset - 1]
            : container.childNodes[offset]
      if (node instanceof HTMLElement && node.classList.contains('composerEmote')) {
        event.preventDefault()
        node.remove()
        changed()
        return
      }
    }
    onKeyDown(event)
  }
  return (
    <RichComposerInput
      ref={ref}
      data-testid="message-composer"
      role="textbox"
      aria-multiline="true"
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={changed}
      onKeyDown={keyDown}
      onPointerDown={(event) => {
        // Refocus on touch so Android can reopen a dismissed keyboard.
        if (
          event.pointerType === 'touch' &&
          document.activeElement === ref.current &&
          !document.documentElement.classList.contains('foxchat-ime-open')
        ) {
          ref.current?.blur()
          requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }))
        }
      }}
      onPaste={(event) => {
        if ([...(event.clipboardData.items ?? [])].some((item) => item.kind === 'file')) return
        event.preventDefault()
        document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
      }}
      onDragOver={(event) => {
        // Prevent contenteditable from inserting dropped files inline.
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        const files = [...event.dataTransfer.files]
        if (files.length) onDropFiles(files)
      }}
    />
  )
}
