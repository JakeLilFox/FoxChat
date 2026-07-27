import { formatFileSize } from '../../lib/format'
import {
  JsonBooleanSpan,
  JsonFullscreenOverlay,
  JsonFullscreenPanel,
  JsonKey,
  JsonMeta,
  JsonNullSpan,
  JsonNumberSpan,
  JsonPunct,
  JsonRow,
  JsonStringSpan,
  JsonToggleBtn,
  JsonViewerBody,
  JsonViewerBox,
  JsonViewerToolbar,
} from '../../styles'
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState } from 'react'
import { Spin, Tooltip } from 'antd'
import {
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  DownloadOutlined,
  DownOutlined,
  ExpandOutlined,
  MinusSquareOutlined,
  PlusSquareOutlined,
  RightOutlined,
} from '@ant-design/icons'

function collectContainerPaths(value: unknown, path: string, acc: string[] = []): string[] {
  if (value === null || typeof value !== 'object') return acc
  acc.push(path)
  if (Array.isArray(value))
    value.forEach((item, index) => collectContainerPaths(item, `${path}.${index}`, acc))
  else
    for (const [key, item] of Object.entries(value as Record<string, unknown>))
      collectContainerPaths(item, `${path}.${key}`, acc)
  return acc
}

function JsonNode({
  label,
  value,
  depth,
  path,
  collapsedPaths,
  setCollapsedPaths,
}: {
  label?: string
  value: unknown
  depth: number
  path: string
  collapsedPaths: Set<string>
  setCollapsedPaths: (updater: (current: Set<string>) => Set<string>) => void
}) {
  const isContainer = value !== null && typeof value === 'object'

  const collapsed = collapsedPaths.has(path)
  const isArray = Array.isArray(value)
  const entries: [string, unknown][] = !isContainer
    ? []
    : isArray
      ? value.map((item, index) => [String(index), item])
      : Object.entries(value as Record<string, unknown>)
  const open = isArray ? '[' : '{'
  const close = isArray ? ']' : '}'
  const descendantPaths = useMemo(() => {
    if (value === null || typeof value !== 'object') return []
    const children: [string, unknown][] = Array.isArray(value)
      ? value.map((item, index) => [String(index), item])
      : Object.entries(value as Record<string, unknown>)
    return children.flatMap(([key, item]) => collectContainerPaths(item, `${path}.${key}`))
  }, [value, path])

  if (!isContainer)
    return (
      <JsonRow $depth={depth}>
        <JsonToggleBtn as="span" aria-hidden />
        {label && <JsonKey>{label}: </JsonKey>}
        {value === null ? (
          <JsonNullSpan>null</JsonNullSpan>
        ) : typeof value === 'string' ? (
          <JsonStringSpan>"{value}"</JsonStringSpan>
        ) : typeof value === 'number' ? (
          <JsonNumberSpan>{value}</JsonNumberSpan>
        ) : typeof value === 'boolean' ? (
          <JsonBooleanSpan>{String(value)}</JsonBooleanSpan>
        ) : (
          <JsonPunct>undefined</JsonPunct>
        )}
      </JsonRow>
    )
  const hasNestedContainers = descendantPaths.length > 0
  const descendantsAllCollapsed =
    hasNestedContainers && descendantPaths.every((p) => collapsedPaths.has(p))

  const toggle = () =>
    setCollapsedPaths((current) => {
      const next = new Set(current)
      if (collapsed) next.delete(path)
      else next.add(path)
      return next
    })
  const toggleAll = () =>
    setCollapsedPaths((current) => {
      const next = new Set(current)
      if (descendantsAllCollapsed) descendantPaths.forEach((p) => next.delete(p))
      else descendantPaths.forEach((p) => next.add(p))
      return next
    })

  return (
    <>
      <JsonRow $depth={depth}>
        <JsonToggleBtn
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <RightOutlined /> : <DownOutlined />}
        </JsonToggleBtn>
        {label && <JsonKey>{label}: </JsonKey>}
        <JsonPunct>{open}</JsonPunct>
        {collapsed && (
          <>
            <JsonMeta>
              {entries.length}{' '}
              {isArray
                ? entries.length === 1
                  ? 'item'
                  : 'items'
                : entries.length === 1
                  ? 'key'
                  : 'keys'}
            </JsonMeta>
            <JsonPunct>{close}</JsonPunct>
          </>
        )}
        {!collapsed && hasNestedContainers && (
          <Tooltip
            title={descendantsAllCollapsed ? 'Expand all children' : 'Collapse all children'}
          >
            <JsonToggleBtn type="button" onClick={toggleAll}>
              {descendantsAllCollapsed ? <PlusSquareOutlined /> : <MinusSquareOutlined />}
            </JsonToggleBtn>
          </Tooltip>
        )}
      </JsonRow>
      {!collapsed &&
        entries.map(([key, item]) => (
          <JsonNode
            key={key}
            label={isArray ? undefined : `"${key}"`}
            value={item}
            depth={depth + 1}
            path={`${path}.${key}`}
            collapsedPaths={collapsedPaths}
            setCollapsedPaths={setCollapsedPaths}
          />
        ))}
      {!collapsed && (
        <JsonRow $depth={depth}>
          <JsonToggleBtn as="span" aria-hidden />
          <JsonPunct>{close}</JsonPunct>
        </JsonRow>
      )}
    </>
  )
}

export function JsonFilePreview({
  url,
  filename,
  size,
  source,
}: {
  url?: string
  filename: string
  size?: number
  source?: string
}) {
  const [raw, setRaw] = useState<string>()
  const [parsed, setParsed] = useState<unknown>()
  const [error, setError] = useState<string>()
  const [fullscreen, setFullscreen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (source !== undefined) {
      setRaw(source)
      setCollapsedPaths(new Set())
      try {
        setParsed(JSON.parse(source))
        setError(undefined)
      } catch {
        setParsed(undefined)
        setError("This isn't valid JSON")
      }
      return
    }
    if (!url) return
    let active = true
    setRaw(undefined)
    setParsed(undefined)
    setError(undefined)
    setCollapsedPaths(new Set())
    fetch(url)
      .then((response) => response.text())
      .then((text) => {
        if (!active) return
        setRaw(text)
        try {
          setParsed(JSON.parse(text))
        } catch {
          setError("This file isn't valid JSON")
        }
      })
      .catch(() => {
        if (active) setError('Could not load this file')
      })
    return () => {
      active = false
    }
  }, [url, source])

  useEffect(() => {
    if (!fullscreen) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [fullscreen])

  const copy = async () => {
    const text = parsed !== undefined ? JSON.stringify(parsed, null, 2) : raw
    if (text === undefined) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      /* Clipboard access can be unavailable. */
    }
  }

  const toolbarActions = (
    <span className="actions">
      <Tooltip title={copied ? 'Copied' : 'Copy JSON'}>
        <button
          type="button"
          aria-label="Copy JSON"
          onClick={() => void copy()}
          disabled={raw === undefined}
        >
          {copied ? <CheckOutlined /> : <CopyOutlined />}
        </button>
      </Tooltip>
      {url && (
        <Tooltip title="Download">
          <a href={url} download={filename}>
            <DownloadOutlined />
          </a>
        </Tooltip>
      )}
      {!fullscreen && (
        <Tooltip title="View fullscreen">
          <button
            type="button"
            aria-label="View JSON fullscreen"
            onClick={() => setFullscreen(true)}
          >
            <ExpandOutlined />
          </button>
        </Tooltip>
      )}
    </span>
  )

  const tree =
    error || parsed === undefined ? (
      <div className="jsonError">{error ?? <Spin size="small" />}</div>
    ) : (
      <JsonNode
        value={parsed}
        depth={0}
        path="$"
        collapsedPaths={collapsedPaths}
        setCollapsedPaths={setCollapsedPaths}
      />
    )

  return (
    <>
      <JsonViewerBox data-testid="json-viewer">
        <JsonViewerToolbar>
          <span className="name">
            {filename}
            {size ? ` · ${formatFileSize(size)}` : ''}
          </span>
          {toolbarActions}
        </JsonViewerToolbar>
        <JsonViewerBody>{tree}</JsonViewerBody>
      </JsonViewerBox>
      {fullscreen &&
        createPortal(
          <JsonFullscreenOverlay
            role="dialog"
            aria-modal="true"
            aria-label={`${filename} JSON preview`}
            onClick={() => setFullscreen(false)}
          >
            <JsonFullscreenPanel onClick={(event) => event.stopPropagation()}>
              <div className="head">
                <span className="name">{filename}</span>
                <span className="actions">
                  <Tooltip title={copied ? 'Copied' : 'Copy JSON'}>
                    <button
                      type="button"
                      aria-label="Copy JSON"
                      onClick={() => void copy()}
                      disabled={raw === undefined}
                    >
                      {copied ? <CheckOutlined /> : <CopyOutlined />}
                    </button>
                  </Tooltip>
                  {url && (
                    <Tooltip title="Download">
                      <a href={url} download={filename}>
                        <DownloadOutlined />
                      </a>
                    </Tooltip>
                  )}
                  <Tooltip title="Exit fullscreen">
                    <button
                      type="button"
                      aria-label="Exit JSON fullscreen"
                      onClick={() => setFullscreen(false)}
                    >
                      <CloseOutlined />
                    </button>
                  </Tooltip>
                </span>
              </div>
              <JsonViewerBody $fullscreen>{tree}</JsonViewerBody>
            </JsonFullscreenPanel>
          </JsonFullscreenOverlay>,
          document.body,
        )}
    </>
  )
}
