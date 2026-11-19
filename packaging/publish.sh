#!/usr/bin/env bash
# This is called only after the platform jobs validate the files from this exact source commit.
set -euo pipefail
[[ ${GITHUB_REPOSITORY:-} = ghahremany/yarvan-agent && ${GITHUB_REF:-} = refs/heads/main && ${GITHUB_EVENT_NAME:-} = workflow_dispatch ]]
version=$(python3 -c 'import json; print(json.load(open("packaging/version.json"))["version"])')
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+-beta\.[0-9]+$ ]]
tag="v$version"
base="Yarvan-$version"
artifacts=("$base-windows-x64-setup.exe" "$base-linux-amd64.deb" "$base-linux-x86_64.AppImage" "$base-android.apk" Yarvan-Android-Certificate.txt)
(cd release/yarvan && for file in "${artifacts[@]}"; do test -s "$file"; done && sha256sum "${artifacts[@]}" > SHA256SUMS.txt)
if git ls-remote --exit-code --tags "https://github.com/$GITHUB_REPOSITORY.git" "refs/tags/$tag" >/dev/null; then
  echo "Tag $tag already exists; not replacing a release." >&2
  exit 1
fi
asset_paths=()
for file in "${artifacts[@]}" SHA256SUMS.txt; do asset_paths+=("release/yarvan/$file"); done
gh release create "$tag" "${asset_paths[@]}" --repo "$GITHUB_REPOSITORY" --target "$GITHUB_SHA" --draft --prerelease --latest=false \
  --title "Yarvan $version — Installers" --notes-file "docs/yarvan/releases/$version.md"
gh release view "$tag" --repo "$GITHUB_REPOSITORY" --json assets | python3 -c 'import json,sys; assert {a["name"] for a in json.load(sys.stdin)["assets"] if a["size"] > 0} == set(sys.argv[1:])' "${artifacts[@]}" SHA256SUMS.txt
gh release edit "$tag" --repo "$GITHUB_REPOSITORY" --draft=false --prerelease --latest=false
