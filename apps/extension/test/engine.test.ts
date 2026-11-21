import { beforeEach, describe, expect, it } from "vitest";
import { installChromeMock } from "./chrome-mock";
import { defaultSettings, defaultTemplates, newReminder, type Delivery, type Settings } from "@deskwell/domain";

const mock = installChromeMock();
const core = await import("../src/core");
const { tick } = await import("../src/engine");
const { db, resetDbForTests, DB_NAME } = await import("../src/db");

function shell() {
  const s = {
    delivered: [] as Delivery[][],
    scheduled: [] as (number | null)[],
    popups: 0,
    notify: async () => {},
    showPopup: async () => void s.popups++,
    playVoice: async (items: Delivery[], _s: Settings) => void s.delivered.push(items),
    schedule: async (at: number | null) => void s.scheduled.push(at),
    idleState: async () => "active" as const,
  };
  return s;
}

// 2026-03-02 is a Monday. Use UTC so tests don't depend on the machine timezone.
process.env.TZ = "UTC";
const T = (hm: string) => Date.parse(`2026-03-02T${hm}:00Z`);

beforeEach(async () => {
  mock.reset();
  (await db()).close();
  resetDbForTests();
  await new Promise<void>((r) => {
    const q = indexedDB.deleteDatabase(DB_NAME);
    q.onsuccess = () => r();
    q.onerror = () => r();
  });
  const settings = defaultSettings("2026-03-01T00:00:00Z");
  settings.quietHours = [];
  const water = newReminder("2026-03-01T00:00:00Z", "w", { name: "Water", category: "water" }); // every 60 min in work hours 09-17, lunch break 13-14
  await core.initDefaults({ ...settings, lastSeenTimeZone: "UTC" }, [water], defaultTemplates());
});

describe("extension engine", () => {
  it("schedules the next occurrence without delivering early", async () => {
    const sh = shell();
    await tick(sh, T("09:30"));
    expect(sh.delivered).toHaveLength(0);
    expect(sh.scheduled.at(-1)).toBe(T("10:00"));
  });

  it("delivers a due reminder exactly once even if ticks repeat", async () => {
    const sh = shell();
    await tick(sh, T("10:00"));
    await tick(sh, T("10:00"));
    await tick(sh, T("10:00") + 30_000);
    expect(sh.delivered).toHaveLength(1);
    expect(sh.popups).toBe(1);
    const h = await core.history("2026-03-02T00:00:00Z", "2026-03-03T00:00:00Z");
    expect(h.events.filter((e) => e.action === "delivered")).toHaveLength(1);
  });

  it("does not replay a backlog after the browser was closed", async () => {
    const sh = shell();
    await tick(sh, T("16:30")); // 10,11,12,14,15,16 were missed
    expect(sh.delivered).toHaveLength(0);
    expect(sh.scheduled.at(-1)).toBe(T("17:00"));
  });

  it("snooze delays the next delivery", async () => {
    const sh = shell();
    await tick(sh, T("10:00"));
    const { active } = await core.kvGet();
    const d = active!.items[0]!;
    const realNow = Date.now;
    Date.now = () => T("10:00") + 5_000;
    try {
      await core.act(d.occurrenceId, d.reminderId, "snoozed", 10);
    } finally {
      Date.now = realNow;
    }
    expect((await core.kvGet()).active).toBeNull();
    await tick(sh, T("10:05"));
    expect(sh.delivered).toHaveLength(1);
    await tick(sh, T("10:10") + 5_000);
    expect(sh.delivered).toHaveLength(2);
  });

  it("pause holds everything", async () => {
    await core.setPause("indefinite");
    const sh = shell();
    await tick(sh, T("10:00"));
    expect(sh.delivered).toHaveLength(0);
    expect(sh.scheduled.at(-1)).toBeNull();
  });
});

describe("extension data", () => {
  it("rejects invalid reminders and keeps old data", async () => {
    await expect(core.saveReminder({ id: "", name: "" } as never)).rejects.toThrow();
    expect((await core.kvGet()).reminders).toHaveLength(1);
  });

  it("water add/undo", async () => {
    await core.addWater(250);
    await core.addWater(500);
    expect(await core.undoWater()).toBe(true);
    const h = await core.history("0000", "9999");
    expect(h.water.map((w) => w.ml)).toEqual([250]);
  });

  it("refuses non-audio uploads and blocks deleting audio in use", async () => {
    await expect(core.importAudio(new Blob(["hello world, not audio"]), "x", "General")).rejects.toThrow(/not a supported/);
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6]);
    const { id } = await core.importAudio(new Blob([mp3]), "Mine", "General");
    const r = (await core.kvGet()).reminders![0]!;
    await core.saveReminder({ ...r, voice: { ...r.voice, mode: "audio", audioIds: [id] } });
    await expect(core.deleteAudio(id)).rejects.toThrow(/used by/);
  });

  it("import validates before writing", async () => {
    const before = await core.kvGet();
    await expect(core.importData({ settings: before.settings!, reminders: [{ bad: true } as never], templates: [], history: null })).rejects.toThrow();
    expect((await core.kvGet()).reminders).toEqual(before.reminders);
  });
});
