import { timestampMarkdownLinks } from './timestamps'

const MENTION_RE = /(?<![A-Za-z0-9_/:.?&=%-])@([A-Za-z0-9._=/-]+:[A-Za-z0-9.-]+)/g
// A room alias always has a server part per the Matrix spec (#localpart:server_name) -
// unlike room IDs, there is no valid alias form without one, so the suffix isn't optional here.
// Making it optional previously matched plain "#hashtag" text as a room reference.
const ROOM_RE = /(?<![A-Za-z0-9_/:.?&=%-])#([A-Za-z0-9._=-]+:[A-Za-z0-9.-]+)/g
const ROOM_ID_RE = /(?<![A-Za-z0-9_/:.?&=%-])!([A-Za-z0-9_-]+(?::[A-Za-z0-9.-]+)?)/g
const SPOILER_RE = /\|\|([^|]+)\|\|/g

export function preprocessMarkdown(text: string): string {
  // Normalize legacy JSON fences.
  const normalized = text
    .replace(/^([ \t]{0,3})`{3,}(?=json[ \t]*(?:\r?$))/gim, '$1```')
    .replace(/(\S[ \t]*)`{3,}(?=json[ \t]*(?:\r?$))/gim, '$1\n```')
    .replace(/```([^\r\n`]*)/g, (match, suffix: string) => {
      const candidate = suffix.trim()
      return !candidate || /^[\w#+.-]+$/.test(candidate) ? match : `\`\`\`\n${suffix.trimStart()}`
    })
    .replace(/([^\r\n])```(?=\s|$)/g, '$1\n```')

  return normalized
    .split('```')
    .map((segment, index) => {
      if (index % 2) return segment
      return timestampMarkdownLinks(segment)
        .replace(
          MENTION_RE,
          (match) => `[${match}](foxchat://mention/${encodeURIComponent(match)})`,
        )
        .replace(ROOM_RE, (match) => `[${match}](foxchat://room/${encodeURIComponent(match)})`)
        .replace(ROOM_ID_RE, (match) => `[${match}](foxchat://room/${encodeURIComponent(match)})`)
        .replace(
          SPOILER_RE,
          (_match, spoiler: string) =>
            `[${spoiler}](foxchat://spoiler/${encodeURIComponent(spoiler)})`,
        )
    })
    .join('```')
}
