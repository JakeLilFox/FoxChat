import { matrixService } from '../matrix/MatrixClientService'

export type MediaCacheCategory =
  | 'my-stickers'
  | 'other-stickers'
  | 'message-image'
  | 'message-media'
  | 'opengraph'
  | 'avatar'

export type CacheEntry = {
  key: string
  category: MediaCacheCategory
  blob: Blob
  mimetype: string
  byteSize: number
  createdAt: number
  lastAccessedAt: number
  roomId?: string
  contentTimestamp?: number
}

const DB_NAME = 'foxchat-media-cache'
const DB_VERSION = 1
const STORE = 'entries'
const DAY = 24 * 60 * 60 * 1000

const decay = (ageMs: number, halfLifeMs: number) =>
  Math.exp((-Math.LN2 * Math.max(0, ageMs)) / halfLifeMs)

function findRoom(roomId: string) {
  const clients = [
    matrixService.matrixClient,
    ...matrixService.availableAccounts().map((account) => account.client),
  ]
  for (const client of clients) {
    const room = client?.getRoom(roomId)
    if (room) return room
  }
  return undefined
}

function roomRecency(roomId: string | undefined, now: number): number {
  if (!roomId) return 0
  const lastActive = findRoom(roomId)?.getLastActiveTimestamp()
  return lastActive ? decay(now - lastActive, 7 * DAY) : 0
}

// age relative to the room's own latest message, not the wall clock
function roomRelativeAge(
  roomId: string | undefined,
  contentTimestamp: number,
  now: number,
): number {
  const lastActive = roomId ? findRoom(roomId)?.getLastActiveTimestamp() : undefined
  if (lastActive === undefined) return now - contentTimestamp
  return Math.max(0, lastActive - contentTimestamp)
}

export type PolicyConfig = {
  maxBytes?: number
  maxEntries?: number
  maxAgeMs?: number
  maxItemBytes?: number
  score: (entry: CacheEntry, now: number) => number
}

const messageMediaScore = (entry: CacheEntry, now: number) =>
  0.5 * roomRecency(entry.roomId, now) +
  0.5 *
    decay(roomRelativeAge(entry.roomId, entry.contentTimestamp ?? entry.createdAt, now), 5 * DAY)

export const CATEGORY_CONFIG: Record<MediaCacheCategory, PolicyConfig> = {
  'my-stickers': {
    maxBytes: 100 * 1024 * 1024,
    maxEntries: 2000,
    score: (entry, now) => decay(now - entry.lastAccessedAt, 30 * DAY),
  },
  'other-stickers': {
    maxBytes: 50 * 1024 * 1024,
    maxEntries: 1000,
    score: (entry, now) => decay(now - entry.lastAccessedAt, 14 * DAY),
  },
  opengraph: {
    maxBytes: 60 * 1024 * 1024,
    maxEntries: 300,
    maxAgeMs: 14 * DAY,
    score: (entry, now) => decay(now - entry.lastAccessedAt, 7 * DAY),
  },
  avatar: {
    maxBytes: 60 * 1024 * 1024,
    maxEntries: 150,
    score: (entry, now) =>
      0.5 * decay(now - entry.lastAccessedAt, 14 * DAY) + 0.5 * roomRecency(entry.roomId, now),
  },
  'message-image': {
    maxBytes: 300 * 1024 * 1024,
    maxEntries: 4000,
    score: messageMediaScore,
  },
  'message-media': {
    maxBytes: 200 * 1024 * 1024,
    maxEntries: 500,
    maxItemBytes: 25 * 1024 * 1024,
    score: messageMediaScore,
  },
}

let dbPromise: Promise<IDBDatabase> | undefined
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolvePromise, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex('by_category', 'category', { unique: false })
      }
    }
    request.onsuccess = () => resolvePromise(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function store(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(STORE, mode).objectStore(STORE)
}

function requestPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    request.onsuccess = () => resolvePromise(request.result)
    request.onerror = () => reject(request.error)
  })
}

const evictionTimers = new Map<MediaCacheCategory, number>()

function scheduleEviction(category: MediaCacheCategory) {
  if (evictionTimers.has(category)) return
  const timer = window.setTimeout(() => {
    evictionTimers.delete(category)
    void runEviction(category).catch(() => undefined)
  }, 3_000)
  evictionTimers.set(category, timer)
}

// kept separate from the IndexedDB I/O below so it's unit-testable without a browser
export function planEviction(
  entries: CacheEntry[],
  config: PolicyConfig,
  now: number,
): Set<string> {
  const toDelete = new Set<string>()
  let survivors = entries
  if (config.maxAgeMs !== undefined) {
    const maxAgeMs = config.maxAgeMs
    survivors = survivors.filter((entry) => {
      const expired = now - entry.lastAccessedAt > maxAgeMs
      if (expired) toDelete.add(entry.key)
      return !expired
    })
  }
  let bytes = survivors.reduce((sum, entry) => sum + entry.byteSize, 0)
  let count = survivors.length
  const overBudget = () =>
    (config.maxBytes !== undefined && bytes > config.maxBytes) ||
    (config.maxEntries !== undefined && count > config.maxEntries)
  if (overBudget()) {
    const scored = survivors
      .map((entry) => ({ entry, score: config.score(entry, now) }))
      .sort((a, b) => a.score - b.score)
    for (const { entry } of scored) {
      if (!overBudget()) break
      toDelete.add(entry.key)
      bytes -= entry.byteSize
      count -= 1
    }
  }
  return toDelete
}

async function runEviction(category: MediaCacheCategory) {
  const config = CATEGORY_CONFIG[category]
  const db = await openDb()
  const entries = await requestPromise(
    store(db, 'readonly').index('by_category').getAll(IDBKeyRange.only(category)) as IDBRequest<
      CacheEntry[]
    >,
  )
  const toDelete = planEviction(entries, config, Date.now())
  if (!toDelete.size) return
  const writeStore = store(db, 'readwrite')
  for (const key of toDelete) writeStore.delete(key)
}

export async function getCachedMedia(
  key: string,
): Promise<{ blob: Blob; mimetype: string } | undefined> {
  try {
    const db = await openDb()
    const entry = await requestPromise(
      store(db, 'readonly').get(key) as IDBRequest<CacheEntry | undefined>,
    )
    if (!entry) return undefined
    store(db, 'readwrite').put({ ...entry, lastAccessedAt: Date.now() })
    return { blob: entry.blob, mimetype: entry.mimetype }
  } catch {
    return undefined
  }
}

export async function putCachedMedia(params: {
  key: string
  category: MediaCacheCategory
  blob: Blob
  mimetype: string
  roomId?: string
  timestamp?: number
}): Promise<void> {
  const maxItemBytes = CATEGORY_CONFIG[params.category].maxItemBytes
  if (maxItemBytes !== undefined && params.blob.size > maxItemBytes) return
  try {
    const db = await openDb()
    const now = Date.now()
    const entry: CacheEntry = {
      key: params.key,
      category: params.category,
      blob: params.blob,
      mimetype: params.mimetype,
      byteSize: params.blob.size,
      createdAt: now,
      lastAccessedAt: now,
      roomId: params.roomId,
      contentTimestamp: params.timestamp,
    }
    store(db, 'readwrite').put(entry)
    scheduleEviction(params.category)
  } catch {
    // Caching is a pure optimization; a failure here must not affect media rendering.
  }
}

export async function clearMediaCache(category?: MediaCacheCategory): Promise<void> {
  const db = await openDb()
  if (!category) {
    store(db, 'readwrite').clear()
    return
  }
  const keys = await requestPromise(
    store(db, 'readonly').index('by_category').getAllKeys(IDBKeyRange.only(category)),
  )
  const writeStore = store(db, 'readwrite')
  for (const key of keys) writeStore.delete(key)
}

export async function mediaCacheUsage(): Promise<
  Record<MediaCacheCategory, { count: number; bytes: number }>
> {
  const db = await openDb()
  const all = await requestPromise(store(db, 'readonly').getAll() as IDBRequest<CacheEntry[]>)
  const usage = Object.fromEntries(
    Object.keys(CATEGORY_CONFIG).map((category) => [category, { count: 0, bytes: 0 }]),
  ) as Record<MediaCacheCategory, { count: number; bytes: number }>
  for (const entry of all) {
    usage[entry.category].count++
    usage[entry.category].bytes += entry.byteSize
  }
  return usage
}
