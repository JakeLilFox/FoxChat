# FoxChat Bridge

The bridge lets the HTTPS FoxChat web client provide the local automation API.
It listens only on `127.0.0.1:29331`.

## Install

- Windows: run `foxchat-bridge.exe --install`
- Linux: run `chmod +x foxchat-bridge && ./foxchat-bridge --install`

The executable copies itself into the current user's application directory,
registers user-level autostart, and starts the bridge. No administrator access
is required.

Uninstall autostart with `foxchat-bridge --uninstall`. On Windows the installed
executable remains in `%LOCALAPPDATA%\FoxChat Bridge` and can be removed after
the bridge exits; Linux removes both its autostart entry and installed binary.

The latest authenticated FoxChat web tab becomes the sole Matrix provider.
Replacing or disconnecting it closes existing automation-consumer connections,
which must reconnect and authenticate using the API key shown in FoxChat.

Only FoxChat's production origin (`https://chat.jakefox.de`) and loopback
development origins may register as the Matrix provider. Automation consumers
must authenticate with the API key configured in that active FoxChat tab.
