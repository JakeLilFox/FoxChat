# FoxChat

FoxChat is a Matrix client built with React, TypeScript, and Tauri. It runs as
a website, a desktop app (Windows/macOS/Linux), and an Android app, all from
one codebase.

Use FoxChat on the web or download the latest desktop binaries and Android
APK from the [FoxChat homepage](https://foxchat.jakefox.de).

It started as a personal project focused on multi-account use, so you can be
logged into several Matrix accounts at once and see their rooms in one
sidebar, and on doing the details well: encryption, calls, and notifications
that don't spam you.

## Features

- **Multi-account:** sign into several accounts at once, with a combined
  room list or one active account at a time
- **Encryption:** Megolm/Olm E2E encryption, cross-signing, key backup, and
  emoji/SAS device verification
- **Voice & video:** MatrixRTC voice channels and Element Call video, with
  screen sharing and speaking indicators
- **Rich messaging:** markdown, replies, threads, reactions, custom emoji
  and sticker packs, polls, read receipts, typing indicators
- **Spaces:** nested space browsing, room pinning, custom tags, and
  sidebar filters
- **Profiles:** display name, bio, pronouns, timezone, social links, and
  presence
- **Media:** drag-and-drop uploads, clipboard paste, image compression, a
  full-screen viewer, and a per-room gallery
- **Notifications:** native desktop notifications and Android push (FCM),
  with inline reply from the notification
- **Moderation:** custom roles and permissions, kicking/banning, and a raw
  event/state inspector for debugging rooms
- **Local automation API:** an optional local WebSocket API for stream
  decks, overlays, and bots; see [AUTOMATION_API.md](AUTOMATION_API.md)

## Repository layout

| Path | What it is |
| --- | --- |
| `src/` | The FoxChat client (React + TypeScript) |
| `src-tauri/` | Tauri shell for the desktop and Android builds |
| `bridge/` | Native helper that gives the web client access to the local automation API ([bridge/README.md](bridge/README.md)) |
| `push-gateway/` | Self-hosted Matrix push gateway that delivers Android notifications via FCM ([push-gateway/README.md](push-gateway/README.md)) |
| `foxchathomepage/` | The marketing/download site ([foxchathomepage/README.md](foxchathomepage/README.md)) |
| `tests/` | Vitest unit tests and Playwright end-to-end journeys ([E2E_TESTING.md](E2E_TESTING.md)) |

## Tech stack

React 19, TypeScript, Ant Design 6, styled-components, matrix-js-sdk, Vite,
Tauri 2, and Element Call (LiveKit) for video.

## Building and running

### Web

```sh
npm install
npm run dev      # dev server
npm run build    # production build, output in dist/
npm run preview  # preview a production build
```

### Desktop (Tauri)

Requires Rust and the platform's Tauri prerequisites (on Windows: MSVC
toolchain, C++ Build Tools, WebView2). See
[NATIVE_BUILD.md](NATIVE_BUILD.md) for the full setup.

```sh
npm run desktop:dev
npm run desktop:build
```

### Android

Requires Android Studio's SDK/NDK, `JAVA_HOME`, `ANDROID_HOME`, and the Rust
Android targets. Also see [NATIVE_BUILD.md](NATIVE_BUILD.md).

```sh
npm run android:init   # once, after installing the Android toolchain
npm run android:dev
npm run android:build  # debug-signed universal APK
npm run android:aab    # release App Bundle, needs a signing key
```

### Tests and linting

```sh
npm run lint
npm run typecheck
npm run test:unit
npm run test:e2e       # playwright, no Matrix account needed
```

Live-account Matrix journeys (real encryption, calls, push) are opt-in and
documented separately in [E2E_TESTING.md](E2E_TESTING.md).

## CI/CD

`ci.json` describes the build pipeline used to test every push to `main` and
produce the web, desktop, and Android builds, including Google Play and
F-Droid publishing. It's written for a specific self-hosted CI system and
build container, so it won't run as-is elsewhere, but it's a reasonably
accurate description of the full release process if you want to adapt it.

Desktop releases are signed for Tauri's updater and published beside the
homepage under `https://foxchat.jakefox.de/updates/`. CI expects the private
key as the `tauri-signing.key` file secret. Preserve that key securely: an
installed desktop app will reject updates signed by a replacement key.

## License

[PolyForm Noncommercial 1.0.0](LICENSE). You can use, modify, and
redistribute this for any noncommercial purpose. Commercial use requires a
separate license; contact baby@jakefox.de.
