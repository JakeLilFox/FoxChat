#!/usr/bin/env bash
set -euo pipefail

source_appimage="${1:-/artifacts/FoxChat.AppImage}"
installed_appimage="/opt/foxchat/FoxChat.AppImage"
output_directory="${APPIMAGE_E2E_OUTPUT_DIR:-/test-output}"

if [[ ! -s "${source_appimage}" ]]; then
  echo "AppImage not found or empty: ${source_appimage}" >&2
  exit 1
fi

for variable in \
  MATRIX_E2E_ACCOUNT_1_HOMESERVER \
  MATRIX_E2E_ACCOUNT_1_USER \
  MATRIX_E2E_ACCOUNT_1_PASSWORD; do
  if [[ -z "${!variable:-}" ]]; then
    echo "${variable} is required for the AppImage login smoke test" >&2
    exit 1
  fi
done

install -D -m 0755 "${source_appimage}" "${installed_appimage}"
mkdir -p "${output_directory}"

export APPIMAGE_E2E_APPLICATION="${installed_appimage}"
export APPIMAGE_E2E_OUTPUT_DIR="${output_directory}"
export APPIMAGE_EXTRACT_AND_RUN=1
export GDK_BACKEND=x11
export NO_AT_BRIDGE=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1

dbus-run-session -- xvfb-run \
  --auto-servernum \
  --server-args="-screen 0 1280x800x24 -nolisten tcp" \
  bash -c '
    set -euo pipefail
    driver_log="${APPIMAGE_E2E_OUTPUT_DIR}/tauri-driver.log"
    tauri-driver --native-driver /usr/local/bin/WebKitWebDriver >"${driver_log}" 2>&1 &
    driver_pid=$!
    trap "kill ${driver_pid} >/dev/null 2>&1 || true" EXIT

    for _ in $(seq 1 60); do
      if bash -c "</dev/tcp/127.0.0.1/4444" >/dev/null 2>&1; then
        node /opt/foxchat-test/appimage-smoke.mjs
        exit
      fi
      if ! kill -0 "${driver_pid}" >/dev/null 2>&1; then
        echo "tauri-driver exited before accepting connections" >&2
        cat "${driver_log}" >&2
        exit 1
      fi
      sleep 1
    done

    echo "tauri-driver did not listen on port 4444 within 60 seconds" >&2
    cat "${driver_log}" >&2
    exit 1
  '
