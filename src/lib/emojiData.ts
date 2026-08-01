import { useEffect, useState } from 'react'
import { MatrixClient, Room } from 'matrix-js-sdk'
import { type ImageInfo } from 'matrix-js-sdk/lib/@types/media'

export type MatrixEmote = {
  name: string
  body: string
  url: string
  info?: ImageInfo
  usage?: string[]
  client?: MatrixClient
  // personal/favorited pack vs an ambient room/space pack
  mine?: boolean
}
export type MatrixEmotePack = {
  pack?: { display_name?: string }
  images?: Record<
    string,
    {
      body?: string
      url?: string
      info?: ImageInfo
      usage?: string[]
      order?: string
    }
  >
  'chat.foxchat.split_pack'?: {
    root_state_key: string
    part: number
    total: number
  }
}
export type NamedEmotePack = {
  id: string
  orderKey?: string
  label: string
  pack: MatrixEmotePack
  client: MatrixClient
  mine?: boolean
  roomPackKey?: string
}
export type ImagePackAccount<TClient = MatrixClient> = {
  id: string
  userId: string
  client: TClient
}
export const ALL_ACCOUNT_IMAGE_PACKS_KEY = 'foxchat.imagePacks.allCombinedAccounts'
export const ALL_ACCOUNT_IMAGE_PACKS_CHANGED_EVENT = 'foxchat-all-account-image-packs-changed'
export const allAccountImagePacksEnabled = () =>
  localStorage.getItem(ALL_ACCOUNT_IMAGE_PACKS_KEY) !== 'false'
export const setAllAccountImagePacksEnabled = (enabled: boolean) => {
  localStorage.setItem(ALL_ACCOUNT_IMAGE_PACKS_KEY, String(enabled))
  window.dispatchEvent(
    new CustomEvent(ALL_ACCOUNT_IMAGE_PACKS_CHANGED_EVENT, {
      detail: enabled,
    }),
  )
}
export const imagePackAccounts = <TClient>(
  accounts: ImagePackAccount<TClient>[],
  currentClient: TClient | undefined,
  combinedAccounts: boolean,
  allAccountsEnabled: boolean,
) => {
  if (combinedAccounts && allAccountsEnabled && accounts.length > 1) return accounts
  const current = accounts.find((account) => account.client === currentClient)
  return current ? [current] : []
}
export const deduplicateFavoritePacks = <
  TPack extends {
    favoriteKey: string
    client: unknown
  },
>(
  packs: TPack[],
  preferredClient?: unknown,
) => {
  const unique = new Map<string, TPack>()
  for (const pack of packs) {
    const existing = unique.get(pack.favoriteKey)
    if (!existing || (pack.client === preferredClient && existing.client !== preferredClient)) {
      unique.set(pack.favoriteKey, pack)
    }
  }
  return [...unique.values()]
}
export const deduplicateRoomPacks = <TPack extends { roomPackKey?: string }>(packs: TPack[]) => {
  const seen = new Set<string>()
  return packs.filter((pack) => {
    if (!pack.roomPackKey) return true
    if (seen.has(pack.roomPackKey)) return false
    seen.add(pack.roomPackKey)
    return true
  })
}
export const orderedImageEntries = (pack?: MatrixEmotePack) =>
  Object.entries(pack?.images ?? {})
    .map((entry, index) => ({ entry, index }))
    .sort((first, second) => {
      const firstOrder = first.entry[1].order
      const secondOrder = second.entry[1].order
      if (firstOrder && secondOrder) {
        return firstOrder.localeCompare(secondOrder) || first.index - second.index
      }
      if (firstOrder) return -1
      if (secondOrder) return 1
      return first.index - second.index
    })
    .map(({ entry }) => entry)
export const orderImagePacks = <TPack extends { orderKey?: string }>(
  packs: TPack[],
  order: string[],
) => {
  const positions = new Map(order.map((key, index) => [key, index]))
  return packs
    .map((pack, index) => ({
      pack,
      index,
      position: pack.orderKey ? positions.get(pack.orderKey) : undefined,
    }))
    .sort((first, second) => {
      if (first.position !== undefined && second.position !== undefined) {
        return first.position - second.position || first.index - second.index
      }
      if (first.position !== undefined) return -1
      if (second.position !== undefined) return 1
      return first.index - second.index
    })
    .map(({ pack }) => pack)
}
export const moveImagePackOrder = (
  savedOrder: string[],
  visibleOrder: string[],
  source: string,
  target: string,
  edge: 'before' | 'after',
) => {
  const order = [...new Set([...savedOrder, ...visibleOrder])]
  if (source === target || !order.includes(source) || !order.includes(target)) return order
  const withoutSource = order.filter((key) => key !== source)
  const targetIndex = withoutSource.indexOf(target)
  withoutSource.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, source)
  return withoutSource
}
export function useAllAccountImagePacks() {
  const [enabled, setEnabled] = useState(allAccountImagePacksEnabled)
  useEffect(() => {
    const update = () => setEnabled(allAccountImagePacksEnabled())
    window.addEventListener(ALL_ACCOUNT_IMAGE_PACKS_CHANGED_EVENT, update)
    return () => window.removeEventListener(ALL_ACCOUNT_IMAGE_PACKS_CHANGED_EVENT, update)
  }, [])
  return enabled
}
export const uniquePackName = (wanted: string, used: Set<string>) => {
  const base = wanted.trim().replace(/\.[^.]+$/, '') || 'sticker'
  let name = base
  let number = 2
  while (used.has(name)) name = `${base} ${number++}`
  used.add(name)
  return name
}
export const serializeImagePackItems = (
  items: Array<{
    name: string
    url: string
    info?: ImageInfo
    usage: string[]
  }>,
) => {
  const used = new Set<string>()
  return Object.fromEntries(
    items.map((item, index) => {
      const name = uniquePackName(item.name, used)
      return [
        name,
        {
          body: name,
          url: item.url,
          info: item.info,
          usage: item.usage,
          order: index.toString().padStart(5, '0'),
        },
      ]
    }),
  )
}
export const IMAGE_PACK_STATE_TARGET_BYTES = 32_768
export const jsonByteLength = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength
export const splitImagePackContent = (
  content: Record<string, unknown>,
  maxBytes = IMAGE_PACK_STATE_TARGET_BYTES,
  sizingFields: Record<string, unknown> = {},
) => {
  if (jsonByteLength(content) <= maxBytes) return [content]
  const images =
    content.images && typeof content.images === 'object'
      ? (content.images as Record<string, unknown>)
      : {}
  const base = { ...content, images: {} }
  const sized = (images: Record<string, unknown>) => ({ ...base, ...sizingFields, images })
  if (jsonByteLength(sized({})) > maxBytes)
    throw new Error('This image pack metadata is too large even without its images')

  const chunks: Array<Record<string, unknown>> = []
  let current: Record<string, unknown> = {}
  for (const [name, image] of Object.entries(images)) {
    const candidate = { ...current, [name]: image }
    if (jsonByteLength(sized(candidate)) <= maxBytes) {
      current = candidate
      continue
    }
    if (!Object.keys(current).length)
      throw new Error(`Sticker “${name}” has too much metadata to fit in a Matrix state event`)
    chunks.push({ ...base, images: current })
    current = { [name]: image }
    if (jsonByteLength(sized(current)) > maxBytes)
      throw new Error(`Sticker “${name}” has too much metadata to fit in a Matrix state event`)
  }
  if (Object.keys(current).length || !chunks.length) chunks.push({ ...base, images: current })
  return chunks
}
export const roomImagePackTypes = ['m.image_pack', 'im.ponies.room_emotes'] as const
export const preferNonEmptyPack = (
  candidates: (MatrixEmotePack | undefined)[],
): MatrixEmotePack | undefined =>
  candidates.find((candidate) => candidate?.images && Object.keys(candidate.images).length > 0) ??
  candidates.at(-1)
export type RoomImagePackLocation = {
  type: (typeof roomImagePackTypes)[number]
  stateKey: string
  pack: MatrixEmotePack
}
export type RoomImagePackStateEvent = {
  type: string
  state_key?: string
  content?: MatrixEmotePack
}
const choosePackLocation = (
  candidates: RoomImagePackLocation[],
): RoomImagePackLocation | undefined =>
  candidates.find(
    (candidate) => candidate.pack.images && Object.keys(candidate.pack.images).length > 0,
  ) ?? candidates.at(-1)
export const findRoomImagePack = (room: Room): RoomImagePackLocation | undefined =>
  choosePackLocation(
    roomImagePackTypes.flatMap((type) =>
      room.currentState.getStateEvents(type).map((event) => ({
        type,
        stateKey: event.getStateKey() ?? '',
        pack: event.getContent<MatrixEmotePack>(),
      })),
    ),
  )
const packHasContent = (pack: MatrixEmotePack) =>
  !!pack.pack?.display_name || !!(pack.images && Object.keys(pack.images).length)
// A room can hold multiple m.room.image_pack/im.ponies.room_emotes state events, one per
// state_key, each representing a distinct pack (MSC2545). Group by state_key so both the
// stable and unstable type for the same pack collapse into a single entry.
export const roomImagePacksFromStateEvents = (
  events: RoomImagePackStateEvent[],
): RoomImagePackLocation[] => {
  const byStateKey = new Map<string, RoomImagePackLocation[]>()
  for (const event of events) {
    if (!roomImagePackTypes.includes(event.type as (typeof roomImagePackTypes)[number])) continue
    const stateKey = event.state_key ?? ''
    const location: RoomImagePackLocation = {
      type: event.type as (typeof roomImagePackTypes)[number],
      stateKey,
      pack: event.content ?? {},
    }
    byStateKey.set(stateKey, [...(byStateKey.get(stateKey) ?? []), location])
  }
  const selected = [...byStateKey.values()]
    .map((candidates) => choosePackLocation(candidates)!)
    .filter((location) => packHasContent(location.pack))
  const complete: RoomImagePackLocation[] = []
  const split = new Map<string, RoomImagePackLocation[]>()
  for (const location of selected) {
    const metadata = location.pack['chat.foxchat.split_pack']
    if (
      !metadata ||
      typeof metadata.root_state_key !== 'string' ||
      !Number.isInteger(metadata.part) ||
      metadata.part < 1 ||
      !Number.isInteger(metadata.total) ||
      metadata.total < 2
    ) {
      complete.push(location)
      continue
    }
    split.set(metadata.root_state_key, [...(split.get(metadata.root_state_key) ?? []), location])
  }
  for (const [rootStateKey, fragments] of split) {
    const preferredType = fragments.some(({ type }) => type === 'm.image_pack')
      ? 'm.image_pack'
      : 'im.ponies.room_emotes'
    const matching = fragments
      .filter(({ type }) => type === preferredType)
      .sort(
        (a, b) =>
          (a.pack['chat.foxchat.split_pack']?.part ?? 0) -
          (b.pack['chat.foxchat.split_pack']?.part ?? 0),
      )
    const primary = matching.find(({ pack }) => pack['chat.foxchat.split_pack']?.part === 1)
    const { ['chat.foxchat.split_pack']: _splitMetadata, ...primaryPack } = (primary ?? matching[0])
      .pack
    complete.push({
      type: preferredType,
      stateKey: rootStateKey,
      pack: {
        ...primaryPack,
        images: Object.assign({}, ...matching.map(({ pack }) => pack.images ?? {})),
      },
    })
  }
  return complete.sort((a, b) =>
    (a.pack.pack?.display_name ?? '').localeCompare(b.pack.pack?.display_name ?? ''),
  )
}
export const findRoomImagePacks = (room: Room): RoomImagePackLocation[] =>
  roomImagePacksFromStateEvents(
    roomImagePackTypes.flatMap((type) =>
      room.currentState.getStateEvents(type).map((event) => ({
        type,
        state_key: event.getStateKey() ?? '',
        content: event.getContent<MatrixEmotePack>(),
      })),
    ),
  )
export const imagePackRoomsTypes = ['m.image_pack.rooms', 'im.ponies.emote_rooms'] as const
export const accountImagePackTypes = ['m.image_pack', 'im.ponies.user_emotes'] as const
export const recentStorage = {
  reactions: 'foxchat-recent-reactions',
  unicode: 'foxchat-recent-unicode',
  emojis: 'foxchat-recent-custom-emojis',
  stickers: 'foxchat-recent-stickers',
} as const
export const pinnedStorage = {
  unicode: 'foxchat-pinned-unicode',
  emojis: 'foxchat-pinned-custom-emojis',
  stickers: 'foxchat-pinned-stickers',
} as const
export type StoredEmote = {
  name: string
  body: string
  url: string
  info?: ImageInfo
  usage?: string[]
}
export const readRecent = <T>(key: string): T[] => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}
export const rememberRecent = <T>(key: string, value: T, identity: (item: T) => string) => {
  const next = [
    value,
    ...readRecent<T>(key).filter((item) => identity(item) !== identity(value)),
  ].slice(0, 5)
  localStorage.setItem(key, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent('foxchat-recents', { detail: key }))
  return next
}
export const togglePinned = <T>(key: string, value: T, identity: (item: T) => string) => {
  const current = readRecent<T>(key)
  const valueId = identity(value)
  const pinned = current.some((item) => identity(item) === valueId)
  const next = pinned ? current.filter((item) => identity(item) !== valueId) : [value, ...current]
  localStorage.setItem(key, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent('foxchat-pins', { detail: key }))
  return next
}
export const matchesPickerSearch = (query: string, ...values: Array<string | undefined>) => {
  const terms = query.normalize('NFKD').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const searchable = values
    .filter((value): value is string => !!value)
    .join(' ')
    .normalize('NFKD')
    .toLocaleLowerCase()
  return terms.every((term) => searchable.includes(term))
}
export const inlineEmoteSuggestions = (
  query: string,
  emotes: MatrixEmote[],
  recent: StoredEmote[],
  limit = 3,
) => {
  const recentPositions = new Map(recent.map((emote, index) => [emote.url, index]))
  const matches = emotes
    .map((emote, index) => ({ emote, index, recent: recentPositions.get(emote.url) }))
    .filter(({ emote }) => matchesPickerSearch(query, emote.name, emote.body))
    .sort((first, second) => {
      if (first.recent !== undefined && second.recent !== undefined)
        return first.recent - second.recent
      if (first.recent !== undefined) return -1
      if (second.recent !== undefined) return 1
      return first.index - second.index
    })
  const names = new Set<string>()
  return matches
    .filter(({ emote }) => {
      const name = emote.name.toLocaleLowerCase()
      if (names.has(name)) return false
      names.add(name)
      return true
    })
    .slice(0, limit)
    .map(({ emote }) => emote)
}
export const forgetRecents = <T>(key: string, shouldForget: (item: T) => boolean) => {
  const current = readRecent<T>(key)
  const next = current.filter((item) => !shouldForget(item))
  if (next.length === current.length) return current
  localStorage.setItem(key, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent('foxchat-recents', { detail: key }))
  return next
}
export function useRecents<T>(key: string) {
  const [items, setItems] = useState<T[]>(() => readRecent<T>(key))
  useEffect(() => {
    const update = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) setItems(readRecent<T>(key))
    }
    window.addEventListener('foxchat-recents', update)
    return () => window.removeEventListener('foxchat-recents', update)
  }, [key])
  return items
}
export function usePinned<T>(key: string) {
  const [items, setItems] = useState<T[]>(() => readRecent<T>(key))
  useEffect(() => {
    const update = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) setItems(readRecent<T>(key))
    }
    window.addEventListener('foxchat-pins', update)
    return () => window.removeEventListener('foxchat-pins', update)
  }, [key])
  return items
}
export const emojiList = (value: string) => value.trim().split(/\s+/)
export const countryFlags =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
    .split(' ')
    .map((code) =>
      String.fromCodePoint(...[...code].map((letter) => 127397 + letter.charCodeAt(0))),
    )
export const unicodeCategories = [
  {
    key: 'smileys',
    label: '😀',
    title: 'Smileys',
    items: emojiList(
      '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫣 🤭 🫢 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕',
    ),
  },
  {
    key: 'people',
    label: '👋',
    title: 'People',
    items: emojiList(
      '👋 🤚 🖐️ ✋ 🖖 🫱 🫲 🫳 🫴 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 🫵 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🦿 🦵 🦶 👂 👃 🧠 🫀 🫁 🦷 👀 👁️ 👅 👄 🫦 👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷 🧑‍⚕️ 🧑‍🎓 🧑‍🏫 🧑‍⚖️ 🧑‍🌾 🧑‍🍳 🧑‍🔧 🧑‍🏭 🧑‍💻 🧑‍🎨 🧑‍🚀 🧑‍🚒 👮 🕵️ 💂 🥷 👷 🤴 👸 🧙 🧚 🧛 🧜 🧝 🧞 🧟',
    ),
  },
  {
    key: 'animals',
    label: '🐻',
    title: 'Animals',
    items: emojiList(
      '🐵 🐒 🦍 🦧 🐶 🐕 🦮 🐩 🐺 🦊 🦝 🐱 🐈 🦁 🐯 🐅 🐆 🐴 🫎 🫏 🐎 🦄 🦓 🦌 🦬 🐮 🐂 🐃 🐄 🐷 🐖 🐗 🐽 🐏 🐑 🐐 🐪 🐫 🦙 🦒 🐘 🦣 🦏 🦛 🐭 🐁 🐀 🐹 🐰 🐇 🐿️ 🦫 🦔 🦇 🐻 🐨 🐼 🦥 🦦 🦨 🦘 🦡 🐾 🦃 🐔 🐓 🐣 🐤 🐥 🐦 🐧 🕊️ 🦅 🦆 🦢 🦉 🦩 🦚 🦜 🪽 🐦‍⬛ 🪿 🐸 🐊 🐢 🦎 🐍 🐲 🐉 🦕 🦖 🐳 🐋 🐬 🦭 🐟 🐠 🐡 🦈 🐙 🐚 🪸 🪼 🐌 🦋 🐛 🐜 🐝 🪲 🐞 🦗 🪳 🕷️ 🦂 🦟 🪰 🪱',
    ),
  },
  {
    key: 'food',
    label: '🍕',
    title: 'Food',
    items: emojiList(
      '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🫛 🥬 🥒 🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠 🫚 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🫓 🥪 🥙 🧆 🌮 🌯 🫔 🥗 🥘 🫕 🥫 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 ☕ 🍵 🧃 🥤 🧋 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉',
    ),
  },
  {
    key: 'activities',
    label: '⚽',
    title: 'Activities',
    items: emojiList(
      '⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 🪃 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 ⛷️ 🏂 🪂 🏋️ 🤼 🤸 ⛹️ 🤺 🤾 🏌️ 🏇 🧘 🏄 🏊 🤽 🚣 🧗 🚵 🚴 🏆 🥇 🥈 🥉 🏅 🎖️ 🏵️ 🎗️ 🎫 🎟️ 🎪 🤹 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🪘 🎷 🎺 🪗 🎸 🪕 🎻 🎲 ♟️ 🎯 🎳 🎮 🎰 🧩',
    ),
  },
  {
    key: 'travel',
    label: '🚀',
    title: 'Travel',
    items: emojiList(
      '🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🏍️ 🛵 🚲 🛴 🛹 🛼 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩️ 💺 🛰️ 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥️ 🛳️ ⛴️ 🚢 ⚓ 🛟 ⛽ 🚧 🚦 🚥 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏕️ ⛺ 🛖 🏠 🏡 🏢 🏥 🏦 🏨 🏪 🏫 🏛️ ⛪ 🕌 🛕 🕍 ⛩️ 🕋',
    ),
  },
  {
    key: 'objects',
    label: '💡',
    title: 'Objects',
    items: emojiList(
      '⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 🕹️ 🗜️ 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📞 ☎️ 📟 📠 📺 📻 🎙️ ⏱️ ⏲️ ⏰ 🕰️ ⌛ ⏳ 📡 🔋 🪫 🔌 💡 🔦 🕯️ 🧯 🛢️ 💸 💵 💴 💶 💷 🪙 💳 💎 ⚖️ 🪜 🧰 🪛 🔧 🔨 ⚒️ 🛠️ ⛏️ 🪚 🔩 ⚙️ 🪤 🧱 ⛓️ 🧲 🔫 💣 🧨 🪓 🔪 🗡️ ⚔️ 🛡️ 🚬 ⚰️ 🪦 ⚱️ 🔮 📿 🧿 🪬 💈 ⚗️ 🔭 🔬 🕳️ 🩹 🩺 💊 💉 🩸 🧬 🦠 🧫 🧪 🌡️ 🧹 🪠 🧺 🧻 🚽 🚿 🛁 🧼 🪥 🪒 🧽 🪣 🧴',
    ),
  },
  {
    key: 'symbols',
    label: '❤️',
    title: 'Symbols',
    items: emojiList(
      '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉️ ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ 🆔 ⚛️ ☢️ ☣️ 📴 📳 🈶 🈚 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕ 🛑 ⛔ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 🚭 ❗ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 〽️ ⚠️ 🚸 🔱 ⚜️ 🔰 ♻️ ✅ 🈯 💹 ❇️ ✳️ ❎ 🌐 💠 Ⓜ️ 🌀 💤 🏧 🚾 ♿ 🅿️ 🛗 🈳 🈂️ 🛂 🛃 🛄 🛅',
    ),
  },
  {
    key: 'flags',
    label: '🏳️',
    title: 'Flags',
    items: ['🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️', ...countryFlags],
  },
]
