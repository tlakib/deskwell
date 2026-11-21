import type { Reminder, RuntimeState, Settings, TimeWindow, WorkProfile } from "./types";
import {
  DAY_MINUTES,
  addDays,
  inRecurringWindow,
  localDate,
  localParts,
  localToInstant,
  nextLocalMidnight,
  parseHm,
  startOfLocalDay,
  toIso,
  weekdayOf,
  windowBounds,
} from "./time";

/** How far ahead DeskWell looks for the next occurrence. */
export const SEARCH_DAYS = 400;

export interface ScheduleContext {
  zone: string;
  settings: Pick<Settings, "workEnabled" | "activeProfileId" | "profiles" | "quietHours">;
}

export function activeProfile(settings: ScheduleContext["settings"]): WorkProfile | null {
  if (!settings.workEnabled) return null;
  return settings.profiles.find((p) => p.id === settings.activeProfileId) ?? settings.profiles[0] ?? null;
}

interface Effective {
  days: number[];
  window: TimeWindow | null;
  breaks: TimeWindow[];
  breakDays: number[];
}

function effective(r: Reminder, ctx: ScheduleContext): Effective {
  const s = r.schedule;
  if (s.window) return { days: s.days, window: s.window, breaks: [], breakDays: [] };
  const profile = s.useWorkHours ? activeProfile(ctx.settings) : null;
  if (profile) {
    return {
      days: s.days.filter((d) => profile.days.includes(d)),
      window: { start: profile.start, end: profile.end },
      breaks: profile.breaks,
      breakDays: profile.days,
    };
  }
  return { days: s.days, window: null, breaks: [], breakDays: [] };
}

/** Local minutes (relative to `date` midnight, may exceed 1440) at which the reminder fires on that day. */
export function minutesForDay(r: Reminder, date: string, ctx: ScheduleContext): number[] {
  const s = r.schedule;
  if (s.startDate && date < s.startDate) return [];
  if (s.endDate && date > s.endDate) return [];
  const wd = weekdayOf(date);
  const out: number[] = [];
  switch (s.type) {
    case "once": {
      if (s.onceAt && s.onceAt.slice(0, 10) === date) out.push(parseHm(s.onceAt.slice(11, 16)));
      break;
    }
    case "dates": {
      if (s.dates.includes(date)) for (const t of s.times) out.push(parseHm(t));
      break;
    }
    case "daily": {
      if (s.days.includes(wd)) for (const t of s.times) out.push(parseHm(t));
      break;
    }
    case "interval": {
      const eff = effective(r, ctx);
      if (eff.days.includes(wd)) {
        const [ws, we] = eff.window ? windowBounds(eff.window) : [0, DAY_MINUTES];
        const step = Math.max(1, s.intervalMinutes);
        for (let m = ws + step; m <= we; m += step) out.push(m);
      }
      if (s.days.includes(wd)) for (const t of s.times) out.push(parseHm(t));
      break;
    }
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

/** Is this instant blocked by quiet hours or (for interval reminders) a work-profile break? */
export function isBlocked(r: Reminder, instant: number, ctx: ScheduleContext): boolean {
  const p = localParts(instant, ctx.zone);
  if (r.respectQuietHours) {
    for (const q of ctx.settings.quietHours) {
      if (q.enabled && inRecurringWindow(p, q, q.days)) return true;
    }
  }
  if (r.schedule.type === "interval" && !r.schedule.window && r.schedule.useWorkHours) {
    const eff = effective(r, ctx);
    for (const b of eff.breaks) if (inRecurringWindow(p, b, eff.breakDays)) return true;
  }
  return false;
}

/** Next natural occurrence strictly after `after` (epoch ms), or null if none within SEARCH_DAYS. */
export function nextOccurrence(
  r: Reminder,
  after: number,
  ctx: ScheduleContext,
  skip?: (instant: number) => boolean,
): number | null {
  const startDate = addDays(localDate(after, ctx.zone), -1);
  let best: number | null = null;
  for (let i = 0; i < SEARCH_DAYS; i++) {
    const date = addDays(startDate, i);
    for (const m of minutesForDay(r, date, ctx)) {
      const t = localToInstant(date, m, ctx.zone);
      if (t <= after) continue;
      if (best !== null && t >= best) continue;
      if (isBlocked(r, t, ctx)) continue;
      if (skip && skip(t)) continue;
      best = t;
    }
    if (best !== null && best < startOfLocalDay(addDays(date, 1), ctx.zone)) break;
  }
  return best;
}

/** All natural occurrences in (from, to]. Used for catch-up summaries and the schedule preview. */
export function occurrencesBetween(r: Reminder, from: number, to: number, ctx: ScheduleContext, limit = 500): number[] {
  const out: number[] = [];
  let cur = from;
  while (out.length < limit) {
    const n = nextOccurrence(r, cur, ctx);
    if (n === null || n > to) break;
    out.push(n);
    cur = n;
  }
  return out;
}

export function occurrenceId(reminderId: string, instant: number): string {
  return `${reminderId}@${toIso(instant)}`;
}

export function snoozeOccurrenceId(reminderId: string, until: string): string {
  return `${reminderId}@snooze@${until}`;
}

export interface PlanItem {
  reminderId: string;
  occurrenceId: string;
  /** When it will actually be delivered (after deferral). */
  at: number;
  /** The originally scheduled instant. */
  scheduledAt: number;
  kind: "natural" | "snooze" | "deferred";
}

export interface Plan {
  at: number;
  items: PlanItem[];
}

/** Next candidate for a single reminder, applying pause, mute-today, snooze and focus rules. */
export function candidateFor(
  r: Reminder,
  after: number,
  ctx: ScheduleContext,
  state: RuntimeState,
  isDelivered: (occurrenceId: string) => boolean = () => false,
): PlanItem | null {
  if (!r.enabled || r.delivery === "disabled") return null;
  if (state.pausedUntil === "indefinite") return null;

  let floor = after;
  const pausedUntil = state.pausedUntil ? Date.parse(state.pausedUntil) : null;
  if (pausedUntil !== null && pausedUntil > floor) floor = pausedUntil - 1;

  const muted = state.mutedToday[r.id];
  if (muted && muted === localDate(after, ctx.zone)) {
    floor = Math.max(floor, nextLocalMidnight(after, ctx.zone) - 1);
  }

  let snooze: PlanItem | null = null;
  const sIso = state.snoozes[r.id];
  if (sIso) {
    const s = Date.parse(sIso);
    if (s > after) {
      const id = snoozeOccurrenceId(r.id, sIso);
      if (!isDelivered(id)) snooze = { reminderId: r.id, occurrenceId: id, at: Math.max(s, floor + 1), scheduledAt: s, kind: "snooze" };
      if (r.snoozePolicy === "wait") floor = Math.max(floor, s);
    }
  }

  const skip = (t: number) => isDelivered(occurrenceId(r.id, t));
  let natural = nextOccurrence(r, floor, ctx, skip);

  const focus = state.focus;
  const holds = focus && r.pauseInFocus && (focus.kind === "focus" || focus.holdAll);
  const focusEnd = focus ? Date.parse(focus.endsAt) : 0;

  let naturalItem: PlanItem | null = null;
  if (natural !== null) {
    if (holds && natural < focusEnd) {
      if (r.priority === "important") {
        naturalItem = { reminderId: r.id, occurrenceId: occurrenceId(r.id, natural), at: focusEnd, scheduledAt: natural, kind: "deferred" };
      } else {
        natural = nextOccurrence(r, focusEnd - 1, ctx, skip);
      }
    }
    if (!naturalItem && natural !== null) {
      naturalItem = { reminderId: r.id, occurrenceId: occurrenceId(r.id, natural), at: natural, scheduledAt: natural, kind: "natural" };
    }
  }
  if (snooze && holds && snooze.at < focusEnd) snooze.at = focusEnd;

  if (snooze && naturalItem) return snooze.at <= naturalItem.at ? snooze : naturalItem;
  return snooze ?? naturalItem;
}

/**
 * The next delivery: the earliest candidate across reminders, plus any grouped reminders due within the
 * same minute. `after` should be (now - grace) so a due event is never skipped by a late tick and old
 * missed events are never replayed.
 */
export function planNext(
  reminders: Reminder[],
  after: number,
  ctx: ScheduleContext,
  state: RuntimeState,
  isDelivered?: (occurrenceId: string) => boolean,
): Plan | null {
  const cands: { r: Reminder; c: PlanItem }[] = [];
  for (const r of reminders) {
    const c = candidateFor(r, after, ctx, state, isDelivered);
    if (c) cands.push({ r, c });
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => a.c.at - b.c.at || a.r.id.localeCompare(b.r.id));
  const first = cands[0];
  const items = [first.c];
  if (first.r.group) {
    for (const x of cands.slice(1)) {
      if (x.r.group && x.c.at - first.c.at < 60_000) items.push(x.c);
    }
  }
  return { at: first.c.at, items };
}

/** Daily-progress key for an instant. */
export function dayKey(instant: number, zone: string): string {
  return localDate(instant, zone);
}
