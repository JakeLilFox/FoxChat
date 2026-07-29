import { type MatrixEmote } from '../../lib/emojiData'
import { useMediaUrl } from '../../lib/hooks'
import { Spin } from 'antd'

export function MatrixEmoteImage({ emote }: { emote: MatrixEmote }) {
  const url = useMediaUrl({ url: emote.url, info: emote.info }, emote.client, {
    category: emote.mine ? 'my-stickers' : 'other-stickers',
  })
  return url ? <img src={url} alt={emote.body} /> : <Spin size="small" />
}
