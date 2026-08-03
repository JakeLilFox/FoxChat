import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { reserveAccountPoolGroups } from '../../tests/e2e/support/accountPoolLock'

const LOCK_DIR = join(tmpdir(), 'foxchat-matrix-e2e-locks')

afterEach(() => {
  rmSync(LOCK_DIR, { recursive: true, force: true })
})

describe('account pool reservation lock', () => {
  it('assigns every worker a distinct group when there is enough room', async () => {
    const { assignments, release } = await reserveAccountPoolGroups(3, 5)
    try {
      expect(Object.keys(assignments)).toHaveLength(3)
      const groupIndexes = Object.values(assignments)
      expect(new Set(groupIndexes).size).toBe(3)
      for (const groupIndex of groupIndexes) expect(existsSync(join(LOCK_DIR, `group-${groupIndex}.lock`))).toBe(true)
    } finally {
      release()
    }
  })

  it('does not hand out a group that another still-active reservation is holding', async () => {
    const first = await reserveAccountPoolGroups(2, 2)
    try {
      const second = await reserveAccountPoolGroups(1, 2, { maxWaitMs: 50, pollMs: 10 })
      try {
        expect(second.assignments).toEqual({})
      } finally {
        second.release()
      }
    } finally {
      first.release()
    }
  })

  it('frees its groups on release so a later reservation can reclaim them', async () => {
    const first = await reserveAccountPoolGroups(2, 2)
    const firstGroups = new Set(Object.values(first.assignments))
    first.release()
    for (const groupIndex of firstGroups)
      expect(existsSync(join(LOCK_DIR, `group-${groupIndex}.lock`))).toBe(false)

    const second = await reserveAccountPoolGroups(2, 2)
    try {
      expect(Object.keys(second.assignments)).toHaveLength(2)
    } finally {
      second.release()
    }
  })

  it('does nothing when there is no pool to reserve from', async () => {
    const { assignments, release } = await reserveAccountPoolGroups(4, 0)
    expect(assignments).toEqual({})
    expect(existsSync(LOCK_DIR)).toBe(false)
    release()
  })
})
