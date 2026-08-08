# FoxChat desktop CLI mode

The desktop build (Windows, macOS, Linux) accepts command-line arguments so it
can be launched non-interactively: signed in automatically, running with no
visible window, and with the [automation API](AUTOMATION_API.md) already
enabled. This is aimed at running FoxChat as an unattended bot/bridge account
on a server.

## Flags

```text
foxchat --homeserver <url> --username <user> --password <password>
foxchat --help
```

| Flag | Purpose |
| --- | --- |
| `--homeserver <url>` | Homeserver base URL or server name (e.g. `https://matrix.org`) |
| `--username <user>` | Matrix ID or localpart to sign in as |
| `--password <password>` | Account password |
| `--recovery-key <key>` | Security/recovery key, used to unlock encrypted history after sign-in |
| `--persist` | Reuse a previously saved session instead of logging in again (see below) |
| `--automation-port <port>` | Port for the local automation API |
| `--automation-key <key>` | API key for the local automation API |
| `--headless` | Do not show the application window |
| `--help` / `-h` | Print usage and exit |

Every secret-bearing flag has an environment variable equivalent:
`FOXCHAT_HOMESERVER`, `FOXCHAT_USERNAME`, `FOXCHAT_PASSWORD`,
`FOXCHAT_RECOVERY_KEY`, `FOXCHAT_AUTOMATION_KEY`. Prefer these over the CLI
flags for `--password`, `--recovery-key`, and `--automation-key`: command-line
arguments are visible to any other local user via `ps` or `/proc/<pid>/cmdline`
on Linux, while environment variables set for just that process are not.

## `--persist`: reuse an existing login

Logging in creates a new Matrix device every time, so re-running a plain
`--homeserver`/`--username`/`--password` launch on every boot would pile up
devices on the account. `--persist` avoids that:

- If a session for that `--homeserver`/`--username` is already saved on this
  machine (from an earlier CLI login or from using the normal GUI login
  screen), FoxChat resumes it instead of logging in again.
- If none is saved yet, it falls back to `--password` to log in once — after
  that, the session is saved and later `--persist` runs will reuse it.
- With `--persist` and no `--homeserver`/`--username` at all, FoxChat resumes
  whichever account was last active, so a fully unattended launch can be as
  short as:

  ```sh
  foxchat --headless --persist --automation-port 29331 --automation-key "$FOXCHAT_AUTOMATION_KEY"
  ```

  after one interactive (or one `--password`) login has happened previously.

If `--recovery-key` is given, it is applied every launch (harmless if history
is already unlocked), which is useful for restoring encrypted room history
after signing in on a fresh machine.

A CLI-driven launch has nobody available to click through a login screen, so
if sign-in fails FoxChat exits with a non-zero status instead of sitting on a
guest screen — check your process manager's logs.

## `--headless`: no visible window

`--headless` keeps the application window hidden. Matrix sync, the automation
API, and notifications all keep running in the background exactly as they do
in the normal app; only the window itself is never shown.

### Linux servers with no display at all

FoxChat's window is a WebKitGTK webview, which needs a working X11 or Wayland
connection to initialize even when the window is never shown — this is a GTK
requirement, not something `--headless` can bypass on its own.

To make `--headless` work out of the box on a display-less server, FoxChat
detects when both `$DISPLAY` and `$WAYLAND_DISPLAY` are unset and
automatically re-executes itself under [`xvfb-run`](https://manpages.debian.org/xvfb-run)
(a virtual, off-screen framebuffer), if it's installed:

```sh
# Debian/Ubuntu
sudo apt install xvfb
# Fedora
sudo dnf install xorg-x11-server-Xvfb
```

If `xvfb-run` isn't found, FoxChat prints an error explaining this and exits
rather than failing with an opaque GTK error. You can also run it inside an
existing X11/Wayland session, or under your own `xvfb-run`/`Xvfb` invocation —
FoxChat only does the auto-wrap once (guarded by `FOXCHAT_XVFB_WRAPPED`) so it
won't double-wrap if you already have.

### Example systemd service

```ini
[Unit]
Description=FoxChat headless bot account
After=network-online.target

[Service]
ExecStart=/opt/foxchat/foxchat --headless --persist --automation-port 29331
Environment=FOXCHAT_AUTOMATION_KEY=change-me-to-a-long-random-value
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Run `foxchat --headless --homeserver https://matrix.org --username @bot:matrix.org --password '…'`
once by hand first (still works fine under `xvfb-run` if you have no display)
so the session is saved, then switch the service to the `--persist` form
above.
