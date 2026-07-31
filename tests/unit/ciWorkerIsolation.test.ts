import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type CiWorker = {
  name?: string
  depends?: string[]
}

const workers = JSON.parse(
  readFileSync(new URL('../../ci.json', import.meta.url), 'utf8'),
) as CiWorker[]

describe('CI Matrix account isolation', () => {
  it('finishes desktop E2E before Android wipes the shared test devices', () => {
    const android = workers.find((worker) => worker.name === 'Android')

    expect(android?.depends).toContain('Desktop')
  })
})
