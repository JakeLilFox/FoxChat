# End-to-end testing

FoxChat uses Playwright for browser journeys and Vitest for focused
regressions. The browser suite has two layers:

- `desktop` and `mobile` test public UI and responsive layout without accounts.
- `matrix-live` assigns four dedicated Matrix accounts to each Playwright
  worker for real encrypted-room journeys.

The live journey signs two accounts into one FoxChat client and a third account
into a separate client, creates an encrypted private room, invites and joins
the other combined account and remote account, tests outbound account switching
and inbound encrypted
messages, renders malformed fenced JSON with the interactive viewer, checks
overlays and browser Back behavior, switches theme and viewport, and optionally
restores encrypted history on a fresh device.

A second live spec, `tests/e2e/live-matrix-voice.spec.ts`, covers voice
channels and screenshare: two accounts create and join a voice channel, each
side's fake microphone plays a distinct known tone (523 Hz / 349 Hz) and the
other side measures it back via a real `AnalyserNode` FFT to confirm the
actual audio arrived, muting is verified to stop the tone from arriving, and
a second test shares a tab rendering a known solid color and confirms the
receiving client's `<video>` tile actually shows that color (not just that
the share/view/mute/stop controls toggled). See "Voice and screenshare
requirements" below before running it.

## Local setup

Install dependencies and Chromium once:

```sh
npm install
npx playwright install chromium
```

Run the credential-free tests:

```sh
npm run test:unit
npm run test:e2e:ui
```

## AppImage desktop E2E

The AppImage test runs the already-built Linux desktop artifact through
`tauri-driver` and the native WebKit WebDriver. The full journey opens the
real AppImage, signs in, creates and opens a private fixture room, sends text,
uploads a PNG, verifies both Matrix events on the homeserver, checks that an
external link is handed to the OS browser opener, and signs out. A separate
recovery journey restores encrypted history with the account recovery key and
can verify the native device through a second, browser-based Matrix session.

The release CI runs three isolated journeys:

- Ubuntu 24.04 recovery with account 1.
- Ubuntu 24.04 functional E2E with account 2.
- Arch Linux container functional E2E with account 3.

The Arch image pins Mesa 24.0.7 and its matching LLVM 17 runtime. Current
Arch WebKitGTK otherwise aborts under headless CI with `EGL_BAD_PARAMETER`.
The CI Dockerfile reuses the Linux `tauri-driver` already built on the worker
and uses Docker's legacy builder for compatibility with the worker's VFS
storage driver.

It does not build an AppImage. Build or obtain the artifact first, then run:

```sh
npm run test:e2e:appimage
```

By default, the runner looks in
`src-tauri/target/release/bundle/appimage/`. Set `APPIMAGE_E2E_PATH` to test a
specific existing artifact. `APPIMAGE_E2E_ACCOUNT` selects the account from
`test.env` and defaults to account 1. Screenshots, the captured external URL,
and the native-driver log are written to `test-results/appimage/`.

When `APPIMAGE_E2E_VERIFICATION=1`, the cross-device SAS handshake is retried
once with a fresh browser device if either side does not render all seven emoji
within 60 seconds. The stalled request is cancelled on both devices before the
retry. Native state, browser state, and a browser screenshot from each stalled
attempt are retained in the output directory.

To run the same harness directly on an Ubuntu host that already has
`tauri-driver`, `WebKitWebDriver`, Xvfb, xauth, and DBus:

```sh
APPIMAGE_E2E_ACCOUNT=2 \
APPIMAGE_E2E_PLATFORM=ubuntu-local \
APPIMAGE_E2E_SKIP_RECOVERY=1 \
npm run test:e2e:appimage:host
```

Set `APPIMAGE_E2E_RECOVERY_ONLY=1` to run only login, recovery-key restore,
and sign-out. Do not combine it with `APPIMAGE_E2E_SKIP_RECOVERY=1`.

For live Matrix testing, copy `test.env.example` to `test.env` and fill it in.
A placeholder `test.env` is created in the workspace and is ignored by Git.
Enable both safety switches only for dedicated accounts:

```dotenv
MATRIX_E2E_ENABLED=true
MATRIX_E2E_ALLOW_ROOM_MUTATION=true
MATRIX_E2E_ALLOW_DEVICE_RESET=true
```

Then run:

```sh
npm run test:e2e:matrix
```

`npm test` runs unit tests and every Playwright project. The live project
reports as skipped until its three safety switches and required account values
are present.

## Environment variables

At minimum, accounts 1 through 4 need:

- `MATRIX_E2E_ACCOUNT_1_HOMESERVER`
- `MATRIX_E2E_ACCOUNT_1_USER`
- `MATRIX_E2E_ACCOUNT_1_PASSWORD`
- `MATRIX_E2E_ACCOUNT_2_HOMESERVER`
- `MATRIX_E2E_ACCOUNT_2_USER`
- `MATRIX_E2E_ACCOUNT_2_PASSWORD`
- `MATRIX_E2E_ACCOUNT_3_HOMESERVER`
- `MATRIX_E2E_ACCOUNT_3_USER`
- `MATRIX_E2E_ACCOUNT_3_PASSWORD`
- `MATRIX_E2E_ACCOUNT_4_HOMESERVER`
- `MATRIX_E2E_ACCOUNT_4_USER`
- `MATRIX_E2E_ACCOUNT_4_PASSWORD`

The `*_USER` values may be either a full Matrix ID or a username accepted by
the homeserver. The suite resolves usernames to their canonical Matrix IDs
after login before inviting users and cleaning up devices.

Recovery keys are optional:

- `MATRIX_E2E_ACCOUNT_1_RECOVERY_KEY`
- `MATRIX_E2E_ACCOUNT_2_RECOVERY_KEY`
- `MATRIX_E2E_ACCOUNT_3_RECOVERY_KEY`
- `MATRIX_E2E_ACCOUNT_4_RECOVERY_KEY`

The fresh-device recovery assertion runs when the worker's second account has
a recovery key. The accounts must already have a working server-side encrypted
backup for that step.

Complete, distinct account quadruples form the worker pool automatically.
`matrix-live` assigns 1/2/3/4 to its first worker, 5/6/7/8 to its second, and
so on. Duplicate Matrix users are skipped before grouping. Its worker count is
`floor(distinct complete accounts / 4)`, with a minimum runner value of one so
an incomplete configuration can report a useful skip reason. An incomplete
trailing group is ignored. With 128 distinct complete accounts, the project
runs with 32 isolated workers and needs no pool-related environment settings.

### Provisioning dedicated accounts

If the homeserver allows registration tokens, the repository can create the
accounts and initialize secret storage, cross-signing, and encrypted key backup
for each one:

```powershell
$env:MATRIX_PROVISION_REGISTRATION_TOKEN = '<registration code>'
$env:MATRIX_PROVISION_BACKUP_PASSPHRASE = '<a long backup passphrase>'
npm run provision:matrix-accounts -- --homeserver https://matrix.example --count 4
Remove-Item Env:MATRIX_PROVISION_REGISTRATION_TOKEN, Env:MATRIX_PROVISION_BACKUP_PASSPHRASE
```

The command prints the path of a generated dotenv file containing the numbered
`MATRIX_E2E_ACCOUNT_*` credentials and recovery keys. It writes under
`test-results/` by default, which is ignored by Git, and saves each password as
soon as registration succeeds so a later backup error does not lose access to
the new account. The shared passphrase is deliberately not included in the
output file.

If provisioning is interrupted after an account is registered, reuse the same
passphrase and output path to repair incomplete backups and continue until the
requested total is reached:

```powershell
npm run provision:matrix-accounts -- --homeserver https://matrix.example --count 4 --output test-results/provisioned-matrix-accounts-123.env --resume
```

Do not use `--force` when resuming: it intentionally replaces the credential
file instead.

Use `--accept-terms` only after reviewing the homeserver policies when its
registration flow requires `m.login.terms`. Run
`npm run provision:matrix-accounts -- --help` for naming, output, and account
index options.

Optional controls:

- `E2E_BASE_URL` defaults to `http://127.0.0.1:4173`.
- `E2E_SKIP_WEBSERVER=true` uses an already deployed test instance.
- `E2E_ROOM_PREFIX` defaults to `FoxChat E2E`.
- `E2E_TIMEOUT_MS` controls normal Playwright timeouts.
- `E2E_HEADLESS` defaults to `true` and controls the audio-only browsers in
  `live-matrix-voice.spec.ts`; the screenshare test always launches headed
  regardless of this setting (see below).

Environment variables exported by CI take precedence over `test.env`.

## Voice and screenshare requirements

`live-matrix-voice.spec.ts` is gated by its own `MATRIX_E2E_ALLOW_VOICE`
switch, independent of the three switches above, because it depends on
things outside this repo's control:

- **A reachable TURN/SFU.** Element Call resolves its media backend from the
  homeserver's own configuration. If the CI network can't reach it, the
  "both join the voice channel" step will time out waiting for a connected
  call - that's a real environment problem, not a test bug.
- **A headed browser with a display for the screenshare test.** Headless
  Chromium's `getDisplayMedia` either throws `NotSupportedError` or returns a
  synthetic pattern unrelated to the real page (confirmed by hand), so
  `launchScreenShareBrowser` (`tests/e2e/support/media.ts`) always launches
  headed. On Linux CI this needs a virtual display, e.g.
  `xvfb-run -a npm run test:e2e:matrix`. If no display is available at all,
  the browser launch itself fails with a clear error rather than hanging.
- Because each simulated participant needs its own fake microphone tone
  (and the sharer needs `--auto-select-desktop-capture-source` pointed at
  its own tab), the spec launches dedicated Chromium processes per account
  via `tests/e2e/support/media.ts` rather than reusing Playwright's shared
  `browser` fixture - these flags are process-level, not per-context.

## Safety and cleanup

Passwords, access tokens, and recovery keys are credentials even when the
accounts contain no personal conversations. Keep them in the CI secret store,
not in repository variables or logs.

The live suite:

- requires all three safety switches;
- wipes every existing device for all three dedicated accounts before the
  journey via the raw API (`wipeAllDevices` in `tests/e2e/support/matrix-api.ts`
  - a temporary login, removing every other device, then logging that
  session out too), so never point these accounts at ones used by people or
  other test jobs;
- generates a unique room name for each run;
- only cleans up the room created by that run;
- leaves and forgets the room for every test session;
- loads each account's device list, signs out every device except the current
  test device, and verifies that only that current device remains;
- disables Playwright traces and videos for the live project because traces
  can retain DOM input values.

If the worker is forcibly terminated, a room named with `E2E_ROOM_PREFIX` may
remain. `npm run test:e2e:cleanup-rooms`
(`scripts/e2e-cleanup-stale-rooms.mts`) leaves and forgets every room across
all three dedicated accounts whose name starts with that prefix - CI runs it
before the suite itself, so these don't keep accumulating across killed or
timed-out runs. It only ever touches prefix-matching rooms; anything else
these accounts are joined to (manual dev/debug rooms, an admin room, etc.) is
left alone. Safe to run by hand too.

Mutating Matrix calls the suite makes on the dedicated accounts'
behalf (`createRoom`, invites) go through `retryMutatingRequest`
(`tests/e2e/support/retry.ts`), which retries once on a `429
M_LIMIT_EXCEEDED` whose `retry_after_ms` is under two minutes, and small
pacing delays run between consecutive mutating actions to avoid tripping the
limiter in the first place. If a run still fails with a `retry_after_ms` of
several minutes or more, the dedicated accounts are already deeply
rate-limited - almost always from CI runs too close together - and the fix
is spacing runs out further, not retrying longer.

## CI

A Linux CI worker can use:

```sh
npm ci
npx playwright install --with-deps chromium
npm run typecheck
npm run lint
npm run test:unit
npm run test:e2e:ui
npm run test:e2e:matrix
```

Load the `MATRIX_E2E_*` values from the CI secret store. Keep the live Matrix
job at concurrency one when the same three accounts are shared across runs.
Upload `playwright-report/` and `test-results/` only for the credential-free
projects; live traces and videos are disabled by configuration (the voice
spec launches its own dedicated Chromium processes outside Playwright's
trace/video machinery entirely, so nothing extra needs disabling for it).

If `MATRIX_E2E_ALLOW_VOICE=true`, wrap the `test:e2e:matrix` step in
`xvfb-run -a` on Linux CI so the screenshare test's headed browser has a
display; see "Voice and screenshare requirements" above.

## Android e2e (push notifications)

`scripts/android-e2e/run.mts` drives a real Android emulator through Appium
to exercise the actual push path end to end: Matrix pusher registration,
FCM delivery, native background decrypt, and the notification that results
- plus swipe-to-reply, room-drawer open/close, and image-viewer pinch, pan,
reset, and close gestures that only mean something on a real device. It's a
separate, much heavier suite from the Playwright tests above: real Google
account, real emulator, real FCM.

It uses `MATRIX_E2E_ACCOUNT_1/2/3/4_*` from the live Matrix test
configuration (account 1 = primary Android login, account 2 = the second
account added mid-journey, accounts 3 and 4 = independent normal-browser
senders for the first and multi-account push checks) and the
same `tests/e2e/support/{ui,matrix-api,env}.ts` helpers for everything that
happens in a plain browser. **Run it at concurrency one with the `matrix-live`
project** because both suites can use accounts 1 through 4 and wipe devices at
startup.

### One-time setup: baking a signed-in emulator snapshot

Google's sign-in flow actively fingerprints and blocks automated logins
from CI/datacenter IPs and fresh emulators. Rather than automate that login,
sign in **once, by hand**, and snapshot the result:

```sh
npm run android:e2e:bake-avd
```

This boots a visible emulator and waits at a prompt while you sign into the
FoxChat E2E test Google account yourself (password and any 2FA code typed
directly into the emulator window - the script never sees them). It then
saves a snapshot and tars it to `scripts/android-e2e/.out/foxchat-e2e-avd.tar.gz`.

Get that tarball onto whatever machine will run the test - either upload it
somewhere `ANDROID_E2E_AVD_SNAPSHOT_URL` can point at, or, if your CI has its
own mechanism for fetching a file onto the runner, place it there and point
`ANDROID_E2E_AVD_SNAPSHOT_PATH` at that local path instead (this repo's
`ci.json` uses the path form - see "CI" below).

**Treat the tarball as a secret.** It contains reusable Google session state
even though it does not contain the account's plaintext password or TOTP
seed. Never commit it, publish it at an unauthenticated URL, or retain it as a
public CI artifact. Store it in the same restricted secret/artifact system
used for other CI credentials, limit access to this worker, and re-bake it if
the account session is revoked or challenged.

### Running it

```sh
npm run android:e2e:setup-emulator   # boots the emulator from the baked snapshot
ANDROID_E2E_APK_PATH=path/to/already-built.apk npm run test:e2e:android
```

Required env vars (`test.env` locally, CI secret store in CI):

- `MATRIX_E2E_ENABLED`, `MATRIX_E2E_ALLOW_ROOM_MUTATION`,
  `MATRIX_E2E_ALLOW_DEVICE_RESET` - same three switches the live suite needs.
- `MATRIX_E2E_ALLOW_ANDROID=true` - dedicated switch for this suite, since
  it's by far the most invasive one (real emulator, real Google account,
  real FCM).
- `MATRIX_E2E_ACCOUNT_1/2/3/4_HOMESERVER/USER/PASSWORD` - four configured
  account slots. Accounts 1 and 2 run on Android; accounts 3 and 4 are
  independent browser sessions.
- `MATRIX_E2E_ACCOUNT_1_RECOVERY_KEY` - required (unlike the live suite,
  where recovery keys are optional) for the backup-restore step.
- `ANDROID_E2E_AVD_SNAPSHOT_PATH` (a local file, checked first) or
  `ANDROID_E2E_AVD_SNAPSHOT_URL` (downloaded by `setup-android-emulator.mjs`
  itself) - one of the two, pointing at the baked snapshot tarball.
- `ANDROID_E2E_ADB_KEY_BASE64` - base64 of an adb private key file (e.g.
  `%USERPROFILE%\.android\adbkey`) already trusted by this AVD's baked
  userdata. Required in CI: adb authorization lives in the guest's
  persisted `/data/misc/adb/adb_keys`, tied to whichever machine's key was
  trusted when the snapshot was baked, and there's no way to tap the "Allow
  USB debugging" dialog headlessly to trust a new one - without this, every
  CI run gets stuck reporting the device "unauthorized".
- `ANDROID_E2E_APK_PATH` - path to the APK under test. CI points this at the
  already-produced signed universal
  APK (or its already-produced x86_64 debug APK on an unsigned build); it does
  not build a second app for E2E. FoxChat exposes its release WebView DevTools
  socket only when Android Debug Bridge is enabled and Appium supplies the
  dedicated E2E launch flag. That lets Appium drive the exact CI artifact
  without enabling release WebView debugging during normal launches.
- Optional: `ANDROID_E2E_PACKAGE_NAME` (default `foxchat.jakefox.de`),
  `ANDROID_E2E_MAIN_ACTIVITY` (default `.MainActivity`),
  `ANDROID_E2E_APPIUM_PORT` (default `4723`), `ANDROID_E2E_HEADLESS`
  (default `true` on Linux, `false`/windowed on Windows), `E2E_BASE_URL`
  (default `http://127.0.0.1:4173`), and `E2E_SKIP_WEBSERVER=true` when that
  URL is already being served. The runner otherwise serves the existing
  `dist/` build for the normal-browser sender.

On failure, a screenshot and the raw `dumpsys notification` output are
written to `scripts/android-e2e/.out/failure*` for diagnosis - this suite
touches real infrastructure (a live Google account, real FCM, the shared
Matrix test accounts), so a failing run should be reported and investigated
rather than retried blindly.

The runner also records the complete Appium-driven journey, from the first
launch of the installed APK through the final image-viewer close, to
`scripts/android-e2e/.out/android-e2e.mp4`. Recording is enabled by default;
set `ANDROID_E2E_RECORD_VIDEO=false` to disable it for a local run. Android
limits one screen recording to 180 seconds, so the runner rotates shorter
recording segments and losslessly joins them with the cross-platform
`ffmpeg-static` binary. Emulator boot and APK installation happen before an
Appium recording is possible and are the only portions not shown. Password
and recovery-key inputs remain masked by the app, but the recording does
contain the visible test account IDs, room names, messages, and notifications
and should therefore be kept with other restricted test artifacts.

### CI

Runs as the last command of the existing `Android` worker in `ci.json`, after
both Android/F-Droid build asset steps. It installs the signed universal APK
already extracted from that worker's AAB, falling back to the already-built
x86_64 APK for unsigned jobs. The snapshot archive must be provisioned by
the restricted CI secret fetch before this command, at the path configured
by `ANDROID_E2E_AVD_SNAPSHOT_PATH`.

After the command succeeds, CI publishes `android-e2e.mp4` under the
`android-e2e` artifact prefix.

The worker also installs Playwright Chromium for the independent
normal-browser sender. Hardware virtualization (KVM) must be available on
the CI host for the emulator to be practical; `setup-android-emulator.mjs`
warns loudly if `/dev/kvm` is missing on Linux instead of silently accepting
very slow software emulation.

On Linux the setup script launches the emulator in a detached GNU `screen`
session named `foxchat-android-emulator`, preventing the CI command wrapper
from reaping it between the setup and test commands. Boot readiness is polled
with bounded adb calls and progress is printed every 15 seconds. If Android
does not boot within five minutes, the command fails with `adb devices`,
`screen -ls`, and the tail of the emulator log instead of hanging forever in
`adb wait-for-device`.

## Marketing screenshot capture

`npm run marketing:screenshots` runs a deterministic, real-Matrix marketing
journey outside the Playwright test runner. It reads the distinct users
configured in account slots 2–4 from `test.env`, temporarily gives them the
fictional Alex, Nia, and Jamie profiles, opens independent browser clients,
creates several shared rooms plus the `Studio North` Space and its channels,
assigns distinct artwork to the group chats, Space, and Space channels, types
natural conversations, uploads images, adds a reaction, and captures:

- a 1440-pixel desktop conversation;
- the shared-image viewer;
- a 430-pixel mobile conversation;
- the desktop conversation using FoxChat's real dark-mode setting;
- the mobile conversation using FoxChat's real dark-mode setting;
- light and dark Space overviews with a custom banner;
- light and dark Space-channel conversations with distinct room artwork and
  photo messages;
- looping light and dark GIF tours that switch among chats and the Space.

The generated files and a credential-free `manifest.json` are written under
`test-results/marketing-screenshots/<timestamp>/`. The source avatars and
shared launch artwork are original SVG fixtures in
`tests/assets/marketing/`. The Space banner and chat photos are local,
attributed Unsplash License fixtures listed in
`tests/assets/marketing/ATTRIBUTION.md`, so captures have no runtime dependency
on an external image host.

The normal safety switches still apply:
`MATRIX_E2E_ENABLED=true` and `MATRIX_E2E_ALLOW_ROOM_MUTATION=true` must be set
in `test.env`. By default the script restores every original profile, leaves
and forgets the generated room, logs out its temporary devices, and stops the
dev server it started. This happens after the PNG files are written, so the
screenshots remain available.

Useful variants:

```sh
npm run marketing:screenshots -- --dry-run
npm run marketing:screenshots -- --headed
npm run marketing:screenshots -- --output=test-results/campaign-july
npm run marketing:screenshots -- --keep-room --keep-profiles
```

`--dry-run` validates the three account slots and local assets without
contacting Matrix or opening a browser. `--keep-room` and `--keep-profiles`
are explicit opt-ins for retaining the staged data. The equivalent environment
variables are `MARKETING_DRY_RUN`, `MARKETING_HEADLESS=false`,
`MARKETING_OUTPUT_DIR`, `MARKETING_KEEP_ROOM`, and
`MARKETING_KEEP_PROFILES`. `E2E_BASE_URL` and `E2E_SKIP_WEBSERVER` behave the
same as they do for the Playwright suite.

Before changing a profile, the script writes the original profile values and
generated room ID to the credential-free, gitignored
`test-results/marketing-screenshots/active-run.json`. A later invocation
automatically consumes that marker if the previous process was interrupted.
`--audit` reports whether the temporary names are currently active.
`--recover-interrupted` exists for captures made before recovery markers were
available; it infers the old profiles from membership-only sync history and
removes rooms matching both the configured marketing room name and topic. If
the dedicated test account has no membership history left, this explicit
recovery mode resets its display name to the Matrix localpart and clears its
avatar.

After every normal capture attempt, cleanup also declines every pending invite
for account slots 2–4 and leaves/forgets every joined room whose name does not
contain the exact text `Admin Room`. Rooms containing `Admin Room` are
preserved. An explicit `--keep-room` protects the current generated marketing
room from this broad cleanup in addition to the normal room cleanup.
