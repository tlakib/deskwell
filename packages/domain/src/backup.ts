import { z } from "zod";
import {
  FocusSessionSchema,
  MessageTemplateSchema,
  ReminderEventSchema,
  ReminderSchema,
  SettingsSchema,
  VoiceAssetSchema,
  WaterEntrySchema,
} from "./types";

export const BACKUP_FORMAT = "deskwell-backup";
export const BACKUP_VERSION = 1;

export const BackupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  createdAt: z.string(),
  app: z.string(),
  platform: z.enum(["desktop", "extension"]),
  settings: SettingsSchema,
  reminders: z.array(ReminderSchema),
  templates: z.array(MessageTemplateSchema),
  history: z
    .object({
      events: z.array(ReminderEventSchema),
      water: z.array(WaterEntrySchema),
      focus: z.array(FocusSessionSchema),
    })
    .nullable(),
  audio: z.array(VoiceAssetSchema.extend({ dataBase64: z.string() })).nullable(),
  /** SHA-256 hex of the canonical JSON of everything except this field. */
  checksum: z.string(),
});
export type Backup = z.infer<typeof BackupSchema>;

export interface BackupPreview {
  ok: boolean;
  error?: string;
  createdAt?: string;
  platform?: string;
  reminders?: number;
  templates?: number;
  events?: number;
  waterEntries?: number;
  audioFiles?: number;
}

/** Stable JSON stringify (sorted keys) used for checksums. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sealBackup(b: Omit<Backup, "checksum">): Promise<Backup> {
  return { ...b, checksum: await sha256Hex(canonicalJson(b)) };
}

/** Validate a backup file's text. Never throws; returns a parsed backup or a readable error. */
export async function parseBackup(text: string): Promise<{ backup: Backup; preview: BackupPreview } | { backup: null; preview: BackupPreview }> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { backup: null, preview: { ok: false, error: "The file is not valid JSON." } };
  }
  const parsed = BackupSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { backup: null, preview: { ok: false, error: `Not a valid DeskWell backup (${issue?.path.join(".") || "root"}: ${issue?.message}).` } };
  }
  const { checksum, ...rest } = parsed.data;
  const expected = await sha256Hex(canonicalJson((raw as Record<string, unknown>) && stripChecksum(raw as Record<string, unknown>)));
  if (checksum !== expected) {
    // Also accept checksum computed over the parsed (defaults-filled) payload.
    const alt = await sha256Hex(canonicalJson(rest));
    if (checksum !== alt) return { backup: null, preview: { ok: false, error: "Integrity check failed: the backup file was modified or is corrupt." } };
  }
  const b = parsed.data;
  return {
    backup: b,
    preview: {
      ok: true,
      createdAt: b.createdAt,
      platform: b.platform,
      reminders: b.reminders.length,
      templates: b.templates.length,
      events: b.history?.events.length ?? 0,
      waterEntries: b.history?.water.length ?? 0,
      audioFiles: b.audio?.length ?? 0,
    },
  };
}

function stripChecksum(o: Record<string, unknown>): Record<string, unknown> {
  const { checksum: _c, ...rest } = o;
  return rest;
}
