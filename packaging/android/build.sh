#!/usr/bin/env bash
# Compile the dependency-free Java/Android shell with the pinned platform SDK.
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
sdk=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
: "${sdk:?Set ANDROID_SDK_ROOT or ANDROID_HOME.}"
: "${JAVA_HOME:?Set JAVA_HOME to JDK 17+.}"
tools="$sdk/build-tools/35.0.1"
sdk_jar="$sdk/platforms/android-35/android.jar"
parent="$root/packaging/android"
version=$(python3 -c 'import json; print(json.load(open("packaging/version.json"))["version"])')
code=$(python3 -c 'import json; print(json.load(open("packaging/version.json"))["androidVersionCode"])')
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.]+)?$ && $code =~ ^[1-9][0-9]*$ ]]
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
out="$root/release/yarvan"
mkdir -p "$work"/{res/drawable-nodpi,assets,gen,classes,dex,tests} "$out"
cp -R "$parent/res/." "$work/res/"
cp public/app-icon-192.png "$work/res/drawable-nodpi/yarvan_icon.png"
cp LICENSE NOTICE UPSTREAM.md "$work/assets/"
"$tools/aapt2" compile --dir "$work/res" -o "$work/res.zip"
"$tools/aapt2" link -I "$sdk_jar" --manifest "$parent/AndroidManifest.xml" -A "$work/assets" --java "$work/gen" \
  --min-sdk-version 26 --target-sdk-version 35 --version-code "$code" --version-name "$version" -o "$work/app.apk" "$work/res.zip"
src="$parent/src/io/github/ghahremany/yarvan/companion"
"$JAVA_HOME/bin/javac" -d "$work/tests" "$src/WorkspaceUrl.java" "$parent/WorkspaceUrlTest.java"
"$JAVA_HOME/bin/java" -cp "$work/tests" io.github.ghahremany.yarvan.companion.WorkspaceUrlTest
mapfile -d '' sources < <(find "$parent/src" "$work/gen" -name '*.java' -print0)
"$JAVA_HOME/bin/javac" -encoding UTF-8 -source 8 -target 8 -bootclasspath "$sdk_jar:$tools/core-lambda-stubs.jar" -d "$work/classes" "${sources[@]}"
"$JAVA_HOME/bin/jar" cf "$work/classes.jar" -C "$work/classes" .
"$tools/d8" --lib "$sdk_jar" --min-api 26 --release --output "$work/dex" "$work/classes.jar"
(cd "$work/dex" && zip -q "$work/app.apk" classes.dex)
"$tools/zipalign" -f 4 "$work/app.apk" "$out/Yarvan-$version-android.unsigned.apk"
"$tools/aapt" dump badging "$out/Yarvan-$version-android.unsigned.apk" > "$work/badging.txt"
grep -F "package: name='io.github.ghahremany.yarvan.companion' versionCode='$code' versionName='$version'" "$work/badging.txt"
grep -F "sdkVersion:'26'" "$work/badging.txt"
grep -F "targetSdkVersion:'35'" "$work/badging.txt"
grep -F "launchable-activity: name='io.github.ghahremany.yarvan.companion.MainActivity'" "$work/badging.txt"
