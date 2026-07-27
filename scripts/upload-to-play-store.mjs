#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs'
import { createSign } from 'node:crypto'

function base64url(buffer) {
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function createSignedJwt(payload, privateKeyPem) {
  const header = { alg: 'RS256', typ: 'JWT' }
  const headerB64 = base64url(Buffer.from(JSON.stringify(header)))
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)))
  const signer = createSign('RSA-SHA256')
  signer.update(`${headerB64}.${payloadB64}`)
  const signature = signer.sign(privateKeyPem)
  return `${headerB64}.${payloadB64}.${base64url(signature)}`
}

async function getAccessToken(serviceAccount) {
  console.log('  Preparing JWT for authentication...')
  const now = Math.floor(Date.now() / 1000)
  const jwt = createSignedJwt(
    {
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    serviceAccount.private_key,
  )

  console.log('  Requesting access token from Google OAuth2...')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`  Token exchange failed (${res.status}): ${text}`)
    throw new Error(`Token exchange failed (${res.status}): ${text}`)
  }
  const data = await res.json()
  console.log('  Access token received.')
  return data.access_token
}

async function playFetch(url, options = {}) {
  console.log(`  [DEBUG] Fetching: ${options.method || 'GET'} ${url}`)
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(300_000),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(`  [DEBUG] Response status: ${res.status}`)
    console.error(`  [DEBUG] Response body: ${text}`)

    if (res.status === 403 && text.includes('must be signed')) {
      console.error('\n' + '='.repeat(70))
      console.error('UNSIGNED BUNDLE: The AAB was built without a signing configuration')
      console.error('='.repeat(70))
      console.error('')
      console.error('Google Play requires all uploaded bundles to be signed with a release key.')
      console.error('This means the Gradle build did NOT sign the AAB. Common causes:')
      console.error('')
      console.error('  1. KEYSTORE_PASSWORD is not set or empty')
      console.error('     Add it as a CI variable in ci.json with an encrypted keystore password.')
      console.error('     The build.gradle file requires KEYSTORE_PATH and KEYSTORE_PASSWORD.')
      console.error('')
      console.error('  2. KEYSTORE_BASE64 is not a valid keystore file')
      console.error(
        '     Verify with: echo "$KEYSTORE_BASE64" | base64 -d | keytool -list -keystore /dev/stdin',
      )
      console.error('')
      console.error('  3. KEYSTORE_ALIAS does not match the alias in the keystore')
      console.error(
        '     The default is "release". Check with: keytool -list -keystore your.keystore',
      )
      console.error('')
      console.error('The build step should print: "Signing with: path=... alias=release"')
      console.error('If you see "No KEYSTORE_BASE64" instead, the keystore variable is empty.')
      console.error('='.repeat(70) + '\n')
    } else if (res.status === 403 && text.includes('PERMISSION_DENIED')) {
      console.error('\n' + '='.repeat(70))
      console.error('PERMISSION DENIED: Service account lacks Play Console permissions')
      console.error('='.repeat(70))
      console.error('')
      console.error('Google recently removed the old "API Access" page from Play Console.')
      console.error('To fix this, you need to invite your service account via Users & Permissions:')
      console.error('')
      console.error('  1. Go to https://play.google.com/console')
      console.error('  2. Click "Users and permissions" in the left sidebar')
      console.error('  3. Click "Invite new users"')
      console.error('  4. Paste your service account email (from the JSON key)')
      console.error('  5. Under App permissions, grant "Admin" or "Release Manager" for your app')
      console.error('  6. Click "Send invitation"')
      console.error('  7. Wait up to 24-48 hours for permissions to propagate')
      console.error('')
      console.error('Also verify:')
      console.error(
        '  Enable the Google Play Developer API in Google Cloud Console under APIs and Services.',
      )
      console.error('  Confirm that the package name in Play Console is foxchat.jakefox.de.')
      console.error('  See docs/PLAY_STORE_PERMISSIONS.md for the troubleshooting guide.')
      console.error('='.repeat(70) + '\n')
    }

    throw new Error(`Play API error (${res.status} ${options.method || 'GET'} ${url}): ${text}`)
  }
  return res.json()
}

async function main() {
  const packageName = process.env.ANDROID_PACKAGE_NAME || 'foxchat.jakefox.de'
  let aabPath = process.env.AAB_PATH

  if (!aabPath) {
    const possiblePaths = [
      'src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab',
      'src-tauri/gen/android/app/build/outputs/bundle/release/app-release.aab',
      'src-tauri/gen/android/app/build/outputs/bundle/release/app-universal-release.aab',
    ]
    for (const p of possiblePaths) {
      if (existsSync(p)) {
        aabPath = p
        break
      }
    }
  }

  if (!aabPath) {
    aabPath =
      'src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab'
  }
  const track = process.env.PLAY_STORE_TRACK || 'alpha'
  const releaseStatus = process.env.PLAY_STORE_RELEASE_STATUS || 'draft'

  console.log(`Play Store upload: ${packageName}, track "${track}" (${releaseStatus})`)
  console.log(`  AAB Path: ${aabPath}`)

  let saJson
  const saBase64 = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64
  const saRaw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON

  console.log('Checking service account credentials...')
  if (saBase64) {
    console.log('  Found GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64')
    try {
      saJson = JSON.parse(Buffer.from(saBase64, 'base64').toString('utf-8'))
      console.log('  Parsed service account JSON from Base64.')
    } catch (e) {
      console.error(`  Failed to parse GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64: ${e.message}`)
      throw e
    }
  } else if (saRaw) {
    console.log('  Found GOOGLE_PLAY_SERVICE_ACCOUNT_JSON')
    try {
      saJson = JSON.parse(saRaw)
      console.log('  Parsed service account JSON.')
    } catch (e) {
      console.error(`  Failed to parse GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: ${e.message}`)
      throw e
    }
  } else {
    console.error(
      '  Skipping Play Store upload because neither GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64 nor GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is set.',
    )
    console.error(
      'To enable automatic uploads, create a Google Cloud service account with Play Developer API access and set the env var.',
    )
    process.exit(0)
  }

  console.log(`  Service Account: ${saJson.client_email}`)

  console.log('Authenticating with Google Play Developer API...')
  const accessToken = await getAccessToken(saJson)
  const authHeaders = { Authorization: `Bearer ${accessToken}` }
  const baseUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}`

  console.log('Creating Play Console edit...')
  const edit = await playFetch(`${baseUrl}/edits`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const editId = edit.id
  console.log(`  Edit ID: ${editId}`)

  console.log(`Uploading AAB: ${aabPath}`)
  const aabBuffer = readFileSync(aabPath)
  console.log(`  AAB size: ${(aabBuffer.length / 1024 / 1024).toFixed(2)} MB`)

  const uploadUrl = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${packageName}/edits/${editId}/bundles`
  const bundle = await playFetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/octet-stream',
      'Content-Length': aabBuffer.length.toString(),
    },
    body: aabBuffer,
  })
  const versionCode = bundle.versionCode
  console.log(`  Uploaded bundle versionCode: ${versionCode}`)

  console.log(`Assigning versionCode ${versionCode} to track "${track}"...`)
  await playFetch(`${baseUrl}/edits/${editId}/tracks/${track}`, {
    method: 'PUT',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track,
      releases: [
        {
          status: releaseStatus,
          versionCodes: [String(versionCode)],
        },
      ],
    }),
  })

  console.log('Committing edit...')
  await playFetch(`${baseUrl}/edits/${editId}:commit`, {
    method: 'POST',
    headers: authHeaders,
  })

  console.log('Play Store upload complete.')
}

main().catch((err) => {
  console.error('Play Store upload failed:', err.message || err)
  process.exit(1)
})
