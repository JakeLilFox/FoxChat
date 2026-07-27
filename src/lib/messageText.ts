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

export const firstPreviewUrl = (body: string) =>
  body.match(/https?:\/\/[^\s<>]+/i)?.[0]?.replace(/[),.!?;:]+$/, '')
