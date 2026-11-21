import type { Category, FocusSession, ReminderEvent, WaterEntry } from "./types";
import { addDays, localDate, weekdayOf } from "./time";

export interface DaySummary {
  date: string;
  delivered: number;
  done: number;
  snoozed: number;
  skipped: number;
  waterMl: number;
  doneByCategory: Partial<Record<Category, number>>;
  focusMinutes: number;
  /** done / delivered, transparent habit-completion ratio (not a health score). null when nothing delivered. */
  completion: number | null;
}

export function summarizeDay(
  date: string,
  zone: string,
  events: ReminderEvent[],
  water: WaterEntry[],
  focus: FocusSession[] = [],
): DaySummary {
  const s: DaySummary = { date, delivered: 0, done: 0, snoozed: 0, skipped: 0, waterMl: 0, doneByCategory: {}, focusMinutes: 0, completion: null };
  for (const e of events) {
    if (localDate(Date.parse(e.at), zone) !== date) continue;
    if (e.action === "delivered") s.delivered++;
    else if (e.action === "done") {
      s.done++;
      s.doneByCategory[e.category] = (s.doneByCategory[e.category] ?? 0) + 1;
    } else if (e.action === "snoozed") s.snoozed++;
    else if (e.action === "skipped" || e.action === "muted_today") s.skipped++;
  }
  for (const w of water) if (localDate(Date.parse(w.at), zone) === date) s.waterMl += w.ml;
  for (const f of focus) {
    if (localDate(Date.parse(f.startedAt), zone) !== date) continue;
    const end = Date.parse(f.endedAt ?? f.endsAt);
    s.focusMinutes += Math.max(0, Math.round((Math.min(end, Date.now()) - Date.parse(f.startedAt)) / 60000));
  }
  s.completion = s.delivered ? Math.min(1, s.done / s.delivered) : null;
  return s;
}

/** Dates of the week containing `date`, honouring the configured week start (ISO weekday). */
export function weekDates(date: string, weekStart: number): string[] {
  const wd = weekdayOf(date);
  const back = (wd - weekStart + 7) % 7;
  const first = addDays(date, -back);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

export function waterProgress(totalMl: number, goalMl: number): number {
  if (goalMl <= 0) return 0;
  return Math.min(1, totalMl / goalMl);
}

export function formatWater(ml: number, unit: "ml" | "oz" | "glass", glassMl: number): string {
  if (unit === "oz") return `${(ml / 29.5735).toFixed(1)} oz`;
  if (unit === "glass") return `${(ml / glassMl).toFixed(1)} glasses`;
  return `${ml} ml`;
}
