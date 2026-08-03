import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LOCK_DIR = join(tmpdir(), 'foxchat-matrix-e2e-locks')
const STALE_LOCK_MS = 45 * 60_000

const lockPath = (groupIndex: number) => join(LOCK_DIR, `group-${groupIndex}.lock`)

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const isStale = (path: string) => {
  try {
    const { pid, acquiredAt } = JSON.parse(readFileSync(path, 'utf8')) as {
      pid: number
      acquiredAt: number
    }
    return !isProcessAlive(pid) || Date.now() - acquiredAt > STALE_LOCK_MS
  } catch {
    return true
  }
}

const tryAcquire = (groupIndex: number): boolean => {
  const path = lockPath(groupIndex)
  try {
    const fd = openSync(path, 'wx')
    writeSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }))
    closeSync(fd)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if (!isStale(path)) return false
    try {
      unlinkSync(path)
    } catch {
      return false
    }
    return tryAcquire(groupIndex)
  }
}

export type AccountPoolReservation = {
  assignments: Record<number, number>
  release: () => void
}

export async function reserveAccountPoolGroups(
  workerCount: number,
  totalGroups: number,
  options: { maxWaitMs?: number; pollMs?: number } = {},
): Promise<AccountPoolReservation> {
  if (totalGroups <= 0 || workerCount <= 0) return { assignments: {}, release: () => {} }
  mkdirSync(LOCK_DIR, { recursive: true })
  const maxWaitMs = options.maxWaitMs ?? 5 * 60_000
  const pollMs = options.pollMs ?? 2_000
  const deadline = Date.now() + maxWaitMs
  const assignments: Record<number, number> = {}
  const held: number[] = []

  const claim = (parallelIndex: number): boolean => {
    const preferred = parallelIndex % totalGroups
    for (let offset = 0; offset < totalGroups; offset++) {
      const candidate = (preferred + offset) % totalGroups
      if (held.includes(candidate)) continue
      if (tryAcquire(candidate)) {
        assignments[parallelIndex] = candidate
        held.push(candidate)
        return true
      }
    }
    return false
  }

  for (let parallelIndex = 0; parallelIndex < workerCount; parallelIndex++) {
    while (!claim(parallelIndex)) {
      if (Date.now() >= deadline) {
        console.warn(
          `[matrix-e2e] Could not reserve an exclusive account group for worker ${parallelIndex} ` +
            `within ${Math.round(maxWaitMs / 1_000)}s - every group on this machine is locked by ` +
            'another run. Falling back to its default group, which may collide with that run.',
        )
        break
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  }

  const release = () => {
    for (const groupIndex of held) {
      try {
        unlinkSync(lockPath(groupIndex))
      } catch {
      }
    }
  }
  return { assignments, release }
}
