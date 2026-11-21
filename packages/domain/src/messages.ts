import { CATEGORY_META } from "./defaults";
import type { Delivery, MessageTemplate, Reminder } from "./types";

export interface PlanItemLike {
  occurrenceId: string;
  scheduledAt: number;
}

/** Choose the message for a reminder: its own messages first, then the template library. */
export function pickMessage(r: Reminder, templates: MessageTemplate[], rand: () => number = Math.random): string {
  const own = r.messages.filter((m) => m.trim().length > 0);
  if (own.length) return r.randomMessage ? own[Math.floor(rand() * own.length)] : own[0];
  const lib = templates
    .filter((t) => t.category === r.category && t.language === r.language)
    .sort((a, b) => a.order - b.order);
  const fallback = lib.length ? lib : templates.filter((t) => t.category === r.category && t.language === "en");
  if (!fallback.length) return CATEGORY_META[r.category].title;
  return r.randomMessage ? fallback[Math.floor(rand() * fallback.length)].text : fallback[0].text;
}

/** Pick one audio asset id (fixed first or random). */
export function pickAudio(r: Reminder, available: Set<string>, rand: () => number = Math.random): string | null {
  const ids = r.voice.audioIds.filter((id) => available.has(id));
  if (!ids.length) return null;
  return r.voice.randomAudio ? ids[Math.floor(rand() * ids.length)] : ids[0];
}

export function buildDelivery(r: Reminder, item: PlanItemLike, templates: MessageTemplate[], rand?: () => number): Delivery {
  return {
    occurrenceId: item.occurrenceId,
    reminderId: r.id,
    name: r.name,
    category: r.category,
    message: pickMessage(r, templates, rand),
    scheduledAt: new Date(item.scheduledAt).toISOString(),
    delivery: r.delivery,
    voice: r.voice,
    language: r.language,
    snoozeOptions: r.snoozeOptions,
    priority: r.priority,
  };
}

/** Combine several due reminders into one popup/voice message when grouping is enabled. */
export function combineDeliveries(ds: Delivery[]): { title: string; body: string; speech: string } {
  if (ds.length === 1) {
    return { title: ds[0].name, body: ds[0].message, speech: ds[0].message };
  }
  return {
    title: ds.map((d) => d.name).join(" + "),
    body: ds.map((d) => `• ${d.name}: ${d.message}`).join("\n"),
    speech: ds.map((d) => d.message).join(" "),
  };
}
