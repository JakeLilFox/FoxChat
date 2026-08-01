// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  CATEGORY_CONFIG,
  materializeCachedBlob,
  planEviction,
  type CacheEntry,
  type PolicyConfig,
} from '../../src/lib/mediaCache'
import { matrixService } from '../../src/matrix/MatrixClientService'

const entry = (overrides: Partial<CacheEntry> & Pick<CacheEntry, 'key'>): CacheEntry => ({
  category: 'message-image',
  blob: new Blob(),
  mimetype: 'image/png',
  byteSize: 1_000,
  createdAt: 0,
  lastAccessedAt: 0,
  ...overrides,
})

const DAY = 24 * 60 * 60 * 1000

describe('materializeCachedBlob', () => {
  it('copies persisted bytes into a fresh blob with the separately stored MIME type', async () => {
    const persisted = new Blob([new Uint8Array([137, 80, 78, 71])])

    const materialized = await materializeCachedBlob(persisted, 'image/png', 4)

    expect(materialized).not.toBe(persisted)
    expect(materialized.type).toBe('image/png')
    expect([...new Uint8Array(await materialized.arrayBuffer())]).toEqual([137, 80, 78, 71])
  })

  it('rejects an incomplete persisted blob so the caller can redownload it', async () => {
    await expect(materializeCachedBlob(new Blob(['bad']), 'image/png', 100)).rejects.toThrow(
      'Cached media is incomplete',
    )
  })
})

// stubs availableAccounts() so CATEGORY_CONFIG's room lookups resolve to fake rooms
const withRooms = <T>(rooms: Record<string, number>, run: () => T): T => {
  const original = matrixService.availableAccounts
  const fakeClient = {
    getRoom: (roomId: string) =>
      roomId in rooms ? { getLastActiveTimestamp: () => rooms[roomId] } : undefined,
  }
  matrixService.availableAccounts = (() => [
    { id: 'test', userId: '@test:example.org', client: fakeClient },
  ]) as typeof matrixService.availableAccounts
  try {
    return run()
  } finally {
    matrixService.availableAccounts = original
  }
}

describe('planEviction', () => {
  it('keeps everything when under every budget', () => {
    const config: PolicyConfig = { maxEntries: 5, score: (e) => e.lastAccessedAt }
    const entries = [entry({ key: 'a' }), entry({ key: 'b' })]
    expect(planEviction(entries, config, 1_000)).toEqual(new Set())
  })

  it('evicts the lowest-scoring entries first once over the entry-count budget', () => {
    const config: PolicyConfig = { maxEntries: 2, score: (e) => e.lastAccessedAt }
    const entries = [
      entry({ key: 'oldest', lastAccessedAt: 1 }),
      entry({ key: 'middle', lastAccessedAt: 2 }),
      entry({ key: 'newest', lastAccessedAt: 3 }),
    ]
    expect(planEviction(entries, config, 1_000)).toEqual(new Set(['oldest']))
  })

  it('evicts by byte budget, cheapest-scoring entries first, stopping once back under budget', () => {
    const config: PolicyConfig = { maxBytes: 250, score: (e) => e.lastAccessedAt }
    const entries = [
      entry({ key: 'a', byteSize: 100, lastAccessedAt: 1 }),
      entry({ key: 'b', byteSize: 100, lastAccessedAt: 2 }),
      entry({ key: 'c', byteSize: 100, lastAccessedAt: 3 }),
    ]
    // Total is 300 > 250; dropping the lowest-scored (oldest) 100-byte entry brings it to 200.
    expect(planEviction(entries, config, 1_000)).toEqual(new Set(['a']))
  })

  it('purges entries past maxAgeMs regardless of budget pressure', () => {
    const config: PolicyConfig = {
      maxEntries: 10,
      maxAgeMs: 100,
      score: (e) => e.lastAccessedAt,
    }
    const entries = [
      entry({ key: 'stale', lastAccessedAt: 0 }),
      entry({ key: 'fresh', lastAccessedAt: 950 }),
    ]
    expect(planEviction(entries, config, 1_000)).toEqual(new Set(['stale']))
  })

  it('respects both maxEntries and maxBytes simultaneously', () => {
    const config: PolicyConfig = { maxEntries: 2, maxBytes: 150, score: (e) => e.lastAccessedAt }
    const entries = [
      entry({ key: 'a', byteSize: 100, lastAccessedAt: 1 }),
      entry({ key: 'b', byteSize: 100, lastAccessedAt: 2 }),
    ]
    // Only 2 entries (within maxEntries) but 200 bytes > 150, so one still has to go.
    expect(planEviction(entries, config, 1_000)).toEqual(new Set(['a']))
  })

  it('a composite score keeps a lower-recency-but-active-room entry over an idle one', () => {
    // Mirrors the avatar/message-image policies: room activity can outweigh raw lastAccessedAt.
    const roomActivity: Record<string, number> = { active: 100, idle: 0 }
    const config: PolicyConfig = {
      maxEntries: 1,
      score: (e) => 0.5 * e.lastAccessedAt + 0.5 * (roomActivity[e.roomId ?? ''] ?? 0),
    }
    const entries = [
      entry({ key: 'idle-but-recently-accessed', lastAccessedAt: 2, roomId: 'idle' }),
      entry({ key: 'active-room', lastAccessedAt: 1, roomId: 'active' }),
    ]
    expect(planEviction(entries, config, 1_000)).toEqual(new Set(['idle-but-recently-accessed']))
  })
})

describe('CATEGORY_CONFIG', () => {
  it('gives every category a real budget and a score function', () => {
    for (const [category, config] of Object.entries(CATEGORY_CONFIG)) {
      expect(config.maxBytes !== undefined || config.maxEntries !== undefined, category).toBe(true)
      const score = config.score(entry({ key: 'probe', category: category as never }), Date.now())
      expect(Number.isFinite(score), category).toBe(true)
    }
  })

  it('personal packs get a longer runway than ambient ones', () => {
    const now = Date.now()
    const staleAccess = now - 10 * 24 * 60 * 60 * 1000
    const mine = CATEGORY_CONFIG['my-stickers'].score(
      entry({ key: 'mine', category: 'my-stickers', lastAccessedAt: staleAccess }),
      now,
    )
    const other = CATEGORY_CONFIG['other-stickers'].score(
      entry({ key: 'other', category: 'other-stickers', lastAccessedAt: staleAccess }),
      now,
    )
    expect(mine).toBeGreaterThan(other)
  })

  it("message-image: a quiet room's only recent image outscores one buried deep in an active room's long history", () => {
    const now = Date.now()
    withRooms({ quiet: now - 1 * DAY, active: now }, () => {
      const quietRoomsLatestImage = entry({
        key: 'quiet-latest',
        roomId: 'quiet',
        contentTimestamp: now - 1 * DAY,
      })
      const buriedInActiveRoom = entry({
        key: 'active-buried',
        roomId: 'active',
        contentTimestamp: now - 14 * DAY,
      })
      const quietScore = CATEGORY_CONFIG['message-image'].score(quietRoomsLatestImage, now)
      const buriedScore = CATEGORY_CONFIG['message-image'].score(buriedInActiveRoom, now)
      expect(quietScore).toBeGreaterThan(buriedScore)
    })
  })

  it("message-image: a room's own latest image still beats an older one from the same currently-active room", () => {
    const now = Date.now()
    withRooms({ active: now }, () => {
      const latest = entry({ key: 'latest', roomId: 'active', contentTimestamp: now })
      const olderInSameRoom = entry({
        key: 'older',
        roomId: 'active',
        contentTimestamp: now - 10 * DAY,
      })
      const latestScore = CATEGORY_CONFIG['message-image'].score(latest, now)
      const olderScore = CATEGORY_CONFIG['message-image'].score(olderInSameRoom, now)
      expect(latestScore).toBeGreaterThan(olderScore)
    })
  })

  it('message-media caps individual item size so one huge video cannot crowd out everything else', () => {
    expect(CATEGORY_CONFIG['message-media'].maxItemBytes).toBeDefined()
    expect(CATEGORY_CONFIG['message-media'].maxItemBytes!).toBeLessThan(
      CATEGORY_CONFIG['message-media'].maxBytes!,
    )
    // Videos/files run much bigger than images, so the whole-category budget is smaller too.
    expect(CATEGORY_CONFIG['message-media'].maxBytes!).toBeLessThan(
      CATEGORY_CONFIG['message-image'].maxBytes!,
    )
  })

  it('message-media uses the same room-relative recency reasoning as message-image', () => {
    const now = Date.now()
    withRooms({ quiet: now - 1 * DAY, active: now }, () => {
      const quietRoomsLatestFile = entry({
        key: 'quiet-latest',
        category: 'message-media',
        roomId: 'quiet',
        contentTimestamp: now - 1 * DAY,
      })
      const buriedInActiveRoom = entry({
        key: 'active-buried',
        category: 'message-media',
        roomId: 'active',
        contentTimestamp: now - 14 * DAY,
      })
      const quietScore = CATEGORY_CONFIG['message-media'].score(quietRoomsLatestFile, now)
      const buriedScore = CATEGORY_CONFIG['message-media'].score(buriedInActiveRoom, now)
      expect(quietScore).toBeGreaterThan(buriedScore)
    })
  })
})
