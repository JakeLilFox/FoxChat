#!/usr/bin/env node

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { create as createTarball } from 'tar'
import {
  AVD_NAME,
  avdDir,
  avdExists,
  createAvd,
  ensureAvdHome,
  saveSnapshot,
  startEmulator,
  stopEmulator,
  SYSTEM_IMAGE,
  waitForBoot,
} from './lib/avd.mjs'
import { androidHome, installSdkPackages } from './lib/sdk.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

async function main() {
  const home = androidHome()
  console.log(`Android SDK: ${home}`)
  console.log(`Installing platform-tools, emulator, and ${SYSTEM_IMAGE}...`)
  await installSdkPackages(home, ['platform-tools', 'emulator', SYSTEM_IMAGE])

  const avdHome = ensureAvdHome(home)
  if (!avdExists(home)) {
    console.log(`Creating AVD "${AVD_NAME}"...`)
    createAvd(home)
  } else {
    console.log(`AVD "${AVD_NAME}" already exists, reusing it.`)
  }

  console.log('Booting the emulator (visible window)...')
  startEmulator(home, { headless: false })
  await waitForBoot(home)

  console.log(
    [
      '',
      'The emulator is up. In the emulator window, by hand:',
      '  1. Open Settings > Passwords & accounts > Add account > Google',
      '     (or just open the Play Store, which prompts the same flow).',
      '  2. Sign in with the FoxChat E2E test Google account, including',
      '     any 2FA/TOTP code, exactly as you would on a real phone.',
      '  3. Wait for the account to finish syncing (Play Store usable).',
      '',
      'This script never sees that password or code - it only waits for',
      'you here.',
      '',
    ].join('\n'),
  )
  await prompt("Press Enter once you're fully signed in... ")

  console.log(`Saving snapshot "foxchat-e2e-signedin"...`)
  saveSnapshot(home)

  console.log('Stopping the emulator...')
  stopEmulator(home)
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 5000))

  const outDir = join(__dirname, '.out')
  mkdirSync(outDir, { recursive: true })
  const tarball = join(outDir, 'foxchat-e2e-avd.tar.gz')
  const dir = avdDir(home)
  console.log(`Archiving ${dir} -> ${tarball}`)
  await createTarball({ gzip: true, file: tarball, cwd: avdHome }, [
    `${AVD_NAME}.avd`,
    `${AVD_NAME}.ini`,
  ])

  console.log(
    [
      '',
      `Done: ${tarball}`,
      '',
      'Next steps (manual - this script has no upload credentials):',
      '  1. Put that tarball in restricted secret/artifact storage.',
      '  2. Set ANDROID_E2E_AVD_SNAPSHOT_PATH to the fetched local path, or',
      '     ANDROID_E2E_AVD_SNAPSHOT_URL to an access-controlled URL.',
      '     Treat the archive as a secret: its Google session is reusable',
      '     even though the password and TOTP seed are not stored in it.',
      '  3. Re-bake and re-upload periodically if Google forces a fresh',
      '     sign-in challenge on stale sessions.',
      '',
    ].join('\n'),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
