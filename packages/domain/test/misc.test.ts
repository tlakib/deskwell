import { describe, expect, it } from "vitest";
import {
  BRAND,
  combineDeliveries,
  defaultReminders,
  defaultSettings,
  defaultTemplates,
  mergeEvents,
  mergeRecords,
  packClipPath,
  parseBackup,
  pickMessage,
  sealBackup,
  sniffAudio,
  summarizeDay,
  ttsCacheKey,
  weekDates,
} from "../src";

const now = "2026-11-23T08:00:00.000Z";

describe("messages", () => {
  const tpl = defaultTemplates();
  it("uses the reminder's own message first", () => {
    const r = { ...defaultReminders(now)[0], messages: ["Look far away"], randomMessage: false };
    expect(pickMessage(r, tpl)).toBe("Look far away");
  });
  it("falls back to the template library in the reminder's language", () => {
    const r = { ...defaultReminders(now)[3], language: "bn" as const, randomMessage: false };
    expect(pickMessage(r, tpl)).toContain("পানি");
  });
  it("combines grouped deliveries", () => {
    const d = (name: string, message: string) => ({ name, message }) as any;
    expect(combineDeliveries([d("Water", "Drink"), d("Eyes", "Look")]).title).toBe("Water + Eyes");
  });
});

describe("voice packs", () => {
  it("resolves pack clips with English fallback", () => {
    expect(packClipPath("akib", "water", "bn")).toBe("voices/akib/water-bn.mp3");
    expect(packClipPath("rimjhim", "eyes", "de")).toBe("voices/rimjhim/eyes-en.mp3");
  });
  it("cache key is stable and whitespace-insensitive", () => {
    const base = { text: "Hello  there", language: "en" as const, voiceName: "X", rate: 1, pitch: 1, volume: 1 };
    expect(ttsCacheKey(base, "p")).toBe(ttsCacheKey({ ...base, text: " Hello there " }, "p"));
  });
  it("sniffs audio containers and rejects non-audio", () => {
    expect(sniffAudio(new TextEncoder().encode("ID3\u0004xxxxxxxx"))).toBe("audio/mpeg");
    const wav = new Uint8Array(12);
    wav.set(new TextEncoder().encode("RIFF"), 0);
    wav.set(new TextEncoder().encode("WAVE"), 8);
    expect(sniffAudio(wav)).toBe("audio/wav");
    expect(sniffAudio(new TextEncoder().encode("<html>hello"))).toBeNull();
  });
});

describe("progress", () => {
  it("summarises a local day and ignores other days", () => {
    const ev = (action: string, at: string) => ({ id: at + action, occurrenceId: "o", reminderId: "r", category: "water", action, scheduledAt: at, at, timeZone: "UTC", detail: null }) as any;
    const s = summarizeDay("2026-11-23", "UTC", [ev("delivered", "2026-11-23T10:00:00Z"), ev("done", "2026-11-23T10:01:00Z"), ev("delivered", "2026-11-24T10:00:00Z")], [
      { id: "w", ml: 250, at: "2026-11-23T11:00:00Z", timeZone: "UTC" },
    ]);
    expect(s.delivered).toBe(1);
    expect(s.done).toBe(1);
    expect(s.waterMl).toBe(250);
    expect(s.completion).toBe(1);
  });
  it("week honours the configured week start", () => {
    expect(weekDates("2026-11-25", 1)[0]).toBe("2026-11-23");
    expect(weekDates("2026-11-25", 7)[0]).toBe("2026-11-22");
  });
});

describe("backup", () => {
  async function make() {
    return sealBackup({
      format: "deskwell-backup",
      version: 1,
      createdAt: now,
      app: BRAND.version,
      platform: "desktop",
      settings: defaultSettings(now),
      reminders: defaultReminders(now),
      templates: defaultTemplates(),
      history: { events: [], water: [], focus: [] },
      audio: null,
    });
  }
  it("round-trips and previews", async () => {
    const res = await parseBackup(JSON.stringify(await make()));
    expect(res.preview.ok).toBe(true);
    expect(res.preview.reminders).toBe(7);
  });
  it("rejects tampered files", async () => {
    const b = await make();
    b.reminders[0].name = "Hacked";
    const res = await parseBackup(JSON.stringify(b));
    expect(res.preview.ok).toBe(false);
    expect(res.preview.error).toMatch(/Integrity/);
  });
  it("rejects invalid JSON and wrong formats", async () => {
    expect((await parseBackup("{nope")).preview.ok).toBe(false);
    expect((await parseBackup(JSON.stringify({ format: "other" }))).preview.ok).toBe(false);
  });
});

describe("sync rules", () => {
  it("higher revision wins, missing remote is not a delete", () => {
    const l = [{ id: "a", revision: 2, updatedAt: "2026-01-02" }, { id: "b", revision: 0, updatedAt: "2026-01-01" }];
    const r = [{ id: "a", revision: 1, updatedAt: "2026-01-03" }];
    const m = mergeRecords(l, r);
    expect(m.find((x) => x.id === "a")?.revision).toBe(2);
    expect(m.find((x) => x.id === "b")).toBeDefined();
  });
  it("events merge idempotently", () => {
    expect(mergeEvents([{ id: "1" }], [{ id: "1" }, { id: "2" }])).toHaveLength(2);
  });
});
