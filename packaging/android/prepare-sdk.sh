#!/usr/bin/env bash
# Bootstrap a private Linux SDK; no dependency on the hosted image's sdkmanager.
set -euo pipefail
[[ $(uname -s)/$(uname -m) == Linux/x86_64 ]] || { echo 'Use the Android 35 SDK and Build Tools 35.0.1 for your host.' >&2; exit 1; }
sdk=${1:?Pass a fresh SDK directory path.}
mkdir -p -- "$(dirname -- "$sdk")"
mkdir -- "$sdk"
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
fetch() {
  curl --proto '=https' --fail --silent --show-error --location --retry 3 "https://dl.google.com/android/repository/$1" -o "$stage/$1"
  printf '%s  %s\n' "$2" "$stage/$1" | sha256sum -c -
}
# SHA-256 values of the Google SDK archives pinned in this recipe.
fetch platform-35_r02.zip 0988cacad01b38a18a47bac14a0695f246bc76c1b06c0eeb8eb0dc825ab0c8e0
fetch build-tools_r35.0.1_linux.zip 5993499f3229a021b89f87088c57242aeefaa62316bf3d69da7de40bfd5350f1
mkdir -p -- "$sdk/platforms" "$sdk/build-tools"
unzip -q "$stage/platform-35_r02.zip" -d "$stage/platform"
unzip -q "$stage/build-tools_r35.0.1_linux.zip" -d "$stage/tools"
platform=("$stage/platform"/*)
tools=("$stage/tools"/*)
[[ ${#platform[@]} == 1 && ${#tools[@]} == 1 && -f ${platform[0]}/android.jar && -x ${tools[0]}/aapt2 ]]
mv -- "${platform[0]}" "$sdk/platforms/android-35"
mv -- "${tools[0]}" "$sdk/build-tools/35.0.1"
