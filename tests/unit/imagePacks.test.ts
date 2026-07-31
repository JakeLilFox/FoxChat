// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  ALL_ACCOUNT_IMAGE_PACKS_KEY,
  allAccountImagePacksEnabled,
  deduplicateFavoritePacks,
  deduplicateRoomPacks,
  forgetRecents,
  imagePackAccounts,
  matchesPickerSearch,
  moveImagePackOrder,
  orderedImageEntries,
  orderImagePacks,
  preferNonEmptyPack,
  readRecent,
  rememberRecent,
  serializeImagePackItems,
  setAllAccountImagePacksEnabled,
  uniquePackName,
  type MatrixEmotePack,
} from '../../src/lib/emojiData'
import { MatrixClientService } from '../../src/matrix/MatrixClientService'

describe('matchesPickerSearch', () => {
  it('matches every normalized search term across item and pack labels', () => {
    expect(matchesPickerSearch('party parrot', 'Parrot', 'Party animals')).toBe(true)
    expect(matchesPickerSearch('CAFÉ', 'Cafe\u0301 sticker')).toBe(true)
    expect(matchesPickerSearch('party missing', 'Party parrot')).toBe(false)
  })

  it('treats an empty search as a match', () => {
    expect(matchesPickerSearch('   ', 'Anything')).toBe(true)
  })
})

describe('preferNonEmptyPack', () => {
  it('prefers a candidate that actually has images over an earlier empty one', () => {
    const empty: MatrixEmotePack = { images: {} }
    const populated: MatrixEmotePack = {
      images: { sticker: { url: 'mxc://example.org/abc' } },
    }
    expect(preferNonEmptyPack([empty, populated])).toBe(populated)
  })

  it('finds images regardless of which candidate position holds them', () => {
    const populated: MatrixEmotePack = {
      images: { sticker: { url: 'mxc://example.org/abc' } },
    }
    const empty: MatrixEmotePack = { images: {} }
    expect(preferNonEmptyPack([populated, empty])).toBe(populated)
  })

  it('falls back to the last candidate when none have images', () => {
    const first: MatrixEmotePack = { images: {} }
    const last: MatrixEmotePack = { images: {} }
    expect(preferNonEmptyPack([first, last])).toBe(last)
    expect(preferNonEmptyPack([undefined, last])).toBe(last)
    expect(preferNonEmptyPack([first, undefined])).toBeUndefined()
  })
})

describe('uniquePackName', () => {
  it('strips the file extension and lowercases nothing else', () => {
    const used = new Set<string>()
    expect(uniquePackName('favicon.png', used)).toBe('favicon')
  })

  it('falls back to "sticker" for a name that is only an extension', () => {
    const used = new Set<string>()
    expect(uniquePackName('.png', used)).toBe('sticker')
  })

  it('appends an incrementing number to avoid colliding with an already-used name', () => {
    const used = new Set(['favicon'])
    expect(uniquePackName('favicon.png', used)).toBe('favicon 2')
  })

  it('keeps incrementing past multiple existing collisions', () => {
    const used = new Set(['favicon', 'favicon 2', 'favicon 3'])
    expect(uniquePackName('favicon.png', used)).toBe('favicon 4')
  })

  it('registers the returned name in the used set so a later call sees it', () => {
    const used = new Set<string>()
    uniquePackName('favicon.png', used)
    expect(uniquePackName('favicon.png', used)).toBe('favicon 2')
  })
})

describe('image-pack ordering', () => {
  it('serializes every dragged image position as a string order code', () => {
    expect(
      serializeImagePackItems([
        {
          name: 'first',
          url: 'mxc://example.org/first',
          usage: ['sticker'],
        },
        {
          name: 'second',
          url: 'mxc://example.org/second',
          usage: ['sticker', 'emoticon'],
        },
      ]),
    ).toEqual({
      first: {
        body: 'first',
        url: 'mxc://example.org/first',
        info: undefined,
        usage: ['sticker'],
        order: '00000',
      },
      second: {
        body: 'second',
        url: 'mxc://example.org/second',
        info: undefined,
        usage: ['sticker', 'emoticon'],
        order: '00001',
      },
    })
  })

  it('sorts images by their string order code and preserves source order for unordered images', () => {
    const pack: MatrixEmotePack = {
      images: {
        second: { url: 'mxc://example.org/second', order: '00002' },
        unorderedA: { url: 'mxc://example.org/a' },
        first: { url: 'mxc://example.org/first', order: '00001' },
        unorderedB: { url: 'mxc://example.org/b' },
      },
    }

    expect(orderedImageEntries(pack).map(([name]) => name)).toEqual([
      'first',
      'second',
      'unorderedA',
      'unorderedB',
    ])
  })

  it('orders packs privately and preserves saved keys that are hidden in the current room', () => {
    const packs = [
      { orderKey: 'room', label: 'Room' },
      { orderKey: 'personal', label: 'Personal' },
      { orderKey: 'space', label: 'Space' },
    ]
    expect(
      orderImagePacks(packs, ['personal', 'space', 'room']).map((pack) => pack.orderKey),
    ).toEqual(['personal', 'space', 'room'])

    expect(
      moveImagePackOrder(
        ['hidden-pack', 'personal', 'space', 'room'],
        ['personal', 'space', 'room'],
        'room',
        'personal',
        'before',
      ),
    ).toEqual(['hidden-pack', 'room', 'personal', 'space'])
  })
})

describe('combined-account image packs', () => {
  const firstClient = { name: 'first' }
  const secondClient = { name: 'second' }
  const accounts = [
    { id: 'first', userId: '@first:example.org', client: firstClient },
    { id: 'second', userId: '@second:example.org', client: secondClient },
  ]

  it('includes every account only when Combined mode and the preference are enabled', () => {
    expect(imagePackAccounts(accounts, secondClient, true, true)).toEqual(accounts)
    expect(imagePackAccounts(accounts, secondClient, false, true)).toEqual([accounts[1]])
    expect(imagePackAccounts(accounts, secondClient, true, false)).toEqual([accounts[1]])
  })

  it('requires more than one loaded account before merging', () => {
    expect(imagePackAccounts([accounts[0]], firstClient, true, true)).toEqual([accounts[0]])
  })

  it('defaults the preference on and persists an explicit opt-out', () => {
    localStorage.removeItem(ALL_ACCOUNT_IMAGE_PACKS_KEY)
    expect(allAccountImagePacksEnabled()).toBe(true)
    setAllAccountImagePacksEnabled(false)
    expect(allAccountImagePacksEnabled()).toBe(false)
    setAllAccountImagePacksEnabled(true)
    expect(allAccountImagePacksEnabled()).toBe(true)
  })

  it('shows a favorite pack once when multiple accounts favorited it', () => {
    const favorites = [
      {
        favoriteKey: '!room:example.org\u0000pack',
        client: firstClient,
        label: 'First copy',
      },
      {
        favoriteKey: '!room:example.org\u0000pack',
        client: secondClient,
        label: 'Second copy',
      },
    ]

    expect(deduplicateFavoritePacks(favorites)).toEqual([favorites[0]])
  })

  it('uses the selected account copy of a duplicate favorite', () => {
    const favorites = [
      {
        favoriteKey: '!room:example.org\u0000pack',
        client: firstClient,
        label: 'First copy',
      },
      {
        favoriteKey: '!room:example.org\u0000pack',
        client: secondClient,
        label: 'Selected copy',
      },
      {
        favoriteKey: '!other:example.org\u0000',
        client: firstClient,
        label: 'Different pack',
      },
    ]

    expect(deduplicateFavoritePacks(favorites, secondClient)).toEqual([favorites[1], favorites[2]])
  })

  it('does not repeat a favorited pack when it is also available from the current space', () => {
    const favorite = {
      id: 'favorite-space-pack',
      roomPackKey: '!space:example.org\u0000pack',
      label: 'Favorite space pack',
    }
    const contextualCopy = {
      id: 'context-space-pack',
      roomPackKey: '!space:example.org\u0000pack',
      label: 'Contextual space pack',
    }
    const roomPack = {
      id: 'context-room-pack',
      roomPackKey: '!room:example.org\u0000pack',
      label: 'Room pack',
    }

    expect(deduplicateRoomPacks([favorite, contextualCopy, roomPack])).toEqual([favorite, roomPack])
  })
})

describe('image-pack recents', () => {
  it('removes deleted images without disturbing other recent entries', () => {
    const key = 'foxchat-test-image-pack-recents'
    localStorage.removeItem(key)
    rememberRecent(key, { url: 'mxc://example.org/kept' }, (item) => item.url)
    rememberRecent(key, { url: 'mxc://example.org/deleted' }, (item) => item.url)

    forgetRecents<{ url: string }>(key, (item) => item.url.endsWith('/deleted'))

    expect(readRecent(key)).toEqual([{ url: 'mxc://example.org/kept' }])
    localStorage.removeItem(key)
  })
})

describe('saveRoomImagePack / savePersonalImagePack', () => {
  it('writes the room pack as im.ponies.room_emotes state through the selected account', async () => {
    const sendStateEvent = async (
      _roomId: string,
      _type: string,
      _content: unknown,
      _stateKey: string,
    ) => ({ event_id: '$event' })
    let captured: [string, string, unknown, string] | undefined
    const client = {
      getRoom: () => ({ maySendMessage: () => true }),
      sendStateEvent: (...args: [string, string, unknown, string]) => {
        captured = args
        return sendStateEvent(...args)
      },
    }
    const service = new MatrixClientService()
    const internals = service as unknown as {
      roomAccounts: (roomId: string) => Array<{ id: string; userId: string; client: typeof client }>
      availableAccounts: () => Array<{ id: string; userId: string; client: typeof client }>
    }
    const account = { id: 'account', userId: '@user:example.org', client }
    internals.roomAccounts = () => [account]
    internals.availableAccounts = () => [account]

    const content = { pack: { display_name: 'Room stickers and emoji' }, images: {} }
    await service.saveRoomImagePack('!room:example.org', content)

    expect(captured).toEqual(['!room:example.org', 'im.ponies.room_emotes', content, ''])
  })

  it('writes the personal pack as im.ponies.user_emotes account data on the primary client', async () => {
    let captured: [string, unknown] | undefined
    const service = new MatrixClientService()
    ;(service as unknown as { client: unknown }).client = {
      setAccountData: (type: string, content: unknown) => {
        captured = [type, content]
        return Promise.resolve({})
      },
    }

    const content = { pack: { display_name: 'Personal stickers' }, images: {} }
    await service.savePersonalImagePack(content)

    expect(captured).toEqual(['im.ponies.user_emotes', content])
  })

  it('stores picker pack order in private account data and filters invalid saved keys', async () => {
    let saved: [string, unknown] | undefined
    const content = { order: ['personal', 42, '', 'room', 'personal'] }
    const client = {
      getAccountData: () => ({ getContent: () => content }),
      setAccountData: (type: string, value: unknown) => {
        saved = [type, value]
        return Promise.resolve({})
      },
    }
    const service = new MatrixClientService()

    expect(service.imagePackOrder(client as never)).toEqual(['personal', 'room'])
    await service.setImagePackOrder(['room', 'personal', 'room'], client as never)

    expect(saved).toEqual(['chat.foxchat.image_pack_order', { order: ['room', 'personal'] }])
  })
})
