import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

type CiTask = { id?: string; cmd?: string[]; tasks?: CiTask[]; files?: string[] }
type CiWorker = { name?: string; children?: CiTask[] }

const workers = JSON.parse(
  readFileSync(new URL('../../ci.json', import.meta.url), 'utf8'),
) as CiWorker[]

const findTask = (tasks: CiTask[], id: string): CiTask | undefined => {
  for (const task of tasks) {
    if (task.id === id) return task
    const nested = findTask(task.tasks ?? [], id)
    if (nested) return nested
  }
}

describe('Android CI', () => {
  it('uses one deterministic APK name from staging through E2E and release', () => {
    const android = workers.find((worker) => worker.name === 'Android')
    const staging = findTask(android?.children ?? [], '6a1b2c3d-4e5f-4071-8a9b-0c1d2e3f4a5b')
      ?.cmd?.[0]
    const e2e = findTask(android?.children ?? [], 'd4c3e6f8-9001-4c23-bd4e-5f6a7b8c9d0e')?.cmd?.[0]
    const asset = findTask(android?.children ?? [], 'a1b2c3d4-apk4-4000-b000-111111111111')
    const release = workers.find((worker) => worker.name === 'Git-Release')?.children?.[0]
    const artifact = 'android-artifacts/FoxChat_${version}_android.apk'

    expect(staging).toContain(`APK_ARTIFACT=${artifact}`)
    expect(staging).toContain('test -s "$APK_ARTIFACT"')
    expect(asset?.files).toEqual([artifact])
    expect(e2e).toContain(`APK_PATH=${artifact}`)
    expect(e2e).not.toContain('find ')
    expect(release?.files).toContain(`android-apk/${artifact}`)
  })
})
