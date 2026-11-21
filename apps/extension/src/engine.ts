import { buildDelivery, localDate, occurrencesBetween, planNext, systemTimeZone, toIso, uuid, type Delivery, type Settings } from "@deskwell/domain";
import type { ActiveDelivery } from "@deskwell/ui";
import { GRACE_MS, emptyState, endFocusSessions, kvGet } from "./core";
import { addEvent, deliveredSince, recordOccurrence } from "./db";

export const TICK_ALARM = "deskwell-tick";
export const HEARTBEAT_ALARM = "deskwell-heartbeat";
const AWAY_MS = 10 * 60_000;

/** Side effects the engine needs; the service worker provides real ones, tests provide fakes. */
export interface EngineShell {
  notify(id: string, title: string, message: string, buttons: boolean): Promise<void>;
  showPopup(): Promise<void>;
  playVoice(items: Delivery[], settings: Settings): Promise<void>;
  schedule(at: number | null): Promise<void>;
  idleState(): Promise<"active" | "idle" | "locked">;
}

let chain: Promise<unknown> = Promise.resolve();
/** Serialize ticks: alarms, storage changes and wake-ups can fire close together. */
export function tick(shell: EngineShell, now = Date.now()): Promise<void> {
  const p = chain.then(() => tickOnce(shell, now)).catch((e) => console.warn("DeskWell tick failed", e));
  chain = p;
  return p;
}

async function tickOnce(shell: EngineShell, now: number) {
  const kv = await kvGet();
  const settings = kv.settings;
  if (!settings) return shell.schedule(null);
  const reminders = kv.reminders ?? [];
  const templates = kv.templates ?? [];
  const state = structuredClone(kv.state ?? emptyState());
  const zone = systemTimeZone();
  const out: Record<string, unknown> = {};

  if (settings.lastSeenTimeZone !== zone) {
    if (settings.lastSeenTimeZone) {
      await shell.notify("deskwell-tz", "DeskWell", "Your timezone changed. DeskWell updated your local schedule.", false);
      void chrome.runtime.sendMessage({ type: "timezone", from: settings.lastSeenTimeZone, to: zone }).catch(() => undefined);
    }
    out.settings = { ...settings, lastSeenTimeZone: zone };
  }

  if (state.focus && Date.parse(state.focus.endsAt) <= now) {
    await endFocusSessions(toIso(now));
    state.focus = null;
    await shell.notify("deskwell-focus", "Focus finished", "Nice work. Your reminders are back on schedule.", false);
  }
  if (state.pausedUntil && state.pausedUntil !== "indefinite" && Date.parse(state.pausedUntil) <= now) state.pausedUntil = null;
  for (const [id, v] of Object.entries(state.snoozes)) if (Date.parse(v) <= now - GRACE_MS) delete state.snoozes[id];
  const today = localDate(now, zone);
  for (const [id, d] of Object.entries(state.mutedToday)) if (d !== today) delete state.mutedToday[id];

  const ctx = { zone, settings };
  // Kept outside `state` so the per-tick heartbeat write doesn't look like a user change.
  const { lastTickAt } = (await chrome.storage.local.get("lastTickAt")) as { lastTickAt?: string };
  if (lastTickAt && now - Date.parse(lastTickAt) > AWAY_MS && settings.catchUp === "summary" && !state.pausedUntil) {
    const missed = reminders.filter((r) => r.enabled).reduce((n, r) => n + occurrencesBetween(r, Date.parse(lastTickAt), now - GRACE_MS, ctx, 50).length, 0);
    if (missed > 0) await shell.notify("deskwell-away", "Welcome back", `${missed} reminders were skipped while you were away. Your schedule continues from now.`, false);
  }
  out.lastTickAt = toIso(now);

  // Idle policy (Chrome's own idle state; DeskWell never inspects activity itself).
  let idleHold: "all" | "normal" | null = null;
  if (settings.idlePolicy !== "ignore") {
    chrome.idle?.setDetectionInterval?.(Math.max(15, settings.idleMinutes * 60));
    const st = await shell.idleState();
    if (st !== "active") idleHold = settings.idlePolicy === "pause_all" ? "all" : "normal";
  }

  const delivered = await deliveredSince(toIso(now - 2 * 86_400_000));
  const pool = idleHold === "all" ? [] : idleHold === "normal" ? reminders.filter((r) => r.priority === "important") : reminders;
  const plan = planNext(pool, now - GRACE_MS, ctx, state, (id) => delivered.has(id));

  if (plan && plan.at <= now) {
    const items: Delivery[] = [];
    for (const it of plan.items) {
      const r = reminders.find((x) => x.id === it.reminderId);
      if (!r) continue;
      if (it.kind === "snooze") delete state.snoozes[r.id];
      const fresh = await recordOccurrence({ id: it.occurrenceId, reminderId: r.id, scheduledAt: toIso(it.scheduledAt), at: toIso(now) });
      if (!fresh) continue;
      await addEvent({
        id: uuid(),
        occurrenceId: it.occurrenceId,
        reminderId: r.id,
        category: r.category,
        action: "delivered",
        scheduledAt: toIso(it.scheduledAt),
        at: toIso(now),
        timeZone: zone,
        detail: it.kind === "deferred" ? "deferred by focus" : it.kind === "snooze" ? "after snooze" : null,
      });
      items.push(buildDelivery(r, it, templates));
    }
    out.state = state;
    if (items.length) {
      const f = state.focus;
      const wantsPopup = items.some((d) => d.delivery === "popup_voice" || d.delivery === "popup");
      const wantsVoice = items.some((d) => d.delivery === "popup_voice" || d.delivery === "voice");
      const prev = kv.active?.items ?? [];
      const merged = [...prev.filter((d) => !items.some((n) => n.reminderId === d.reminderId)), ...items];
      const active: ActiveDelivery = { items: merged, showPopup: wantsPopup && !f?.pausePopup, playVoice: wantsVoice && !f?.pauseVoice, createdAt: toIso(now) };
      out.active = active;
      await chrome.storage.local.set(out);
      const native = settings.nativeNotifications && items.some((d) => d.delivery !== "voice");
      // A silent reminder always gets a notification, otherwise nothing would be shown at all.
      for (const d of items) if (native || d.delivery === "silent") await shell.notify(d.occurrenceId, d.name, d.message, true);
      if (active.showPopup) await shell.showPopup();
      if (active.playVoice) await shell.playVoice(items.filter((d) => d.delivery === "popup_voice" || d.delivery === "voice"), settings);
      void chrome.runtime.sendMessage({ type: "deliver", active }).catch(() => undefined);
    } else await chrome.storage.local.set(out);
    // Plan the following reminder right away.
    return tickOnce(shell, Date.now());
  }

  out.state = state;
  await chrome.storage.local.set(out);
  await shell.schedule(plan ? plan.at : null);
}
