import { DateTime } from "luxon";
import type { TimeWindow } from "./types";

/**
 * Time helpers. All instants are handled as epoch milliseconds (UTC) and all recurring rules are
 * evaluated in the device's IANA timezone using Luxon (which uses the platform's tz database).
 *
 * DST rules (documented and mirrored exactly by the Rust scheduler):
 *  - A local time that does not exist (spring-forward gap) is moved forward by the length of the gap
 *    (02:30 in a 02:00→03:00 gap becomes 03:30).
 *  - A local time that occurs twice (fall-back overlap) resolves to the later instant (the second pass,
 *    after the clocks went back). This is Luxon's behaviour and the Rust side matches it.
 */

export const MINUTE = 60_000;
export const DAY_MINUTES = 24 * 60;

/** Detect the system IANA timezone at runtime. Never hard-coded. */
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function parseHm(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

export function formatHm(minutes: number): string {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Add whole days to a YYYY-MM-DD calendar date. */
export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: "UTC" }).plus({ days }).toISODate()!;
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a calendar date. */
export function weekdayOf(date: string): number {
  return DateTime.fromISO(date, { zone: "UTC" }).weekday;
}

/** Convert local calendar date + minutes after its midnight (may exceed a day) into an instant. */
export function localToInstant(date: string, minutes: number, zone: string): number {
  const dayOffset = Math.floor(minutes / DAY_MINUTES);
  const m = minutes - dayOffset * DAY_MINUTES;
  const d = DateTime.fromISO(addDays(date, dayOffset), { zone: "UTC" });
  return DateTime.fromObject(
    { year: d.year, month: d.month, day: d.day, hour: Math.floor(m / 60), minute: m % 60 },
    { zone },
  ).toMillis();
}

export interface LocalParts {
  date: string;
  minutes: number;
  weekday: number;
}

export function localParts(instant: number, zone: string): LocalParts {
  const dt = DateTime.fromMillis(instant, { zone });
  return { date: dt.toISODate()!, minutes: dt.hour * 60 + dt.minute, weekday: dt.weekday };
}

export function localDate(instant: number, zone: string): string {
  return DateTime.fromMillis(instant, { zone }).toISODate()!;
}

/** Instant of the next local midnight after `instant`. */
export function nextLocalMidnight(instant: number, zone: string): number {
  return DateTime.fromMillis(instant, { zone }).startOf("day").plus({ days: 1 }).toMillis();
}

export function startOfLocalDay(date: string, zone: string): number {
  return DateTime.fromISO(date, { zone }).startOf("day").toMillis();
}

export function toIso(instant: number): string {
  return new Date(instant).toISOString();
}

export function fromIso(iso: string): number {
  return Date.parse(iso);
}

/** Window bounds in minutes relative to its start day. end > start always (crossing windows end > 1440). */
export function windowBounds(w: TimeWindow): [number, number] {
  const s = parseHm(w.start);
  let e = parseHm(w.end);
  if (e <= s) e += DAY_MINUTES;
  return [s, e];
}

/**
 * True if a local moment falls inside a recurring window that applies on `days`.
 * Crossing-midnight windows belong to the day they start on.
 */
export function inRecurringWindow(p: LocalParts, w: TimeWindow, days: number[]): boolean {
  const [s, e] = windowBounds(w);
  if (days.includes(p.weekday) && p.minutes >= s && p.minutes < e) return true;
  if (e > DAY_MINUTES) {
    const prev = p.weekday === 1 ? 7 : p.weekday - 1;
    if (days.includes(prev) && p.minutes + DAY_MINUTES >= s && p.minutes + DAY_MINUTES < e) return true;
  }
  return false;
}

/** Locale-aware time formatting honouring the 12/24h preference. */
export function formatTime(instant: number, zone: string, pref: "system" | "12" | "24", withSeconds = false): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZone: zone };
  if (withSeconds) opts.second = "2-digit";
  if (pref === "12") opts.hour12 = true;
  if (pref === "24") {
    opts.hour12 = false;
    opts.hour = "2-digit";
  }
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(instant));
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const totalMin = Math.ceil(ms / MINUTE);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}
