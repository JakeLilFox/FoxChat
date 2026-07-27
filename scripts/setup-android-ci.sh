#!/usr/bin/env bash
set -euo pipefail

if [[ -d "/usr/lib/jvm/java-17-openjdk-amd64" ]]; then
  export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
else
  JAVA17_BIN="$(update-alternatives --list javac 2>/dev/null | grep '/java-17-' | head -n 1 || true)"
  if [[ -z "$JAVA17_BIN" ]]; then
    echo "OpenJDK 17 was not found. Install openjdk-17-jdk before running this script." >&2
    return 1 2>/dev/null || exit 1
  fi
  export JAVA_HOME="$(dirname "$(dirname "$JAVA17_BIN")")"
fi
export GRADLE_USER_HOME="$PWD/.gradle-ci"
export ANDROID_HOME="${ANDROID_HOME:-$PWD/.android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_NDK_VERSION="29.0.13846066"
export NDK_HOME="$ANDROID_HOME/ndk/$ANDROID_NDK_VERSION"
export ANDROID_NDK_HOME="$NDK_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
if [[ ! -x "$SDKMANAGER" ]]; then
  TOOLS_ARCHIVE="$PWD/.android-command-line-tools.zip"
  TOOLS_EXTRACT="$PWD/.android-command-line-tools"
  mkdir -p "$ANDROID_HOME/cmdline-tools/latest" "$TOOLS_EXTRACT"
  curl --fail --location --retry 3 \
    "https://static.jakefox.de/commandlinetools-linux-14742923_latest.zip" \
    --output "$TOOLS_ARCHIVE"
  unzip -q -o "$TOOLS_ARCHIVE" -d "$TOOLS_EXTRACT"
  cp -R "$TOOLS_EXTRACT/cmdline-tools/." "$ANDROID_HOME/cmdline-tools/latest/"
fi

yes | "$SDKMANAGER" --sdk_root="$ANDROID_HOME" --licenses >/dev/null || true
"$SDKMANAGER" --sdk_root="$ANDROID_HOME" \
  "platform-tools" \
  "platforms;android-36" \
  "build-tools;36.0.0" \
  "ndk;$ANDROID_NDK_VERSION"

echo "Android SDK: $ANDROID_HOME"
echo "Android NDK: $NDK_HOME"
echo "Java: $($JAVA_HOME/bin/java -version 2>&1 | head -n 1)"
