#!/usr/bin/env bash
# The beta signing secret exists only in the repository's trusted main-branch release job.
set -euo pipefail
umask 077
root=$(cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
sdk=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
: "${sdk:?Set ANDROID_SDK_ROOT or ANDROID_HOME.}"
tools="$sdk/build-tools/35.0.1"
version=$(python3 -c 'import json; print(json.load(open("packaging/version.json"))["version"])')
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
python3 - "$work" <<'PY'
import base64, json, os, sys
from pathlib import Path
value = os.environ.get("YARVAN_ANDROID_SIGNING")
if not value:
    raise SystemExit("The YARVAN_ANDROID_SIGNING repository secret is required; refusing to make a replaceable debug APK.")
try:
    data = json.loads(value)
    key = base64.b64decode(data["pkcs12"], validate=True)
    password = data["password"]
    if not key or not password or not password.isalnum():
        raise ValueError("invalid signing input")
except (KeyError, TypeError, ValueError):
    raise SystemExit("Invalid Android signing secret format.") from None
root = Path(sys.argv[1])
(root / 'signing.p12').write_bytes(key)
# apksigner consumes a separate line for each password read from a file source.
# PKCS#12 uses the same password for both but the file readers must be distinct.
for kind in ('store', 'key'):
    (root / (kind + '-pass')).write_text(password + '\n')
PY
unset YARVAN_ANDROID_SIGNING
out="release/yarvan/Yarvan-$version-android.apk"
"$tools/apksigner" sign --ks "$work/signing.p12" --ks-type PKCS12 --ks-key-alias yarvan-beta \
  --ks-pass "file:$work/store-pass" --key-pass "file:$work/key-pass" \
  --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled true --v4-signing-enabled false \
  --out "$out" "release/yarvan/Yarvan-$version-android.unsigned.apk"
"$tools/apksigner" verify --verbose --print-certs "$out" > "$work/signature.txt"
"$tools/zipalign" -c 4 "$out"
actual=$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$work/signature.txt")
expected=$(cat packaging/android/signing-cert.sha256)
[[ $actual =~ ^[0-9a-f]{64}$ && $actual = "$expected" ]] || { echo 'Unexpected Android signing identity.' >&2; exit 1; }
printf 'Yarvan Android beta signing certificate\nSHA-256: %s\n' "$actual" > release/yarvan/Yarvan-Android-Certificate.txt
printf 'APK signature and signing certificate verified.\n'
