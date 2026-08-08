# FoxChat native builds

FoxChat uses Tauri 2 for desktop and Android builds from the existing Vite frontend.

## One-time tooling

Install the platform prerequisites from the Tauri documentation, then install the Tauri Cargo CLI:

```powershell
cargo install tauri-cli --version "^2.0.0" --locked
```

Desktop builds require Rust and the operating system's Tauri dependencies. On Windows this means the MSVC Rust toolchain, Microsoft C++ Build Tools, and WebView2.

Release builds also require the updater signing key. Keep `tauri-signing.key`
outside version control and set `TAURI_SIGNING_PRIVATE_KEY_PATH` to its path
before building. The matching public key is embedded in `tauri.conf.json`.
Never replace or lose this key after shipping an updater-enabled build.

Android additionally requires Android Studio, its SDK/NDK/build tools, `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME`, and the Rust Android targets.

## Commands

```powershell
npm run desktop:dev
npm run desktop:build

# Run once after installing the Android toolchain
npm run android:init
npm run android:dev
npm run android:build
npm run android:aab
```

`android:build` produces a debug-signed universal APK that can be installed directly on an Android device. `android:build:unsigned` produces an unsigned release APK for a later signing step. `android:aab` produces an Android App Bundle for Google Play; release publishing requires your permanent Android signing key.

## Notifications

The native notification plugin requests permission and displays new incoming Matrix messages while FoxChat is running but unfocused. Receiving messages after Android has terminated the process requires a Matrix push gateway and an FCM-backed push service; that server-side infrastructure is separate from the app build.

## CLI / headless mode

The desktop binary can be launched non-interactively with `--homeserver`,
`--username`, `--password`, `--recovery-key`, `--persist`, `--automation-port`,
`--automation-key`, and `--headless` flags — including on Linux servers with no
display at all. See [DESKTOP_CLI.md](DESKTOP_CLI.md).
