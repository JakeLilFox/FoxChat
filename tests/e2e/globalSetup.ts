import { reserveAccountPoolGroups } from './support/accountPoolLock'
import { matrixE2EAccountGroups } from './support/env'

const requestedProjects = () => {
  const requested: string[] = []
  for (let index = 0; index < process.argv.length; index++) {
    const arg = process.argv[index]
    if (arg === '--project') requested.push(process.argv[index + 1])
    else if (arg.startsWith('--project=')) requested.push(arg.slice('--project='.length))
  }
  return requested
}

export default async function globalSetup() {
  if (process.env.MATRIX_E2E_ENABLED?.toLowerCase() !== 'true') return
  const requested = requestedProjects()
  if (requested.length && !requested.includes('matrix-live')) return
  const workerCount = Number(process.env.MATRIX_E2E_RESERVED_WORKERS ?? '0')
  const groups = matrixE2EAccountGroups()
  if (!workerCount || !groups.length) return

  const { assignments, release } = await reserveAccountPoolGroups(workerCount, groups.length)
  process.env.MATRIX_E2E_POOL_ASSIGNMENTS = JSON.stringify(assignments)

  return release
}
