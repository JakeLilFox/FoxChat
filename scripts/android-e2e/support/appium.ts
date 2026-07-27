import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { androidHome } from '../lib/sdk.mjs'

export type AppiumServer = {
  port: number
  stop: () => void
}

async function availablePort(preferred: number): Promise<number> {
  const probe = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(port, '0.0.0.0', () => {
        const address = server.address()
        const selected = typeof address === 'object' && address ? address.port : port
        server.close((error) => {
          if (error) reject(error)
          else resolve(selected)
        })
      })
    })
  try {
    return await probe(preferred)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
    return probe(0)
  }
}

export async function startAppiumServer(port = 4723): Promise<AppiumServer> {
  const selectedPort = await availablePort(port)
  if (selectedPort !== port)
    console.warn(`Appium port ${port} is already in use; using ${selectedPort} instead.`)
  const appiumEntrypoint = fileURLToPath(import.meta.resolve('appium'))
  const sdkRoot = androidHome()
  const child: ChildProcess = spawn(
    process.execPath,
    [
      appiumEntrypoint,
      '--port',
      String(selectedPort),
      '--base-path',
      '/',
      '--log-level',
      'warn',
      '--allow-insecure',
      'chromedriver_autodownload',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        ANDROID_HOME: sdkRoot,
        ANDROID_SDK_ROOT: sdkRoot,
      },
    },
  )
  let spawnError: Error | undefined
  let exitCode: number | null = null
  child.on('error', (error) => {
    spawnError = error instanceof Error ? error : new Error(String(error))
  })
  child.on('exit', (code) => {
    exitCode = code
  })

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`Failed to start Appium: ${spawnError.message}`)
    if (exitCode !== null) throw new Error(`Appium exited before becoming ready (code ${exitCode})`)
    try {
      const response = await fetch(`http://127.0.0.1:${selectedPort}/status`)
      if (response.ok) {
        return {
          port: selectedPort,
          stop: () => {
            child.kill()
          },
        }
      }
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
  }
  child.kill()
  throw new Error(`Appium server did not become ready on port ${selectedPort} within 60s`)
}
