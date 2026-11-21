# Architecture

DeskWell is a pnpm monorepo with one shared TypeScript domain, one shared React UI and two platform shells.

```
packages/domain  ── models (zod), schedule rules, messages, progress, backup format, sync rules, voice-pack paths
packages/ui      ── React UI (tray panel, reminder popup, dashboard) talking to a `Backend` port
apps/desktop     ── Tauri 2: Rust engine + SQLite + tray/menu bar; implements Backend with Tauri commands
apps/extension   ── Chrome MV3: service worker engine + chrome.storage + IndexedDB; implements Backend directly
```

The suggested `packages/voice` and `packages/sync` from the brief were folded into `packages/domain/src/voice.ts`
and `packages/domain/src/sync.ts` (plus `packages/ui/src/voice.ts` for playback). They are small, and keeping them in
one package avoids duplicated types.

## Scheduler

The rules live in `packages/domain/src/schedule.ts` and are ported 1:1 to Rust in
`apps/desktop/src-tauri/src/schedule.rs`. Both are tested against the same fixture file
`packages/domain/fixtures/schedule-cases.json` (33 cases), so the desktop app and the extension behave the same.

- **Wall-clock rules.** A reminder is "every 30 minutes from 09:00 to 17:00 on weekdays", evaluated in the device's
  current IANA timezone each time. Nothing stores a fixed UTC instant for recurring reminders, so travel and DST don't
  cause drift.
- **Interval anchoring.** Interval occurrences are `windowStart + k × interval ≤ windowEnd`. A window that ends earlier
  than it starts crosses midnight and belongs to the day it started (night shifts).
- **Effective window.** The reminder's own window; otherwise the active work profile (its days, minus its breaks) if
  "only during work hours" is on; otherwise the whole day.
- **DST.** A local time inside a spring-forward gap moves forward by the gap; an ambiguous fall-back time resolves to
  the later instant (Luxon's behaviour, mirrored in Rust).
- **Blocking and deferral** (`candidateFor`): disabled / paused / "not today" / quiet hours / snooze (with *wait* or
  *keep* policy) / focus (normal reminders skipped, important ones held until focus ends; meeting mode can hold all).
- **Grouping.** Reminders due within 60 s of each other are delivered together.
- **No backlog.** The engine always plans from `now − 90 s`. After sleep or a closed browser, missed occurrences are
  skipped (or summarized once, if the user picked that) and the schedule continues from the present.
- **Exactly once.** Every occurrence has a stable id `reminderId@utcISO` (snoozes: `reminderId@snooze@until`). It is
  recorded in the occurrences table with a unique key before delivery; a second tick for the same occurrence is a no-op.

## Desktop (Tauri 2)

- `engine.rs`: a background thread loops `tick()`; it sleeps until the next planned instant (max 60 s) on a `Condvar`
  that commands `poke()` after any change. Each tick re-reads the system timezone, so timezone/clock changes and
  wake-from-sleep are picked up within a minute.
- `db.rs`: SQLite (bundled `rusqlite`) with a versioned migration list (`schema_migrations` table), WAL, foreign keys,
  transactional import, and unique constraints for occurrences and events.
- `lib.rs`: tray icon + menu (Open, Pause, Resume, Focus 25 min, Test voice, Settings, Exit), left-click panel window
  positioned at the tray, hide-on-close for the dashboard, single-instance, optional autostart (`--minimized`),
  native notifications, macOS accessory activation policy (menu-bar app, no Dock icon).
- Windows: `main` (dashboard, hidden at start; it stays alive and plays voice), `panel` (frameless, always on top,
  hides on blur) and `popup` (reminder popup at the chosen corner).
- Audio uploads go through a raw-body IPC call, are sniffed by magic bytes (not just extension), limited to 15 MB and
  written atomically into the app data folder.

## Chrome extension (MV3)

- `sw.ts` registers all listeners at top level (MV3 requirement). Scheduling uses `chrome.alarms`: one alarm at the
  next planned instant plus a 1-minute heartbeat recreated on install/startup, so a suspended service worker always
  wakes up. `engine.ts` serializes ticks in a promise chain.
- Settings, reminders, templates and runtime state are in `chrome.storage.local` (shared and observable by every
  context). History and audio are in IndexedDB (`db.ts`, versioned upgrades). Pages write data directly through
  `core.ts`; the service worker reacts to `storage.onChanged` and replans.
- Delivery: Chrome notification with Done / Snooze buttons, a small DeskWell popup window, and voice. Pack clips and
  uploaded audio play in an offscreen document (`AUDIO_PLAYBACK`); text-to-speech uses `chrome.tts`.
- Permissions: `alarms, storage, notifications, idle, tts, offscreen`. No host permissions, no content scripts.

## Voice

Priority per reminder: bundled pack clip → (on failure) system TTS; uploaded audio → system TTS; or TTS directly.
Playback is queued, never overlapping, and can be stopped at once. The UI never guesses a voice's gender: system voices
are listed by name and language only; the bundled packs are labelled because we recorded them.
A `TtsProvider` interface exists for an optional cloud provider later; none is enabled, and the UI says so.
