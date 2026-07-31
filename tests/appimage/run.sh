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
export WEBKIT_GST_DISABLE_WEBRTC_NETWORK_SANDBOX=1
# The test container is ephemeral and otherwise prevents WebKit from reaching its renderer.
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1

if [[ "${APPIMAGE_E2E_NOTIFICATIONS:-0}" == "1" ]]; then
  export FOXCHAT_E2E_NOTIFICATION_FILE="${APPIMAGE_E2E_OUTPUT_DIR}/desktop-notification.json"
  export FOXCHAT_E2E_NOTIFICATION_AUTO_OPEN=1
  rm -f "${FOXCHAT_E2E_NOTIFICATION_FILE}"
fi

gstreamer_plugin_paths=()
for plugin_path in /usr/lib/*/gstreamer-1.0 /usr/lib/gstreamer-1.0; do
  if [[ -d "${plugin_path}" ]]; then
    gstreamer_plugin_paths+=("${plugin_path}")
  fi
done
if (( ${#gstreamer_plugin_paths[@]} )); then
  printf -v gstreamer_system_path '%s:' "${gstreamer_plugin_paths[@]}"
  export GST_PLUGIN_SYSTEM_PATH_1_0="${gstreamer_system_path%:}"
fi

fake_microphone="${APPIMAGE_E2E_FAKE_MIC:-0}"
if [[ "${fake_microphone}" == "1" ]]; then
  for command in gst-launch-1.0 pactl pipewire pipewire-pulse pw-cli pw-loopback wireplumber xdotool; do
    if ! command -v "${command}" >/dev/null 2>&1; then
      echo "${command} is required when APPIMAGE_E2E_FAKE_MIC=1" >&2
      exit 1
    fi
  done

  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/foxchat-e2e-runtime-${UID}}"
  mkdir -p "${XDG_RUNTIME_DIR}"
  chmod 700 "${XDG_RUNTIME_DIR}"
  export PULSE_SERVER="unix:${XDG_RUNTIME_DIR}/pulse/native"
fi

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
    prompt_pid=""
    preview_pid=""
    pipewire_pid=""
    pipewire_pulse_pid=""
    loopback_pid=""
    tone_pid=""
    wireplumber_pid=""
    if [[ "${APPIMAGE_E2E_FAKE_MIC:-0}" == "1" ]]; then
      pipewire >"${APPIMAGE_E2E_OUTPUT_DIR}/pipewire.log" 2>&1 &
      pipewire_pid=$!
      wireplumber >"${APPIMAGE_E2E_OUTPUT_DIR}/wireplumber.log" 2>&1 &
      wireplumber_pid=$!
      pipewire-pulse >"${APPIMAGE_E2E_OUTPUT_DIR}/pipewire-pulse.log" 2>&1 &
      pipewire_pulse_pid=$!
      for _ in $(seq 1 100); do
        if pactl info >/dev/null 2>&1; then
          break
        fi
        sleep 0.1
      done
      if ! pactl info >/dev/null 2>&1; then
        echo "PipeWire PulseAudio service did not become ready" >&2
        cat "${APPIMAGE_E2E_OUTPUT_DIR}/pipewire.log" >&2 || true
        cat "${APPIMAGE_E2E_OUTPUT_DIR}/pipewire-pulse.log" >&2 || true
        exit 1
      fi
      pw-loopback \
        --name=foxchat-e2e-microphone \
        --capture-props="node.name=foxchat_e2e_sink node.description=FoxChat_E2E_Input media.class=Audio/Sink" \
        --playback-props="node.name=foxchat_e2e_source node.description=FoxChat_E2E_Microphone media.class=Audio/Source" \
        >"${APPIMAGE_E2E_OUTPUT_DIR}/microphone-loopback.log" 2>&1 &
      loopback_pid=$!
      for _ in $(seq 1 100); do
        if pactl list short sources | grep -q foxchat_e2e_source; then
          break
        fi
        sleep 0.1
      done
      if ! pactl list short sources | grep -q foxchat_e2e_source; then
        echo "PipeWire fake microphone source did not become ready" >&2
        cat "${APPIMAGE_E2E_OUTPUT_DIR}/microphone-loopback.log" >&2 || true
        exit 1
      fi
      pactl set-default-source foxchat_e2e_source
      pactl info >"${APPIMAGE_E2E_OUTPUT_DIR}/pulseaudio-info.txt"
      pactl list short sources >"${APPIMAGE_E2E_OUTPUT_DIR}/microphone-sources.txt"
      pw-cli ls Node >"${APPIMAGE_E2E_OUTPUT_DIR}/pipewire-nodes.txt"
      gst-launch-1.0 -q \
        audiotestsrc is-live=true wave=sine freq=440 \
        ! audioconvert \
        ! audioresample \
        ! pulsesink device=foxchat_e2e_sink \
        >"${APPIMAGE_E2E_OUTPUT_DIR}/microphone-tone.log" 2>&1 &
      tone_pid=$!
    fi
    if [[ "${APPIMAGE_E2E_CALLS:-0}" == "1" || "${APPIMAGE_E2E_VERIFICATION:-0}" == "1" ]]; then
      : "${APPIMAGE_E2E_PROJECT_ROOT:?APPIMAGE_E2E_PROJECT_ROOT is required for browser-assisted desktop testing}"
      export APPIMAGE_E2E_CALL_RECEIVER_URL="${APPIMAGE_E2E_CALL_RECEIVER_URL:-http://127.0.0.1:4173}"
      (
        cd "${APPIMAGE_E2E_PROJECT_ROOT}"
        npm run preview -- --host 127.0.0.1 --port 4173
      ) >"${APPIMAGE_E2E_OUTPUT_DIR}/call-preview.log" 2>&1 &
      preview_pid=$!
      preview_ready=0
      for _ in $(seq 1 120); do
        if bash -c "</dev/tcp/127.0.0.1/4173" >/dev/null 2>&1; then
          preview_ready=1
          break
        fi
        if ! kill -0 "${preview_pid}" >/dev/null 2>&1; then
          echo "Desktop E2E preview server exited before becoming ready" >&2
          cat "${APPIMAGE_E2E_OUTPUT_DIR}/call-preview.log" >&2
          exit 1
        fi
        sleep 0.5
      done
      if [[ "${preview_ready}" != "1" ]]; then
        echo "Desktop E2E preview server did not become ready" >&2
        cat "${APPIMAGE_E2E_OUTPUT_DIR}/call-preview.log" >&2
        exit 1
      fi
    fi
    if [[ "${APPIMAGE_E2E_FAKE_MIC:-0}" == "1" ]]; then
      export GST_DEBUG="${GST_DEBUG:-3}"
      export GST_DEBUG_FILE="${APPIMAGE_E2E_OUTPUT_DIR}/gstreamer-webkit.log"
      (
        for _ in $(seq 1 600); do
          if (( _ % 10 == 0 )); then
            {
              for visible_window in $(xdotool search --onlyvisible --name ".*" 2>/dev/null || true); do
                printf "%s " "${visible_window}"
                xdotool getwindowname "${visible_window}" 2>/dev/null || true
              done
            } >"${APPIMAGE_E2E_OUTPUT_DIR}/visible-windows.txt"
          fi
          prompt_window="$(xdotool search --onlyvisible --name "^Microphone access$" 2>/dev/null | tail -n 1 || true)"
          if [[ -z "${prompt_window}" ]]; then
            for unnamed_window in $(xdotool search --onlyvisible --name "^$" 2>/dev/null || true); do
              window_geometry="$(xdotool getwindowgeometry --shell "${unnamed_window}" 2>/dev/null || true)"
              window_width="$(printf "%s\n" "${window_geometry}" | sed -n "s/^WIDTH=//p")"
              window_height="$(printf "%s\n" "${window_geometry}" | sed -n "s/^HEIGHT=//p")"
              if [[ -n "${window_width}" && -n "${window_height}" ]] &&
                (( window_width < 1280 && window_height < 800 )); then
                prompt_window="${unnamed_window}"
              fi
            done
          fi
          if [[ -n "${prompt_window}" ]]; then
            xdotool key --window "${prompt_window}" alt+y
            printf "%s\n" approved >"${APPIMAGE_E2E_OUTPUT_DIR}/microphone-prompt-approved.txt"
            exit 0
          fi
          sleep 0.1
        done
        echo "Timed out waiting for the native microphone permission prompt" >&2
        exit 1
      ) >"${APPIMAGE_E2E_OUTPUT_DIR}/microphone-prompt-helper.log" 2>&1 &
      prompt_pid=$!
    fi
    tauri-driver \
      --native-driver "${APPIMAGE_E2E_NATIVE_DRIVER:-/usr/local/bin/WebKitWebDriver}" \
      >"${driver_log}" 2>&1 &
    driver_pid=$!
    cleanup() {
      status=$?
      trap - EXIT
      kill "${driver_pid}" >/dev/null 2>&1 || true
      if [[ -n "${prompt_pid}" ]]; then
        kill "${prompt_pid}" >/dev/null 2>&1 || true
      fi
      if [[ -n "${preview_pid}" ]]; then
        kill "${preview_pid}" >/dev/null 2>&1 || true
      fi
      if [[ "${APPIMAGE_E2E_FAKE_MIC:-0}" == "1" ]]; then
        kill "${tone_pid}" >/dev/null 2>&1 || true
        kill "${loopback_pid}" >/dev/null 2>&1 || true
        kill "${pipewire_pulse_pid}" >/dev/null 2>&1 || true
        kill "${wireplumber_pid}" >/dev/null 2>&1 || true
        kill "${pipewire_pid}" >/dev/null 2>&1 || true
      fi
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
