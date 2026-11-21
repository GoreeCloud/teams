#!/usr/bin/env bash
# Package a synthetic or Flutter-built Linux release bundle. This does not sign
# the executable or certify installation on a real device.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: ci-linux-release-package.sh <bundle-dir> <private-output-dir>" >&2
  exit 2
fi
bundle="$1"
destination="$2"

[ -d "$bundle" ] || { echo "Flutter release bundle is missing" >&2; exit 1; }
[ -x "$bundle/goreecloud_teams" ] || { echo "Linux executable missing" >&2; exit 1; }
[ -f "$bundle/data/icudtl.dat" ] || { echo "ICU data missing" >&2; exit 1; }
[ -d "$bundle/data/flutter_assets" ] || { echo "Flutter assets missing" >&2; exit 1; }
[ -f "$bundle/lib/libflutter_linux_gtk.so" ] || {
  echo "Flutter Linux runtime library missing" >&2; exit 1;
}

source_path="$(realpath "$bundle")"
target_path="$(realpath -m "$destination")"
case "$target_path/" in
  "$source_path/"* ) echo "Output cannot be within the bundle" >&2; exit 1;;
esac
mkdir -p -m 0700 "$target_path"
[ -d "$target_path" ] || { echo "Output directory invalid" >&2; exit 1; }
[ "$(stat -c %a "$target_path")" = 700 ] || {
  echo "Release artifact directory must be private (0700)" >&2; exit 1;
}

archive="$target_path/goreecloud-teams-linux-x64-release-unsigned.tar.gz"
checksums="$target_path/SHA256SUMS"
if [ -e "$archive" ] || [ -L "$archive" ] || [ -e "$checksums" ] || [ -L "$checksums" ]; then
  echo "Refusing to replace an existing release artifact" >&2
  exit 1
fi

# Publish complete archives using a unique, private temp file and an atomic
# no-overwrite hard link. The source directory is read-only for this script.
temp="$(mktemp "$target_path/.gct-release-XXXXXXXX.tar.gz.part")"
trap 'rm -f "$temp"' EXIT
chmod 0600 "$temp"
tar -czf "$temp" -C "$(dirname "$source_path")" "$(basename "$source_path")"
test -s "$temp"
tar -tzf "$temp" > /dev/null
ln "$temp" "$archive"
rm -f "$temp"
trap - EXIT

# SHA256SUMS contains only the produced archive's fixed basename, not host
# paths, secrets, or operator configuration.
(
  cd "$target_path"
  ( set -C; sha256sum "$(basename "$archive")" > SHA256SUMS )
  sha256sum -c SHA256SUMS
)
echo "Unsigned Linux release bundle and SHA256SUMS verified"
