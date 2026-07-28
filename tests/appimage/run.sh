#!/usr/bin/env bash
set -euo pipefail

source_appimage="${1:-/artifacts/FoxChat.AppImage}"
installed_appimage="${APPIMAGE_E2E_INSTALLED_PATH:-/opt/foxchat/FoxChat.AppImage}"
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
    echo "${variable} is required for the AppImage desktop test" >&2
    exit 1
  fi
done

if [[ "${APPIMAGE_E2E_SKIP_RECOVERY:-0}" != "1" && -z "${MATRIX_E2E_ACCOUNT_1_RECOVERY_KEY:-}" ]]; then
  echo "MATRIX_E2E_ACCOUNT_1_RECOVERY_KEY is required for recovery testing" >&2
  exit 1
fi

install -D -m 0755 "${source_appimage}" "${installed_appimage}"
mkdir -p "${output_directory}"

export APPIMAGE_E2E_APPLICATION="${installed_appimage}"
export APPIMAGE_E2E_OUTPUT_DIR="${output_directory}"
export APPIMAGE_EXTRACT_AND_RUN=1
export EGL_PLATFORM=x11
export GDK_BACKEND=x11
export GALLIUM_DRIVER=llvmpipe
export LIBGL_ALWAYS_SOFTWARE=1
export MESA_LOADER_DRIVER_OVERRIDE=llvmpipe
export NO_AT_BRIDGE=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
# The test container is ephemeral and otherwise prevents WebKit from reaching its renderer.
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1

capture_dir="/tmp/foxchat-e2e-open"
mkdir -p "${capture_dir}"
cat >"${capture_dir}/foxchat-open-capture" <<'CAPTURE'
#!/usr/bin/env bash
printf '%s\n' "${@: -1}" >"${APPIMAGE_E2E_OUTPUT_DIR}/opened-url.txt"
CAPTURE
chmod +x "${capture_dir}/foxchat-open-capture"
ln -sf foxchat-open-capture "${capture_dir}/xdg-open"
ln -sf foxchat-open-capture "${capture_dir}/gio"
export PATH="${capture_dir}:${PATH}"
export BROWSER="${capture_dir}/foxchat-open-capture"

dbus-run-session -- xvfb-run \
  --auto-servernum \
  --server-args="-screen 0 1280x800x24 -nolisten tcp" \
  bash -c '
    set -euo pipefail
    driver_log="${APPIMAGE_E2E_OUTPUT_DIR}/tauri-driver.log"
    tauri-driver \
      --native-driver "${APPIMAGE_E2E_NATIVE_DRIVER:-/usr/local/bin/WebKitWebDriver}" \
      >"${driver_log}" 2>&1 &
    driver_pid=$!
    cleanup() {
      status=$?
      trap - EXIT
      kill "${driver_pid}" >/dev/null 2>&1 || true
      if (( status != 0 )); then
        echo "tauri-driver/AppImage log:" >&2
        cat "${driver_log}" >&2 || true
      fi
      exit "${status}"
    }
    trap cleanup EXIT

    for _ in $(seq 1 60); do
      if bash -c "</dev/tcp/127.0.0.1/4444" >/dev/null 2>&1; then
        node "${APPIMAGE_E2E_SCRIPT:-/opt/foxchat-test/appimage-smoke.mjs}"
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
