# Implementation plan

| Phase | Scope | Status |
|---|---|---|
| 0 | Inspect environment, choose stack (Tauri 2 + React/TS/Vite/Tailwind, Chrome MV3, pnpm monorepo) | done |
| 1 | Shared domain: models, validation, schedule engine, DST/timezone rules, fixtures. Desktop MVP: Rust engine port, SQLite + migrations, tray/menu bar, panel, popup, notifications, commands | done (Windows hardware verification pending) |
| 2 | Voice Studio: bundled ElevenLabs packs (Akib male, Rimjhim female; bn/en), system voices, uploads, message library; full reminder editor | done |
| 3 | Chrome extension: service worker + alarms, notifications with actions, popup window, offscreen audio, IndexedDB, tests | done (manual Chrome check pending) |
| 4 | macOS: menu-bar accessory app, dmg builds via GitHub Actions (Apple Silicon + Intel), signing docs | CI configured; hardware verification pending |
| 5 | Backup/restore with checksum and safety copy, auto backups, history & CSV, sync interface (local-only), docs, release workflow | done; cloud sync deferred |

## Next

1. Run the manual checklist in `docs/TEST_PLAN.md` on Windows, macOS and Chrome.
2. Desktop idle detection (per-OS APIs) to match the extension's idle policy.
3. Optional cloud TTS provider behind the existing `TtsProvider` interface, with the user's own key.
4. Code signing for Windows and notarization for macOS when certificates are available.
5. Opt-in sync provider using `packages/domain/src/sync.ts` rules.
