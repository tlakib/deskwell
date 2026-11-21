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
JSON=$(curl -fsSL -H "User-Agent: deskwell-installer" "https://api.github.com/repos/$REPO/releases/latest")
url_for() { echo "$JSON" | grep -o "\"browser_download_url\": *\"[^\"]*$1\"" | head -1 | sed 's/.*"\(https[^"]*\)"/\1/'; }
DMG_URL=$(url_for "_${ARCH}.dmg")
[ -n "$DMG_URL" ] || { echo "No macOS ($ARCH) build found in the latest release."; exit 1; }

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
echo "DeskWell installed in /Applications and started. Look for the icon in the menu bar."

if [ "${1:-}" = "--chrome" ]; then
  ZIP_URL=$(url_for "deskwell-extension-[0-9.]*\.zip" || true)
  if [ -n "$ZIP_URL" ]; then
    DEST="$HOME/DeskWell/chrome-extension"
    curl -fsSL "$ZIP_URL" -o "$TMP/ext.zip"
    rm -rf "$DEST" && mkdir -p "$DEST" && unzip -q "$TMP/ext.zip" -d "$DEST"
    echo "Chrome extension saved to $DEST"
    echo "In Chrome: open chrome://extensions, turn on Developer mode, click 'Load unpacked' and pick that folder."
  fi
fi
