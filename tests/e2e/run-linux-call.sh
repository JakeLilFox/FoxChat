#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--inside-dbus" ]]; then
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/foxchat-linux-call-${UID}}"
  mkdir -p "${XDG_RUNTIME_DIR}"
  chmod 700 "${XDG_RUNTIME_DIR}"
  exec dbus-run-session -- bash "$0" --inside-dbus
fi

for command in gst-launch-1.0 pactl pipewire pipewire-pulse pw-cli pw-loopback wireplumber; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "${command} is required for the Linux call E2E" >&2
    exit 1
  fi
done

node -e "require('dotenv').config({ path: 'test.env' }); if (process.env.MATRIX_E2E_ALLOW_VOICE?.toLowerCase() !== 'true') throw new Error('MATRIX_E2E_ALLOW_VOICE must be true')"

output_dir="${LINUX_CALL_E2E_OUTPUT_DIR:-test-results/linux-call}"
mkdir -p "${output_dir}"
export PULSE_SERVER="unix:${XDG_RUNTIME_DIR}/pulse/native"

pipewire >"${output_dir}/pipewire.log" 2>&1 &
pipewire_pid=$!
wireplumber >"${output_dir}/wireplumber.log" 2>&1 &
wireplumber_pid=$!
pipewire-pulse >"${output_dir}/pipewire-pulse.log" 2>&1 &
pipewire_pulse_pid=$!
loopback_pid=""
tone_pid=""

cleanup() {
  status=$?
  trap - EXIT
  [[ -z "${tone_pid}" ]] || kill "${tone_pid}" >/dev/null 2>&1 || true
  [[ -z "${loopback_pid}" ]] || kill "${loopback_pid}" >/dev/null 2>&1 || true
  kill "${pipewire_pulse_pid}" "${wireplumber_pid}" "${pipewire_pid}" >/dev/null 2>&1 || true
  exit "${status}"
}
trap cleanup EXIT

for _ in $(seq 1 100); do
  if pactl info >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
if ! pactl info >/dev/null 2>&1; then
  echo "PipeWire PulseAudio service did not become ready" >&2
  exit 1
fi

pw-loopback \
  --name=foxchat-linux-call-microphone \
  --capture-props="node.name=foxchat_linux_call_sink node.description=FoxChat_Linux_Call_Input media.class=Audio/Sink" \
  --playback-props="node.name=foxchat_linux_call_source node.description=FoxChat_Linux_Call_Microphone media.class=Audio/Source" \
  >"${output_dir}/microphone-loopback.log" 2>&1 &
loopback_pid=$!

for _ in $(seq 1 100); do
  if pactl list short sources | grep -q foxchat_linux_call_source; then
    break
  fi
  sleep 0.1
done
if ! pactl list short sources | grep -q foxchat_linux_call_source; then
  echo "PipeWire fake microphone source did not become ready" >&2
  exit 1
fi

pactl set-default-source foxchat_linux_call_source
pactl info >"${output_dir}/pulseaudio-info.txt"
pactl list short sources >"${output_dir}/microphone-sources.txt"
pw-cli ls Node >"${output_dir}/pipewire-nodes.txt"

gst-launch-1.0 -q \
  audiotestsrc is-live=true wave=sine freq=440 \
  ! audioconvert \
  ! audioresample \
  ! pulsesink device=foxchat_linux_call_sink \
  >"${output_dir}/microphone-tone.log" 2>&1 &
tone_pid=$!

export CI=true
export LINUX_SYSTEM_MIC_E2E=true
export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:4174}"
npx playwright test tests/e2e/live-matrix-voice.spec.ts \
  --project=matrix-live \
  --output="${output_dir}/playwright"
