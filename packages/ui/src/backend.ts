import type {
  Delivery,
  FocusSession,
  MessageTemplate,
  Reminder,
  ReminderEvent,
  RuntimeState,
  Settings,
  VoiceAsset,
  WaterEntry,
} from "@deskwell/domain";

export interface ActiveDelivery {
  items: Delivery[];
  showPopup: boolean;
  playVoice: boolean;
  createdAt: string;
}

export interface NextInfo {
  at: string;
  items: { reminderId: string; occurrenceId: string; name: string; category: string }[];
}

export interface Snapshot {
  platform: "desktop" | "extension";
  timeZone: string;
  settings: Settings;
  reminders: Reminder[];
  templates: MessageTemplate[];
  state: RuntimeState;
  next: NextInfo | null;
  active: ActiveDelivery | null;
}

export interface History {
  events: ReminderEvent[];
  water: WaterEntry[];
  focus: FocusSession[];
}

export type BackendEvent =
  | { type: "changed" }
  | { type: "deliver"; active: ActiveDelivery }
  | { type: "stop-voice" }
  | { type: "test-voice" }
  | { type: "navigate"; page: string }
  | { type: "timezone"; from: string; to: string };

export interface ExportedData {
  settings: Settings | null;
  reminders: Reminder[];
  templates: MessageTemplate[];
  history: History | null;
  audio: VoiceAsset[];
}

/**
 * Platform port. The desktop app implements it with Tauri commands (Rust + SQLite); the Chrome
 * extension implements it with chrome.storage + IndexedDB and its service worker.
 */
export interface Backend {
  platform: "desktop" | "extension";
  snapshot(): Promise<Snapshot>;
  subscribe(cb: (e: BackendEvent) => void): () => void;
  initDefaults(settings: Settings, reminders: Reminder[], templates: MessageTemplate[]): Promise<boolean>;
  saveSettings(s: Settings): Promise<void>;
  saveReminder(r: Reminder): Promise<void>;
  deleteReminder(id: string): Promise<void>;
  saveTemplate(t: MessageTemplate): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
  setPause(until: string | null): Promise<void>;
  startFocus(kind: "focus" | "meeting", minutes: number, opts: { pauseVoice: boolean; pausePopup: boolean; holdAll: boolean }): Promise<void>;
  stopFocus(): Promise<void>;
  act(occurrenceId: string, reminderId: string, action: "done" | "snoozed" | "skipped" | "muted_today" | "dismissed", snoozeMinutes?: number): Promise<void>;
  dismissPopup(): Promise<void>;
  addWater(ml: number): Promise<void>;
  undoWater(): Promise<boolean>;
  history(fromIso: string, toIso: string): Promise<History>;
  clearHistory(): Promise<void>;
  listAudio(): Promise<VoiceAsset[]>;
  importAudio(data: Blob, name: string, category: string, id?: string): Promise<{ id: string }>;
  readAudio(id: string): Promise<Blob>;
  updateAudio(id: string, patch: { name?: string; category?: string; durationSec?: number }): Promise<void>;
  deleteAudio(id: string): Promise<void>;
  exportData(withHistory: boolean): Promise<ExportedData>;
  importData(data: { settings: Settings; reminders: Reminder[]; templates: MessageTemplate[]; history: History | null }): Promise<void>;
  /** Desktop: atomic write into the app's backups folder. */
  writeBackupFile?(name: string, contents: string, keep?: number): Promise<string>;
  listBackupFiles?(): Promise<string[]>;
  getAutostart?(): Promise<boolean>;
  setAutostart?(enabled: boolean): Promise<void>;
  openDashboard(page?: string): Promise<void>;
  hideWindow?(label: string): Promise<void>;
  quit?(): Promise<void>;
  testVoice(): Promise<void>;
  /** Base URL for bundled voice-pack clips ("" = relative to the page). */
  assetBase: string;
}
