import { z } from "zod";

/** "HH:MM" 24-hour local wall-clock time. "24:00" is allowed only as a window end. */
export const HmSchema = z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/, "Expected HH:MM");
/** "YYYY-MM-DD" local calendar date. */
export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
/** "YYYY-MM-DDTHH:MM" local date-time without offset (interpreted in the device timezone). */
export const LocalDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Expected YYYY-MM-DDTHH:MM");

export const CATEGORIES = [
  "water",
  "stand",
  "walk",
  "eyes",
  "stretch",
  "posture",
  "breathing",
  "rest",
  "meal",
  "custom",
] as const;
export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

export const DELIVERY_MODES = ["popup_voice", "popup", "voice", "silent", "disabled"] as const;
export const DeliveryModeSchema = z.enum(DELIVERY_MODES);
export type DeliveryMode = z.infer<typeof DeliveryModeSchema>;

export const LANGUAGES = ["en", "bn", "de"] as const;
export const LanguageSchema = z.enum(LANGUAGES);
export type Language = z.infer<typeof LanguageSchema>;

export const TimeWindowSchema = z.object({
  /** Window start, local time. */
  start: HmSchema,
  /** Window end, local time. If end <= start the window crosses midnight. start == end means all day. */
  end: HmSchema,
});
export type TimeWindow = z.infer<typeof TimeWindowSchema>;

/** ISO weekday numbers: 1 = Monday ... 7 = Sunday. */
export const WeekdaySchema = z.number().int().min(1).max(7);

export const ScheduleSchema = z.object({
  /**
   * interval: every N minutes inside the active window on active days.
   * daily: fixed local times on active days.
   * once: a single local date-time.
   * dates: fixed local times on a custom list of dates.
   */
  type: z.enum(["interval", "daily", "once", "dates"]),
  intervalMinutes: z.number().int().min(1).max(24 * 60).default(30),
  /** Fixed local times. Used by daily/dates; with interval they are added on top ("both"). */
  times: z.array(HmSchema).default([]),
  days: z.array(WeekdaySchema).default([1, 2, 3, 4, 5]),
  dates: z.array(LocalDateSchema).default([]),
  onceAt: LocalDateTimeSchema.nullable().default(null),
  /** Active window for interval reminders. null = use work hours (if useWorkHours) or the whole day. */
  window: TimeWindowSchema.nullable().default(null),
  useWorkHours: z.boolean().default(true),
  startDate: LocalDateSchema.nullable().default(null),
  endDate: LocalDateSchema.nullable().default(null),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

export const VoiceChoiceSchema = z.object({
  /**
   * pack = play the bundled studio voice clip for the category (male "Akib" or female "Rimjhim"),
   * tts = speak the message with a system voice, audio = play uploaded audio, none = no sound.
   */
  mode: z.enum(["pack", "tts", "audio", "none"]).default("pack"),
  packId: z.enum(["akib", "rimjhim"]).default("akib"),
  /** Name of a saved voice profile; null = the default voice profile. */
  profileId: z.string().nullable().default(null),
  audioIds: z.array(z.string()).default([]),
  randomAudio: z.boolean().default(false),
  /** 0..1 */
  volume: z.number().min(0).max(1).default(1),
});
export type VoiceChoice = z.infer<typeof VoiceChoiceSchema>;

export const ReminderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  category: CategorySchema,
  /** Messages; one is picked (randomly if randomMessage). Empty = use the category's template library. */
  messages: z.array(z.string().max(500)).default([]),
  randomMessage: z.boolean().default(true),
  language: LanguageSchema.default("en"),
  enabled: z.boolean().default(true),
  schedule: ScheduleSchema,
  delivery: DeliveryModeSchema.default("popup_voice"),
  voice: VoiceChoiceSchema.default({ mode: "pack", packId: "akib", profileId: null, audioIds: [], randomAudio: false, volume: 1 }),
  snoozeOptions: z.array(z.number().int().min(1).max(240)).default([5, 10, 15]),
  /** After a snooze: "wait" = natural occurrences before the snooze end are skipped; "keep" = they still fire. */
  snoozePolicy: z.enum(["wait", "keep"]).default("wait"),
  priority: z.enum(["normal", "important"]).default("normal"),
  respectQuietHours: z.boolean().default(true),
  /** Combine with other grouped reminders due in the same minute. */
  group: z.boolean().default(true),
  pauseInFocus: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
  revision: z.number().int().min(0).default(0),
});
export type Reminder = z.infer<typeof ReminderSchema>;

export const QuietHoursSchema = z.object({
  id: z.string(),
  enabled: z.boolean().default(true),
  start: HmSchema,
  end: HmSchema,
  days: z.array(WeekdaySchema).default([1, 2, 3, 4, 5, 6, 7]),
});
export type QuietHours = z.infer<typeof QuietHoursSchema>;

export const WorkProfileSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(40),
  days: z.array(WeekdaySchema).default([1, 2, 3, 4, 5]),
  start: HmSchema,
  end: HmSchema,
  /** Fixed break windows (e.g. lunch). Interval reminders don't fire inside these. */
  breaks: z.array(TimeWindowSchema.extend({ name: z.string().default("Break") })).default([]),
});
export type WorkProfile = z.infer<typeof WorkProfileSchema>;

export const VoiceProfileSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(60),
  language: LanguageSchema.default("en"),
  /** Provider voice name exactly as reported by the engine; null = engine default for the language. */
  voiceName: z.string().nullable().default(null),
  provider: z.string().default("system"),
  rate: z.number().min(0.5).max(2).default(1),
  pitch: z.number().min(0).max(2).default(1),
  volume: z.number().min(0).max(1).default(1),
});
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;

export const MessageTemplateSchema = z.object({
  id: z.string(),
  category: CategorySchema,
  language: LanguageSchema,
  text: z.string().min(1).max(500),
  order: z.number().int().default(0),
  builtIn: z.boolean().default(false),
});
export type MessageTemplate = z.infer<typeof MessageTemplateSchema>;

export const SettingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  language: LanguageSchema.default("en"),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  timeFormat: z.enum(["system", "12", "24"]).default("system"),
  weekStart: WeekdaySchema.default(1),
  workEnabled: z.boolean().default(true),
  activeProfileId: z.string().default("office"),
  profiles: z.array(WorkProfileSchema).default([]),
  quietHours: z.array(QuietHoursSchema).default([]),
  /** Show the native OS notification in addition to the DeskWell popup. */
  nativeNotifications: z.boolean().default(true),
  /** Seconds before the popup auto-hides (0 = stay until answered). */
  popupSeconds: z.number().int().min(0).max(3600).default(60),
  popupPosition: z.enum(["bottom-right", "top-right", "center"]).default("bottom-right"),
  sound: z.boolean().default(true),
  masterVolume: z.number().min(0).max(1).default(0.9),
  defaultVoiceProfileId: z.string().nullable().default(null),
  voiceProfiles: z.array(VoiceProfileSchema).default([]),
  catchUp: z.enum(["skip", "summary"]).default("skip"),
  focusDefaults: z.object({ pauseVoice: z.boolean().default(true), pausePopup: z.boolean().default(false) }).default({
    pauseVoice: true,
    pausePopup: false,
  }),
  idlePolicy: z.enum(["ignore", "pause_all", "pause_normal"]).default("ignore"),
  idleMinutes: z.number().int().min(1).max(120).default(5),
  water: z
    .object({
      goalMl: z.number().int().min(0).max(20000).default(2000),
      unit: z.enum(["ml", "oz", "glass"]).default("ml"),
      glassMl: z.number().int().min(50).max(2000).default(250),
      containers: z.array(z.number().int().min(10).max(5000)).default([150, 250, 500]),
    })
    .default({ goalMl: 2000, unit: "ml", glassMl: 250, containers: [150, 250, 500] }),
  autoBackup: z.object({ enabled: z.boolean().default(false), keep: z.number().int().min(1).max(60).default(7) }).default({
    enabled: false,
    keep: 7,
  }),
  /** The IANA timezone DeskWell last saw. Used only to tell the user when it changes. */
  lastSeenTimeZone: z.string().nullable().default(null),
  onboarded: z.boolean().default(false),
  updatedAt: z.string().default(""),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const FocusStateSchema = z.object({
  kind: z.enum(["focus", "meeting"]),
  startedAt: z.string(),
  endsAt: z.string(),
  pauseVoice: z.boolean(),
  pausePopup: z.boolean(),
  /** meeting mode: hold everything (true) or only pause voice/popup per flags. */
  holdAll: z.boolean().default(false),
});
export type FocusState = z.infer<typeof FocusStateSchema>;

export const RuntimeStateSchema = z.object({
  /** null = running, "indefinite" = paused until resumed, or an ISO instant. */
  pausedUntil: z.string().nullable().default(null),
  focus: FocusStateSchema.nullable().default(null),
  /** reminderId -> ISO instant the snooze ends */
  snoozes: z.record(z.string(), z.string()).default({}),
  /** reminderId -> local date (YYYY-MM-DD) on which it is muted for the rest of the day */
  mutedToday: z.record(z.string(), LocalDateSchema).default({}),
  /** reminderId -> ISO instant of the last interval anchor reset (not used by default rules) */
  lastTickAt: z.string().nullable().default(null),
});
export type RuntimeState = z.infer<typeof RuntimeStateSchema>;

export const EVENT_ACTIONS = ["delivered", "done", "snoozed", "skipped", "muted_today", "missed", "dismissed"] as const;
export const EventActionSchema = z.enum(EVENT_ACTIONS);
export type EventAction = z.infer<typeof EventActionSchema>;

export const ReminderEventSchema = z.object({
  id: z.string(),
  occurrenceId: z.string(),
  reminderId: z.string(),
  category: CategorySchema,
  action: EventActionSchema,
  /** UTC ISO instant the occurrence was scheduled for. */
  scheduledAt: z.string(),
  /** UTC ISO instant the action happened. */
  at: z.string(),
  timeZone: z.string(),
  detail: z.string().nullable().default(null),
});
export type ReminderEvent = z.infer<typeof ReminderEventSchema>;

export const WaterEntrySchema = z.object({
  id: z.string(),
  ml: z.number().int().min(1).max(5000),
  at: z.string(),
  timeZone: z.string(),
});
export type WaterEntry = z.infer<typeof WaterEntrySchema>;

export const FocusSessionSchema = z.object({
  id: z.string(),
  kind: z.enum(["focus", "meeting"]),
  startedAt: z.string(),
  endsAt: z.string(),
  endedAt: z.string().nullable().default(null),
});
export type FocusSession = z.infer<typeof FocusSessionSchema>;

export const VoiceAssetSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  category: z.string().default("General"),
  mime: z.string(),
  bytes: z.number().int().min(1),
  durationSec: z.number().nullable().default(null),
  createdAt: z.string(),
});
export type VoiceAsset = z.infer<typeof VoiceAssetSchema>;

/** A due reminder occurrence the clients should present. */
export interface Delivery {
  occurrenceId: string;
  reminderId: string;
  name: string;
  category: Category;
  message: string;
  scheduledAt: string;
  delivery: DeliveryMode;
  voice: VoiceChoice;
  language: Language;
  snoozeOptions: number[];
  priority: "normal" | "important";
}
