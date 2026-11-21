import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/schedule-cases.json";
import {
  ReminderSchema,
  RuntimeStateSchema,
  candidateFor,
  defaultReminders,
  defaultSettings,
  inRecurringWindow,
  localParts,
  occurrencesBetween,
  planNext,
  toIso,
  type Reminder,
  type ScheduleContext,
} from "../src";

function makeReminder(partial: Record<string, any>): Reminder {
  return ReminderSchema.parse({
    id: "r1",
    name: "Test",
    category: "walk",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...partial,
    schedule: { ...partial.schedule },
  });
}

function ctxFor(c: any): ScheduleContext {
  return { zone: c.zone, settings: { ...(fixtures.baseSettings as any), ...(c.settings ?? {}) } };
}

describe("shared schedule fixtures (also run by the Rust scheduler)", () => {
  for (const c of fixtures.cases as any[]) {
    it(c.name, () => {
      const r = makeReminder(c.reminder);
      const state = RuntimeStateSchema.parse(c.state ?? {});
      const delivered = new Set<string>(c.delivered ?? []);
      const cand = candidateFor(r, Date.parse(c.after), ctxFor(c), state, (id) => delivered.has(id));
      expect(cand ? toIso(cand.at) : null).toBe(c.expect ? new Date(c.expect).toISOString() : null);
      if (c.expectKind) expect(cand?.kind).toBe(c.expectKind);
    });
  }
});

describe("planner", () => {
  const now = "2026-11-23T08:00:00.000Z";
  const settings = defaultSettings(now);
  const ctx: ScheduleContext = { zone: "UTC", settings };

  it("groups reminders due in the same minute", () => {
    const a = makeReminder({ id: "a", schedule: { type: "interval", intervalMinutes: 30 } });
    const b = makeReminder({ id: "b", category: "water", schedule: { type: "interval", intervalMinutes: 60 } });
    const plan = planNext([a, b], Date.parse("2026-11-23T09:31:00Z"), ctx, RuntimeStateSchema.parse({}));
    expect(plan?.items.map((i) => i.reminderId).sort()).toEqual(["a", "b"]);
    expect(toIso(plan!.at)).toBe("2026-11-23T10:00:00.000Z");
  });

  it("does not group a reminder with group=false", () => {
    const a = makeReminder({ id: "a", group: false, schedule: { type: "interval", intervalMinutes: 30 } });
    const b = makeReminder({ id: "b", schedule: { type: "interval", intervalMinutes: 60 } });
    const plan = planNext([a, b], Date.parse("2026-11-23T09:31:00Z"), ctx, RuntimeStateSchema.parse({}));
    expect(plan?.items).toHaveLength(1);
  });

  it("never replays a backlog after sleep: plans only from now - grace", () => {
    const a = makeReminder({ id: "a", schedule: { type: "interval", intervalMinutes: 5 } });
    const wake = Date.parse("2026-11-23T15:02:30Z");
    const plan = planNext([a], wake - 90_000, ctx, RuntimeStateSchema.parse({}));
    expect(toIso(plan!.at)).toBe("2026-11-23T15:05:00.000Z");
  });

  it("returns null when everything is disabled", () => {
    const rs = defaultReminders(now).map((r) => ({ ...r, enabled: false }));
    expect(planNext(rs, Date.parse(now), ctx, RuntimeStateSchema.parse({}))).toBeNull();
  });

  it("default reminders produce a plan in work hours", () => {
    const plan = planNext(defaultReminders(now), Date.parse("2026-11-23T09:00:00Z"), ctx, RuntimeStateSchema.parse({}));
    expect(plan).not.toBeNull();
    expect(toIso(plan!.at)).toBe("2026-11-23T09:20:00.000Z");
  });

  it("counts missed occurrences for the 'welcome back' summary", () => {
    const a = makeReminder({ id: "a", schedule: { type: "interval", intervalMinutes: 30 } });
    const n = occurrencesBetween(a, Date.parse("2026-11-23T09:00:00Z"), Date.parse("2026-11-23T11:00:00Z"), ctx);
    expect(n).toHaveLength(4);
  });

  it("date rollover: next day's first slot after midnight", () => {
    const a = makeReminder({ id: "a", schedule: { type: "interval", intervalMinutes: 30 } });
    const c = candidateFor(a, Date.parse("2026-11-23T23:59:00Z"), ctx, RuntimeStateSchema.parse({}));
    expect(toIso(c!.at)).toBe("2026-11-24T09:30:00.000Z");
  });

  it("timezone change keeps the local wall-clock rule", () => {
    const a = makeReminder({ id: "a", schedule: { type: "daily", times: ["10:30"], days: [1, 2, 3, 4, 5, 6, 7], useWorkHours: false } });
    const after = Date.parse("2026-11-23T00:00:00Z");
    const dhaka = candidateFor(a, after, { zone: "Asia/Dhaka", settings }, RuntimeStateSchema.parse({}));
    const berlin = candidateFor(a, after, { zone: "Europe/Berlin", settings }, RuntimeStateSchema.parse({}));
    expect(toIso(dhaka!.at)).toBe("2026-11-23T04:30:00.000Z");
    expect(toIso(berlin!.at)).toBe("2026-11-23T09:30:00.000Z");
  });
});

describe("windows", () => {
  it("overnight window belongs to the start day", () => {
    const w = { start: "22:00", end: "06:00" };
    const fridayLate = localParts(Date.parse("2026-11-27T23:00:00Z"), "UTC");
    const saturdayEarly = localParts(Date.parse("2026-11-28T03:00:00Z"), "UTC");
    const sundayEarly = localParts(Date.parse("2026-11-29T03:00:00Z"), "UTC");
    expect(inRecurringWindow(fridayLate, w, [5])).toBe(true);
    expect(inRecurringWindow(saturdayEarly, w, [5])).toBe(true);
    expect(inRecurringWindow(sundayEarly, w, [5])).toBe(false);
  });
});
