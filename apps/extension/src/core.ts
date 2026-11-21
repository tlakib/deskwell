import {
  MessageTemplateSchema,
  ReminderSchema,
  RuntimeStateSchema,
  SettingsSchema,
  localDate,
  nextLocalMidnight,
  nowIso,
  planNext,
  startOfLocalDay,
  systemTimeZone,
  toIso,
  uuid,
  type MessageTemplate,
  type Reminder,
  type RuntimeState,
  type Settings,
  type VoiceAsset,
} from "@deskwell/domain";
import type { ActiveDelivery, ExportedData, History, Snapshot } from "@deskwell/ui";
import { addEvent, db, deliveredSince, focusRange, range } from "./db";

/**
 * Shared data operations for every extension context (service worker, popup, options, reminder window).
 * Writes go to chrome.storage.local / IndexedDB; the service worker reacts to storage changes and replans.
 */

type Kv = { settings?: Settings; reminders?: Reminder[]; templates?: MessageTemplate[]; state?: RuntimeState; active?: ActiveDelivery | null };

export async function kvGet(): Promise<Kv> {
  return (await chrome.storage.local.get(["settings", "reminders", "templates", "state", "active"])) as Kv;
}
async function kvSet(v: Kv) {
  await chrome.storage.local.set(v);
}

export function emptyState(): RuntimeState {
  return RuntimeStateSchema.parse({});
}

export async function getState(): Promise<RuntimeState> {
  const { state } = await kvGet();
  return state ?? emptyState();
}

export async function updateState(fn: (s: RuntimeState) => void): Promise<RuntimeState> {
  const s = structuredClone(await getState());
  fn(s);
  await kvSet({ state: s });
  return s;
}

export const GRACE_MS = 90_000;

export async function snapshot(): Promise<Snapshot> {
  const kv = await kvGet();
  const zone = systemTimeZone();
  const settings = kv.settings as Settings;
  const reminders = kv.reminders ?? [];
  const state = kv.state ?? emptyState();
  let next: Snapshot["next"] = null;
  if (settings) {
    const now = Date.now();
    const delivered = await deliveredSince(toIso(now - 2 * 86_400_000));
    const plan = planNext(reminders, now - GRACE_MS, { zone, settings }, state, (id) => delivered.has(id));
    if (plan)
      next = {
        at: toIso(plan.at),
        items: plan.items.map((i) => {
          const r = reminders.find((x) => x.id === i.reminderId);
          return { reminderId: i.reminderId, occurrenceId: i.occurrenceId, name: r?.name ?? "", category: r?.category ?? "custom" };
        }),
      };
  }
  return { platform: "extension", timeZone: zone, settings, reminders, templates: kv.templates ?? [], state, next, active: kv.active ?? null };
}

export async function initDefaults(settings: Settings, reminders: Reminder[], templates: MessageTemplate[]): Promise<boolean> {
  const kv = await kvGet();
  if (kv.settings) return false;
  await kvSet({ settings: SettingsSchema.parse(settings), reminders: reminders.map((r) => ReminderSchema.parse(r)), templates, state: emptyState(), active: null });
  return true;
}

export async function saveSettings(s: Settings) {
  await kvSet({ settings: SettingsSchema.parse(s) });
}

export async function saveReminder(r: Reminder) {
  const valid = ReminderSchema.parse(r);
  const list = (await kvGet()).reminders ?? [];
  const i = list.findIndex((x) => x.id === valid.id);
  if (i >= 0) list[i] = valid;
  else list.push(valid);
  await kvSet({ reminders: list });
}

export async function deleteReminder(id: string) {
  const list = (await kvGet()).reminders ?? [];
  await kvSet({ reminders: list.filter((r) => r.id !== id) });
  await updateState((s) => {
    delete s.snoozes[id];
    delete s.mutedToday[id];
  });
}

export async function saveTemplate(t: MessageTemplate) {
  const v = MessageTemplateSchema.parse(t);
  const list = (await kvGet()).templates ?? [];
  const i = list.findIndex((x) => x.id === v.id);
  if (i >= 0) list[i] = v;
  else list.push(v);
  await kvSet({ templates: list });
}

export async function deleteTemplate(id: string) {
  await kvSet({ templates: ((await kvGet()).templates ?? []).filter((t) => t.id !== id) });
}

export async function setPause(until: string | null) {
  if (until && until !== "indefinite" && Number.isNaN(Date.parse(until))) throw new Error("invalid pause time");
  await updateState((s) => (s.pausedUntil = until));
}

export async function startFocus(kind: "focus" | "meeting", minutes: number, o: { pauseVoice: boolean; pausePopup: boolean; holdAll: boolean }) {
  if (!(minutes >= 1 && minutes <= 1440)) throw new Error("duration must be 1-1440 minutes");
  const now = Date.now();
  const startedAt = toIso(now);
  const endsAt = toIso(now + minutes * 60_000);
  await (await db()).put("focus", { id: uuid(), kind, startedAt, endsAt, endedAt: null });
  await updateState((s) => (s.focus = { kind, startedAt, endsAt, ...o }));
}

export async function endFocusSessions(at: string) {
  const d = await db();
  for (const f of await d.getAll("focus")) if (!f.endedAt) await d.put("focus", { ...f, endedAt: at < f.endsAt ? at : f.endsAt });
}

export async function stopFocus() {
  await endFocusSessions(nowIso());
  await updateState((s) => (s.focus = null));
}

export async function act(occurrenceId: string, reminderId: string, action: "done" | "snoozed" | "skipped" | "muted_today" | "dismissed", snoozeMinutes?: number) {
  const kv = await kvGet();
  const zone = systemTimeZone();
  const now = Date.now();
  const r = (kv.reminders ?? []).find((x) => x.id === reminderId);
  const item = kv.active?.items.find((d) => d.occurrenceId === occurrenceId);
  let detail: string | null = null;
  if (action === "snoozed") {
    const m = snoozeMinutes ?? 5;
    if (!(m >= 1 && m <= 240)) throw new Error("snooze must be 1-240 minutes");
    detail = `${m} min`;
    await updateState((s) => (s.snoozes[reminderId] = toIso(now + m * 60_000)));
  }
  if (action === "muted_today") await updateState((s) => (s.mutedToday[reminderId] = localDate(now, zone)));
  await addEvent({ id: uuid(), occurrenceId, reminderId, category: r?.category ?? "custom", action, scheduledAt: item?.scheduledAt ?? toIso(now), at: toIso(now), timeZone: zone, detail });
  const rest = (kv.active?.items ?? []).filter((d) => d.occurrenceId !== occurrenceId);
  await kvSet({ active: rest.length && kv.active ? { ...kv.active, items: rest } : null });
  try {
    await chrome.notifications.clear(occurrenceId);
  } catch {
    /* ignore */
  }
}

export async function dismissPopup() {
  await kvSet({ active: null });
}

export async function addWater(ml: number) {
  if (!(Number.isInteger(ml) && ml >= 1 && ml <= 5000)) throw new Error("amount must be 1-5000 ml");
  const id = uuid();
  await (await db()).add("water", { id, ml, at: nowIso(), timeZone: systemTimeZone() });
  // Remember insertion order: two taps in the same millisecond share a timestamp.
  const { waterOrder = [] } = (await chrome.storage.local.get("waterOrder")) as { waterOrder?: string[] };
  await chrome.storage.local.set({ waterOrder: [...waterOrder.slice(-49), id] });
  await touch();
}

export async function undoWater(): Promise<boolean> {
  const zone = systemTimeZone();
  const today = toIso(startOfLocalDay(localDate(Date.now(), zone), zone));
  const list = await range("water", today, toIso(nextLocalMidnight(Date.now(), zone)));
  const { waterOrder = [] } = (await chrome.storage.local.get("waterOrder")) as { waterOrder?: string[] };
  const rank = (id: string) => waterOrder.indexOf(id);
  const last = list.sort((a, b) => a.at.localeCompare(b.at) || rank(a.id) - rank(b.id)).at(-1);
  if (!last) return false;
  await (await db()).delete("water", last.id);
  await touch();
  return true;
}

/** Bump a counter so other contexts refresh after IndexedDB-only changes. */
export async function touch() {
  await chrome.storage.local.set({ touchedAt: Date.now() });
}

export async function history(from: string, to: string): Promise<History> {
  const [events, water, focus] = await Promise.all([range("events", from, to), range("water", from, to), focusRange(from, to)]);
  return { events, water, focus };
}

export async function clearHistory() {
  const d = await db();
  await Promise.all([d.clear("events"), d.clear("water"), d.clear("focus")]);
  await touch();
}

export async function listAudio(): Promise<VoiceAsset[]> {
  const all = await (await db()).getAll("audio");
  return all.map(({ blob: _b, ...meta }) => meta).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function importAudio(data: Blob, name: string, category: string, id?: string) {
  const { AUDIO_LIMITS, sniffAudio } = await import("@deskwell/domain");
  if (data.size < 1 || data.size > AUDIO_LIMITS.maxBytes) throw new Error("Audio files must be between 1 byte and 15 MB.");
  const mime = sniffAudio(new Uint8Array(await data.slice(0, 16).arrayBuffer()));
  if (!mime) throw new Error("This file is not a supported audio format (mp3, wav, ogg, m4a, aac, webm).");
  const asset = { id: id ?? uuid(), name: name.trim().slice(0, 120) || "Recording", category: category || "General", mime, bytes: data.size, durationSec: null, createdAt: nowIso() };
  await (await db()).put("audio", { ...asset, blob: new Blob([data], { type: mime }) });
  await touch();
  return { id: asset.id };
}

export async function readAudio(id: string): Promise<Blob> {
  const a = await (await db()).get("audio", id);
  if (!a) throw new Error("audio not found");
  return a.blob;
}

export async function updateAudio(id: string, p: { name?: string; category?: string; durationSec?: number }) {
  const d = await db();
  const a = await d.get("audio", id);
  if (!a) throw new Error("audio not found");
  await d.put("audio", { ...a, ...(p.name ? { name: p.name.slice(0, 120) } : {}), ...(p.category ? { category: p.category } : {}), ...(p.durationSec !== undefined ? { durationSec: p.durationSec } : {}) });
  await touch();
}

export async function deleteAudio(id: string) {
  const used = ((await kvGet()).reminders ?? []).filter((r) => r.voice.audioIds.includes(id));
  if (used.length) throw new Error(`This audio is used by: ${used.map((r) => r.name).join(", ")}. Remove it from those reminders first.`);
  await (await db()).delete("audio", id);
  await touch();
}

export async function exportData(withHistory: boolean): Promise<ExportedData> {
  const kv = await kvGet();
  return {
    settings: kv.settings ?? null,
    reminders: kv.reminders ?? [],
    templates: kv.templates ?? [],
    history: withHistory ? await history("0000", "9999") : null,
    audio: await listAudio(),
  };
}

/** Validate everything first, then write. chrome.storage.set of several keys is a single atomic write. */
export async function importData(data: { settings: Settings; reminders: Reminder[]; templates: MessageTemplate[]; history: History | null }) {
  const settings = SettingsSchema.parse(data.settings);
  const reminders = data.reminders.map((r) => ReminderSchema.parse(r));
  const templates = data.templates.map((t) => MessageTemplateSchema.parse(t));
  if (data.history) {
    const d = await db();
    const tx = d.transaction(["events", "water", "focus"], "readwrite");
    await Promise.all([tx.objectStore("events").clear(), tx.objectStore("water").clear(), tx.objectStore("focus").clear()]);
    for (const e of data.history.events) void tx.objectStore("events").put(e);
    for (const w of data.history.water) void tx.objectStore("water").put(w);
    for (const f of data.history.focus) void tx.objectStore("focus").put(f);
    await tx.done;
  }
  await kvSet({ settings, reminders, templates, state: emptyState(), active: null });
}
