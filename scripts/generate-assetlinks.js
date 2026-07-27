#!/usr/bin/env node

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const keystorePath = process.argv[2] || process.env.KEYSTORE_PATH
const alias = process.argv[3] || process.env.KEYSTORE_ALIAS || 'upload'
const password = process.argv[4] || process.env.KEYSTORE_PASSWORD
const packageName = process.env.PACKAGE_NAME || 'foxchat.jakefox.de'
const deepLinkHost = process.env.DEEP_LINK_HOST || 'foxchat.app'
const outputPath =
  process.env.OUTPUT_PATH ||
  path.resolve(__dirname, '..', 'public', '.well-known', 'assetlinks.json')

if (!keystorePath) {
  console.error('Usage: node generate-assetlinks.js <keystore-path> <alias> <password>')
  console.error('   Or: KEYSTORE_PATH=x KEYSTORE_PASSWORD=y node generate-assetlinks.js')
  process.exit(1)
}

try {
  const cmd = `keytool -list -v -keystore "${keystorePath}" -alias "${alias}" -storepass "${password}" 2>/dev/null`
  const output = execSync(cmd, { encoding: 'utf-8' })

  const sha256Match = output.match(/SHA256:\s*([A-Fa-f0-9:]+)/)
  if (!sha256Match) {
    console.error('Could not find SHA256 fingerprint in keytool output.')
    console.error('Output:', output)
    process.exit(1)
  }

  const fingerprint = sha256Match[1]
  console.log(`Found SHA-256 fingerprint: ${fingerprint}`)

  console.log(`Generating assetlinks.json for ${deepLinkHost} (${packageName})`)

  const assetlinks = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: [fingerprint],
      },
    },
  ]

  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(outputPath, JSON.stringify(assetlinks, null, 2) + '\n')
  console.log(`Written to ${outputPath}`)
} catch (err) {
  console.error('Failed to generate assetlinks.json:', err.message)
  process.exit(1)
}
