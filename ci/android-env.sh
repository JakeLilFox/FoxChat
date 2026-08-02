#!/usr/bin/env bash

export JAVA_HOME=/opt/jdk21
export ANDROID_HOME=/opt/android-sdk
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_NDK_VERSION=29.0.13846066
export NDK_HOME="$ANDROID_HOME/ndk/$ANDROID_NDK_VERSION"
export ANDROID_NDK_HOME="$NDK_HOME"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$PWD/.gradle-ci}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$HOME/.local/bin:$PATH"

