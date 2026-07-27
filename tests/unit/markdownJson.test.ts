import { describe, expect, it } from 'vitest'
import { marked, type Tokens } from 'marked'
import { highlightCode } from '../../src/lib/codeHighlight'
import { preprocessMarkdown } from '../../src/lib/markdownPreprocess'

const json = JSON.stringify({
  next_batch: '417575',
  rooms: {
    join: {
      '!GCw-hiUhWnIcnnFhnJiFaIye1aX4KU9gmCpCEI33Bsc': {
        unread_notifications: { notification_count: 1 },
        timeline: {
          prev_batch: '417572',
          events: [
            {
              content: {
                algorithm: 'm.megolm.v1.aes-sha2',
                ciphertext: 'AwgCEpACx83jybn3HrDN99gP',
                device_id: 'AzrsEvjfNi',
                session_id: '85G9L1cYiB67r/JJw98MAbCN3oqQo87x44C2gpiAR/0',
              },
              type: 'm.room.encrypted',
            },
          ],
        },
      },
    },
  },
  device_one_time_keys_count: { signed_curve25519: 50 },
  device_unused_fallback_key_types: ['signed_curve25519'],
})

function codeToken(markdown: string) {
  return marked
    .lexer(preprocessMarkdown(markdown), { breaks: true, gfm: true })
    .find((token): token is Tokens.Code => token.type === 'code')
}

describe('JSON Markdown fences', () => {
  it('repairs a four-tick opener and an attached three-tick closer', () => {
    const token = codeToken(`\`\`\`\`JSON\n\n${json}\`\`\``)
    expect(token?.lang?.toLowerCase()).toBe('json')
    expect(JSON.parse(token!.text)).toEqual(JSON.parse(json))
    expect(highlightCode(token!.text, token!.lang).jsonViewer).toBe(true)
  })

  it('moves an inline JSON opener onto its own line', () => {
    const token = codeToken(`sync response: \`\`\`\`JSON\n\n${json}\`\`\``)
    expect(token?.lang?.toLowerCase()).toBe('json')
    expect(highlightCode(token!.text, token!.lang).jsonViewer).toBe(true)
  })

  it('keeps a normal fenced JSON block working', () => {
    const token = codeToken(`\`\`\`json\n${json}\n\`\`\``)
    expect(token?.lang).toBe('json')
    expect(highlightCode(token!.text, token!.lang).jsonViewer).toBe(true)
  })

  it('does not promote invalid JSON to the interactive viewer', () => {
    const token = codeToken('```json\n{"broken":}\n```')
    expect(token).toBeDefined()
    expect(highlightCode(token!.text, token!.lang).jsonViewer).toBe(false)
  })
})
