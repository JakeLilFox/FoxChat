import { matrixService } from '../matrix/MatrixClientService'
import { writeRoomUrl } from './urlState'

export const formattedTags = new Set([
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'S',
  'DEL',
  'CODE',
  'PRE',
  'BLOCKQUOTE',
  'P',
  'BR',
  'UL',
  'OL',
  'LI',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR',
  'A',
  'SPAN',
])
export const matrixUserIdFromHref = (href: string) => {
  try {
    const url = new URL(href)
    if (url.hostname.toLowerCase() !== 'matrix.to') return
    const target = decodeURIComponent(url.hash.replace(/^#\/?/, '').split('?')[0])
    return /^@[^\s/:]+:[^\s/]+$/.test(target) ? target : undefined
  } catch {
    return undefined
  }
}

export const roomReferenceFromHref = (href: string) => {
  if (!href.startsWith('foxchat://room/')) return undefined
  const target = decodeURIComponent(href.slice('foxchat://room/'.length))
  return /^[#!][^\s/]+:[^\s/]+$/.test(target) ? target : undefined
}

// Opens an already-joined room directly; otherwise hands off to the join-room flow so the
// user can pick which account to join with, mirroring how invite links are handled.
export const openRoomReference = (value: string) => {
  const room = matrixService
    .rooms()
    .find(
      (candidate) =>
        candidate.roomId === value ||
        candidate.getCanonicalAlias() === value ||
        candidate.getAltAliases().includes(value),
    )
  if (room) {
    writeRoomUrl(room.roomId)
    return
  }
  window.dispatchEvent(new CustomEvent('foxchat-join-room', { detail: value }))
}

export const firstPreviewUrl = (body: string) =>
  body.match(/https?:\/\/[^\s<>]+/i)?.[0]?.replace(/[),.!?;:]+$/, '')
