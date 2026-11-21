# Data model

Source of truth: zod schemas in `packages/domain/src/types.ts` (Rust mirrors in `apps/desktop/src-tauri/src/model.rs`).

| Entity | Key fields |
|---|---|
| Reminder | id, name, category, messages[], randomMessage, language, enabled, schedule{type interval/daily/once/dates, intervalMinutes, times[], days[], dates[], onceAt, window, useWorkHours, startDate, endDate}, delivery (popup_voice/popup/voice/silent/disabled), voice{mode pack/tts/audio/none, packId, profileId, audioIds[], randomAudio, volume}, snoozeOptions[], snoozePolicy, priority, respectQuietHours, group, pauseInFocus, createdAt, updatedAt, revision |
| Settings | language, theme, timeFormat, weekStart, workEnabled, activeProfileId, profiles[] (days, start, end, breaks[]), quietHours[], nativeNotifications, popupSeconds, popupPosition, masterVolume, voiceProfiles[], catchUp, focusDefaults, idlePolicy, idleMinutes, water{goalMl, unit, glassMl, containers}, autoBackup, lastSeenTimeZone, onboarded |
| MessageTemplate | id, category, language, text, order, builtIn |
| RuntimeState | pausedUntil (null / "indefinite" / ISO), focus, snoozes{reminderId: ISO}, mutedToday{reminderId: date} |
| ReminderEvent | id, occurrenceId, reminderId, category, action (delivered/done/snoozed/skipped/muted_today/missed/dismissed), scheduledAt, at, timeZone, detail |
| WaterEntry | id, ml, at, timeZone |
| FocusSession | id, kind, startedAt, endsAt, endedAt |
| VoiceAsset | id, name, category, mime, bytes, durationSec, createdAt (+ file on disk / Blob in IndexedDB) |

All instants are stored as UTC ISO strings together with the timezone they happened in, so history stays correct after
travel. Local dates (`YYYY-MM-DD`) and wall-clock times (`HH:MM`) are used only for rules.

## Desktop SQLite

Tables: `app_settings` (key → JSON: settings, state), `reminders`, `message_templates`, `reminder_occurrences`
(primary key = occurrence id), `reminder_events` (UNIQUE(occurrence_id, action)), `water_entries`, `focus_sessions`,
`voice_assets`, `sync_metadata`, `daily_summaries`.

Migrations are an ordered list in `db.rs`; a `schema_migrations` table records applied versions and each migration runs
in a transaction. v1 = base schema, v2 = event time index + daily summaries table. Tests cover a fresh database and an
upgrade from v1.

## Extension storage

`chrome.storage.local`: `settings`, `reminders`, `templates`, `state`, `active`, `lastTickAt`, `waterOrder`, `touchedAt`.
IndexedDB `deskwell` v1: `events` (index `at`, unique `[occurrenceId, action]`), `occurrences`, `water`, `focus`, `audio`.

## Backup format

```json
{ "format": "deskwell-backup", "version": 1, "createdAt": "…", "app": "DeskWell 0.1.0", "platform": "desktop",
  "settings": {…}, "reminders": […], "templates": […], "history": {"events": […], "water": […], "focus": […]} | null,
  "audio": [{…asset, "dataBase64": "…"}] | null, "checksum": "<sha-256 of canonical JSON without checksum>" }
```

Restore: parse → zod validation → checksum check → preview (counts) → user confirms → **safety backup of current data**
→ audio import → one atomic write of settings/reminders/templates/history. A broken file never touches existing data.
The same file works in both the desktop app and the extension.

## Sync rules (for a future opt-in provider)

`packages/domain/src/sync.ts`: records merge by `revision`, then `updatedAt`, then id (deterministic); events are
append-only and merged by id. No provider ships in this version.
