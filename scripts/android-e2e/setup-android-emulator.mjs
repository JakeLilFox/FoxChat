#!/usr/bin/env node

import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { extract as extractTarball } from 'tar'
import {
  AVD_NAME,
  avdDir,
  avdExists,
  ensureAdbEnabled,
  ensureAvdHome,
  isKvmAvailable,
  repairAvdPaths,
  startEmulator,
  SYSTEM_IMAGE,
  waitForBoot,
} from './lib/avd.mjs'
import { androidHome, installSdkPackages } from './lib/sdk.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..')
const testEnv = join(repoRoot, 'test.env')
if (existsSync(testEnv)) loadEnv({ path: testEnv, override: false, quiet: true })

async function materializeSnapshot(home, { path, url }) {
  let tarball
  if (path) {
    if (!existsSync(path)) throw new Error(`ANDROID_E2E_AVD_SNAPSHOT_PATH does not exist: ${path}`)
    console.log(`Using local baked AVD snapshot at ${path}`)
    tarball = path
  } else {
    const cacheDir = join(__dirname, '.cache')
    mkdirSync(cacheDir, { recursive: true })
    tarball = join(cacheDir, 'foxchat-e2e-avd.tar.gz')
    if (!existsSync(tarball)) {
      console.log(`Downloading baked AVD snapshot from ${url}...`)
      const response = await fetch(url)
      if (!response.ok)
        throw new Error(
          `Could not download the baked AVD snapshot: ${response.status} ${response.statusText}`,
        )
      await writeFile(tarball, Buffer.from(await response.arrayBuffer()))
    } else {
      console.log(`Reusing cached AVD snapshot at ${tarball}`)
    }
  }

  const avdHome = ensureAvdHome(home)
  console.log(`Extracting snapshot into ${avdHome}...`)
  await extractTarball({ file: tarball, cwd: avdHome })

  if (!existsSync(avdDir(home)))
    throw new Error(
      `Extracted snapshot but ${avdDir(home)} still doesn't exist - check the tarball's layout.`,
    )
}

async function main() {
  const home = androidHome()
  const snapshotPath = process.env.ANDROID_E2E_AVD_SNAPSHOT_PATH
  const snapshotUrl = process.env.ANDROID_E2E_AVD_SNAPSHOT_URL
  if (!snapshotPath && !snapshotUrl)
    throw new Error(
      'Either ANDROID_E2E_AVD_SNAPSHOT_PATH (a local file) or ANDROID_E2E_AVD_SNAPSHOT_URL ' +
        "is required - it's the tarball produced once by `npm run android:e2e:bake-avd`.",
    )

  console.log(`Android SDK: ${home}`)
  if ((process.env.ANDROID_E2E_SKIP_SDK_INSTALL ?? '').toLowerCase() === 'true') {
    console.log('Reusing the already provisioned Android SDK.')
  } else {
    console.log(`Installing platform-tools, build-tools, emulator, and ${SYSTEM_IMAGE}...`)
    await installSdkPackages(home, ['platform-tools', 'build-tools;36.0.0', 'emulator', SYSTEM_IMAGE])
  }

  if (existsSync(avdDir(home))) console.log(`AVD "${AVD_NAME}" already present, skipping.`)
  else if (!avdExists(home)) await materializeSnapshot(home, { path: snapshotPath, url: snapshotUrl })
  repairAvdPaths(home)

  const headless =
    (
      process.env.ANDROID_E2E_HEADLESS ?? (platform() === 'linux' ? 'true' : 'false')
    ).toLowerCase() === 'true'

  if (headless && platform() === 'linux' && !isKvmAvailable()) {
    const present = existsSync('/dev/kvm')
    throw new Error(
      present
        ? [
            '/dev/kvm exists but this user cannot read/write it - x86_64',
            'emulation requires KVM and cannot fall back to software emulation.',
            'If this is a Docker container, either start it with',
            '`--group-add $(getent group kvm | cut -d: -f3)`, or run',
            '`sudo chmod 666 /dev/kvm` as an earlier CI step.',
          ].join(' ')
        : [
            '/dev/kvm does not exist in this environment - x86_64 emulation',
            'requires KVM and cannot fall back to software emulation. If this',
            'is a Docker container, it needs to be started with',
            '`--device=/dev/kvm` (plus `--group-add $(getent group kvm | cut -d: -f3)`,',
            "since the device alone isn't enough for this user to open it).",
          ].join(' '),
    )
  }

  console.log(`Booting the emulator (${headless ? 'headless' : 'windowed'})...`)
  const logFile = join(__dirname, '.cache', 'emulator.log')
  mkdirSync(dirname(logFile), { recursive: true })
  startEmulator(home, {
    headless,
    detached: true,
    logFile,
    extraArgs: ['-no-snapshot-load'],
  })
  await waitForBoot(home, { logFile })
  ensureAdbEnabled(home)
  console.log(`Emulator ready (log: ${logFile}).`)

  console.log(JSON.stringify({ androidHome: home, avdName: AVD_NAME }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
