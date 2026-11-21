import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { FocusSession, ReminderEvent, VoiceAsset, WaterEntry } from "@deskwell/domain";

/**
 * IndexedDB holds history and audio (large / append-only data). Settings, reminders, templates and
 * runtime state live in chrome.storage.local so every extension context sees changes instantly.
 */
interface DwDB extends DBSchema {
  events: { key: string; value: ReminderEvent; indexes: { at: string; occAction: [string, string] } };
  occurrences: { key: string; value: { id: string; reminderId: string; scheduledAt: string; at: string } ; indexes: { at: string } };
  water: { key: string; value: WaterEntry; indexes: { at: string } };
  focus: { key: string; value: FocusSession; indexes: { startedAt: string } };
  audio: { key: string; value: VoiceAsset & { blob: Blob } };
}

export const DB_NAME = "deskwell";
export const DB_VERSION = 1;

let dbp: Promise<IDBPDatabase<DwDB>> | null = null;

export function db(): Promise<IDBPDatabase<DwDB>> {
  dbp ??= openDB<DwDB>(DB_NAME, DB_VERSION, {
    upgrade(d, oldVersion) {
      // Versioned migrations: add a new `if (oldVersion < N)` block per schema change.
      if (oldVersion < 1) {
        const ev = d.createObjectStore("events", { keyPath: "id" });
        ev.createIndex("at", "at");
        ev.createIndex("occAction", ["occurrenceId", "action"], { unique: true });
        d.createObjectStore("occurrences", { keyPath: "id" }).createIndex("at", "at");
        d.createObjectStore("water", { keyPath: "id" }).createIndex("at", "at");
        d.createObjectStore("focus", { keyPath: "id" }).createIndex("startedAt", "startedAt");
        d.createObjectStore("audio", { keyPath: "id" });
      }
    },
  });
  return dbp;
}

/** For tests: forget the cached connection. */
export function resetDbForTests() {
  dbp = null;
}

/** Record an occurrence exactly once. Returns false if it was already recorded (duplicate tick). */
export async function recordOccurrence(o: { id: string; reminderId: string; scheduledAt: string; at: string }): Promise<boolean> {
  const tx = (await db()).transaction("occurrences", "readwrite");
  try {
    await tx.store.add(o);
    await tx.done;
    return true;
  } catch {
    try {
      await tx.done;
    } catch {
      /* ConstraintError: already recorded */
    }
    return false;
  }
}

export async function deliveredSince(iso: string): Promise<Set<string>> {
  const list = await (await db()).getAllFromIndex("occurrences", "at", IDBKeyRange.lowerBound(iso));
  return new Set(list.map((o) => o.id));
}

export async function addEvent(e: ReminderEvent): Promise<void> {
  try {
    await (await db()).add("events", e);
  } catch {
    /* duplicate (occurrenceId, action): ignore */
  }
}

export async function range<T extends "events" | "water">(store: T, from: string, to: string) {
  return (await db()).getAllFromIndex(store, "at", IDBKeyRange.bound(from, to, false, true));
}

export async function focusRange(from: string, to: string): Promise<FocusSession[]> {
  const all = await (await db()).getAllFromIndex("focus", "startedAt", IDBKeyRange.upperBound(to, true));
  return all.filter((f) => (f.endedAt ?? f.endsAt) >= from);
}
