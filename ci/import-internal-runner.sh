#!/usr/bin/env bash
set -euo pipefail

image_name="${1:-build-container-tauri:latest}"
checkout_dir="$(realpath "$PWD")"

if [[ "$checkout_dir" == "/" ]]; then
  echo "Refusing to snapshot the runner from /" >&2
  exit 1
fi

checkout_exclude=".${checkout_dir}"
runner_cmd="$(python3 -c 'import json; print(json.dumps([part.decode() for part in open("/proc/1/cmdline", "rb").read().split(b"\0") if part]))')"

if [[ "$runner_cmd" == "[]" ]]; then
  echo "Could not determine the internal runner command" >&2
  exit 1
fi

echo "Importing the internal CI runner filesystem as ${image_name}"
sudo tar \
  --numeric-owner \
  --acls \
  --xattrs \
  --one-file-system \
  --exclude="$checkout_exclude" \
  --exclude='./dev' \
  --exclude='./proc' \
  --exclude='./sys' \
  --exclude='./run' \
  --exclude='./tmp' \
  --exclude='./mnt' \
  --exclude='./media' \
  --exclude='./workspace' \
  --exclude='./var/lib/docker' \
  --exclude='./var/log' \
  --exclude='./root/.cache' \
  --exclude='./root/.docker' \
  --exclude='./root/.ssh' \
  --exclude='./home/ubuntu1/.cache' \
  --exclude='./home/ubuntu1/.docker' \
  --exclude='./home/ubuntu1/.ssh/id_*' \
  -C / -cf - . \
  | sudo docker import \
      --change 'ENV PATH=/home/ubuntu1/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
      --change 'WORKDIR /workspace' \
      --change 'EXPOSE 22' \
      --change "CMD ${runner_cmd}" \
      - "$image_name"

sudo docker image inspect "$image_name" >/dev/null
