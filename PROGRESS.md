# Progress

## 2026-11-21

### Done
- Monorepo, shared domain (schedule/DST/timezone rules, defaults incl. Bangla messages, backup, sync rules).
- 40 bundled voice clips via ElevenLabs: Akib (author's own voice, male) and Rimjhim (female), Bangla + English, 10 categories.
- Desktop (Tauri 2.12): Rust engine thread, SQLite with migrations, tray/menu bar + menu, panel, popup, native
  notifications, autostart, single instance, audio import, backup files.
- Shared React UI: panel, popup, dashboard (Overview, Reminders, Schedule, Water, Movement, Eye Care, Voice Studio,
  Focus & Breaks, History & Analytics, Settings with credits, Backup & Sync).
- Chrome MV3 extension sharing the same UI and domain.
- CI (tests, typecheck, builds, cargo test) and Release workflow (Windows, macOS arm64 + x64, Chrome zip).
- Docs, MIT license, credits ("Made by Md Ashik Ali", LinkedIn) in README, app About and extension.

### Commands run (all passing)
```
pnpm install
pnpm typecheck                                  # all packages
pnpm test                                       # domain 55 passed, extension 9 passed
cargo test (apps/desktop/src-tauri)             # 11 passed
pnpm --filter @deskwell/desktop build           # vite production build
pnpm build:ext                                  # extension dist + zip
pnpm tauri build --no-bundle (Linux)            # release binary compiles
```

### Live smoke test (Linux release binary under Xvfb)
First launch writes defaults (7 reminders, 30 messages); a reminder due one minute later was delivered at :00,
the popup appeared bottom-right, clicking **Done** recorded a `done` event, hid the popup and updated Overview.

### Bugs found and fixed
- Tauri crate / plugin version mismatch (tauri-runtime 2.12 vs tauri 2.9) → aligned on Tauri 2.12 (Rust + JS).
- Engine froze on the first delivery: the tray shell re-locked the database while the engine held it → shell calls
  are now buffered and run after the lock is released (regression test `delivers_without_deadlock_and_only_once`).
- First launch could leave a partial settings record (engine wrote `lastSeenTimeZone` before defaults existed) →
  engine waits for real settings; `init_defaults` replaces a partial record.
- Reminder popup was placed off-screen when hidden windows report size 0 → popup is positioned from the monitor's
  work area.
- Water "undo last" removed the wrong entry when two were added in the same millisecond → insertion order tie-break
  (extension) and `rowid` tie-break (SQLite).

### Blockers / not verified
- No Windows or macOS hardware in the build environment: installers come from GitHub Actions runners; the manual
  checklist in docs/TEST_PLAN.md is still open.
- Desktop idle detection not implemented (setting is labelled as such in the UI).
- Cloud TTS and cloud sync intentionally not shipped (labelled "Not configured" / "Local only").
