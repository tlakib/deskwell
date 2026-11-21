# Test plan

## Automated (run on every push by `.github/workflows/ci.yml`)

| Area | Where | What is covered |
|---|---|---|
| Schedule rules (TS) | `packages/domain/test/schedule.test.ts` + `fixtures/schedule-cases.json` | intervals anchored to window start, weekdays/weekends, work profile + lunch break, own window, night shift across midnight, DST gap and overlap (Europe/Berlin, America/New_York), other timezones, daily times, once, dates, start/end dates, quiet hours, pause (timed + indefinite), snooze wait/keep, mute today, focus skip vs important deferral, meeting hold-all, disabled, delivered dedupe, grouping, no backlog |
| Schedule rules (Rust) | `apps/desktop/src-tauri/src/schedule.rs` tests | the same 33 fixtures + grouping/no-backlog |
| Misc domain | `packages/domain/test/misc.test.ts` | message picking, day summaries, water formatting, backup seal/parse/tamper detection, sync conflict resolution, audio sniffing, pack paths |
| Engine | `apps/desktop/src-tauri/src/engine.rs` tests | a due reminder is delivered exactly once and a shell that touches the database cannot deadlock the engine |
| SQLite | `apps/desktop/src-tauri/src/db.rs` tests | schema at latest version, upgrade v1→v2, occurrence recorded once, invalid reminder rejected, atomic import, rollback on error, audio reference check, water validation/undo |
| Extension | `apps/extension/test/engine.test.ts` (fake IndexedDB + chrome mock) | no early delivery, exactly-once under repeated ticks, no backlog after Chrome was closed, snooze, pause, validation keeps old data, water undo, non-audio upload refused, audio in use can't be deleted, import validates before writing |
| Types/builds | CI | `tsc` for all packages, desktop and extension production builds |

## Results

2026-11-21, Linux container (Node 22, Rust 1.97):

- domain: **55/55 passed**
- extension: **9/9 passed** (repeated 15 times to check for flakiness after fixing a same-millisecond water undo bug)
- Rust: **11/11 passed**
- Desktop release binary smoke test on Linux/Xvfb: launch, defaults, on-time delivery, popup, Done → history: **pass**
- typecheck + builds: **pass**

## Manual checklist (to run on real hardware before each release)

| # | Check | Windows | macOS | Chrome |
|---|---|---|---|---|
| 1 | Install, launch, icon appears in tray / menu bar / toolbar | ☐ | ☐ | ☐ |
| 2 | Left-click opens panel; right-click menu items all work | ☐ | ☐ | n/a |
| 3 | Closing dashboard hides it; Exit quits | ☐ | ☐ | n/a |
| 4 | Create, edit, disable, delete a reminder | ☐ | ☐ | ☐ |
| 5 | 1-minute test reminder shows popup + notification + voice | ☐ | ☐ | ☐ |
| 6 | Done / Snooze / Skip / Not today persist and appear in History | ☐ | ☐ | ☐ |
| 7 | Pause, Resume, Focus 25 | ☐ | ☐ | ☐ |
| 8 | Upload an MP3, assign it, it plays | ☐ | ☐ | ☐ |
| 9 | Change system timezone: notice appears, local times kept | ☐ | ☐ | ☐ |
| 10 | Sleep 15 min: no burst of old reminders on wake | ☐ | ☐ | ☐ |
| 11 | Quit and reopen: settings and history kept | ☐ | ☐ | ☐ |
| 12 | Works with Wi-Fi off | ☐ | ☐ | ☐ |
| 13 | Export backup, restore it on the other platform | ☐ | ☐ | ☐ |
| 14 | Start at login toggle | ☐ | ☐ | n/a |

Not yet run on Windows/macOS hardware; installers are produced by the Release workflow on GitHub's Windows and macOS runners.
