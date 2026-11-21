# Releasing

1. Bump the version in `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml`,
   `apps/extension/public/manifest.json`, `packages/domain/src/brand.ts` and the root `package.json`.
2. Commit, then `git tag v0.1.1 && git push --tags`.
3. The **Release** workflow builds:
   - Windows `.msi` and NSIS `-setup.exe` on `windows-latest`,
   - macOS `.app`/`.dmg` for Apple Silicon and Intel on `macos-latest`,
   - the Chrome extension zip on `ubuntu-latest`,
   and attaches everything to the GitHub Release for that tag.

## Signing (optional)

Builds are unsigned by default; nothing fake is added. To sign and notarize macOS builds, add these repository secrets:
`APPLE_CERTIFICATE` (base64 .p12 Developer ID Application), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
`APPLE_ID`, `APPLE_PASSWORD` (app-specific password), `APPLE_TEAM_ID`. tauri-action picks them up automatically.

Windows code signing needs a code-signing certificate; see https://v2.tauri.app/distribute/sign/windows/.

## Chrome Web Store

Upload `deskwell-extension-<version>.zip` from the release. Permission justifications: alarms (schedule), storage
(settings), notifications (reminders), idle (optional idle policy), tts (spoken reminders), offscreen (play voice clips).
