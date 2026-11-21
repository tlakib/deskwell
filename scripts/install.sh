#!/usr/bin/env bash
# DeskWell installer for macOS.
#   curl -fsSL https://raw.githubusercontent.com/tlakib/deskwell/main/scripts/install.sh | bash
# Optional: also download the Chrome extension to ~/DeskWell/chrome-extension
#   curl -fsSL https://raw.githubusercontent.com/tlakib/deskwell/main/scripts/install.sh | bash -s -- --chrome
# Made by Md Ashik Ali - https://www.linkedin.com/in/mdashikali/ - MIT license.
set -euo pipefail
REPO="tlakib/deskwell"
[ "$(uname)" = "Darwin" ] || { echo "This script is for macOS. On Windows use install.ps1 (see README)."; exit 1; }

case "$(uname -m)" in arm64) ARCH="aarch64" ;; *) ARCH="x64" ;; esac
echo "DeskWell installer (macOS, $ARCH)"
# Find the latest version from the Releases page redirect (no GitHub API, so no API rate limit).
LATEST=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")
TAG="${LATEST##*/tag/}"
case "$TAG" in v[0-9]*) ;; *) echo "Could not find the latest release. Download it from https://github.com/$REPO/releases/latest"; exit 1 ;; esac
VERSION="${TAG#v}"
BASE="https://github.com/$REPO/releases/download/$TAG"
DMG_URL="$BASE/DeskWell_${VERSION}_${ARCH}.dmg"

TMP=$(mktemp -d)
trap 'hdiutil detach "$TMP/mnt" -quiet 2>/dev/null || true; rm -rf "$TMP"' EXIT
echo "Downloading $(basename "$DMG_URL")..."
curl -fL --progress-bar "$DMG_URL" -o "$TMP/DeskWell.dmg"
hdiutil attach "$TMP/DeskWell.dmg" -mountpoint "$TMP/mnt" -nobrowse -quiet
APP=$(find "$TMP/mnt" -maxdepth 1 -name "*.app" | head -1)
pkill -x DeskWell 2>/dev/null || true
rm -rf "/Applications/$(basename "$APP")"
cp -R "$APP" /Applications/
# The build isn't notarized: clear the download quarantine flag so macOS lets it open.
xattr -dr com.apple.quarantine "/Applications/$(basename "$APP")" 2>/dev/null || true
open "/Applications/$(basename "$APP")"
echo "DeskWell $VERSION installed in /Applications and started. Look for the icon in the menu bar."

if [ "${1:-}" = "--chrome" ]; then
  DEST="$HOME/DeskWell/chrome-extension"
  curl -fsSL "$BASE/deskwell-extension-$VERSION.zip" -o "$TMP/ext.zip"
  rm -rf "$DEST" && mkdir -p "$DEST" && unzip -q "$TMP/ext.zip" -d "$DEST"
  echo "Chrome extension saved to $DEST"
  echo "In Chrome: open chrome://extensions, turn on Developer mode, click 'Load unpacked' and pick that folder."
fi
