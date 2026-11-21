import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ActiveDelivery, Backend, ExportedData, History, Snapshot } from "@deskwell/ui";

/** Desktop implementation of the UI's Backend port: Tauri commands backed by Rust + SQLite. */
export function createTauriBackend(): Backend {
  const call = <T>(cmd: string, args?: Record<string, unknown>) => invoke<T>(cmd, args);
  return {
    platform: "desktop",
    assetBase: "",
    snapshot: () => call<Snapshot>("get_snapshot"),
    subscribe(cb) {
      const offs: Promise<UnlistenFn>[] = [
        listen("deskwell://changed", () => cb({ type: "changed" })),
        listen<ActiveDelivery>("deskwell://deliver", (e) => cb({ type: "deliver", active: e.payload })),
        listen("deskwell://stop-voice", () => cb({ type: "stop-voice" })),
        listen("deskwell://test-voice", () => cb({ type: "test-voice" })),
        listen<string>("deskwell://navigate", (e) => cb({ type: "navigate", page: e.payload })),
        listen<{ from: string; to: string }>("deskwell://timezone-changed", (e) => cb({ type: "timezone", from: e.payload.from, to: e.payload.to })),
        listen("deskwell://tick", () => cb({ type: "changed" })),
      ];
      return () => offs.forEach((p) => void p.then((off) => off()));
    },
    initDefaults: (settings, reminders, templates) => call("init_defaults", { settings, reminders, templates }),
    saveSettings: (settings) => call("save_settings", { settings }),
    saveReminder: (reminder) => call("save_reminder", { reminder }),
    deleteReminder: (id) => call("delete_reminder", { id }),
    saveTemplate: (template) => call("save_template", { template }),
    deleteTemplate: (id) => call("delete_template", { id }),
    setPause: (until) => call("set_pause", { until }),
    startFocus: (kind, minutes, o) => call("start_focus", { kind, minutes, pauseVoice: o.pauseVoice, pausePopup: o.pausePopup, holdAll: o.holdAll }),
    stopFocus: () => call("stop_focus"),
    act: (occurrenceId, reminderId, action, snoozeMinutes) => call("act", { occurrenceId, reminderId, action, snoozeMinutes: snoozeMinutes ?? null }),
    dismissPopup: () => call("dismiss_popup"),
    addWater: (ml) => call("add_water", { ml }),
    undoWater: () => call<boolean>("undo_water"),
    history: (from, to) => call<History>("list_history", { from, to }),
    clearHistory: () => call("clear_history"),
    listAudio: () => call("list_audio"),
    async importAudio(data, name, category, id) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      return invoke<{ id: string }>("import_audio", bytes, {
        headers: { "x-name": encodeURIComponent(name), "x-category": encodeURIComponent(category), "x-id": id ?? "" },
      });
    },
    async readAudio(id) {
      const buf = await invoke<ArrayBuffer>("read_audio", { id });
      return new Blob([buf]);
    },
    updateAudio: (id, p) => call("update_audio", { id, name: p.name ?? null, category: p.category ?? null, durationSec: p.durationSec ?? null }),
    deleteAudio: (id) => call("delete_audio", { id }),
    exportData: (withHistory) => call<ExportedData>("export_data", { withHistory }),
    importData: (data) => call("import_data", { data }),
    writeBackupFile: (name, contents, keep) => call<string>("write_backup_file", { name, contents, keep: keep ?? null }),
    listBackupFiles: () => call<string[]>("list_backup_files"),
    getAutostart: () => call<boolean>("get_autostart"),
    setAutostart: (enabled) => call("set_autostart", { enabled }),
    openDashboard: (page) => call("open_dashboard", { page: page ?? null }),
    hideWindow: (label) => call("hide_window", { label }),
    quit: () => call("quit_app"),
    testVoice: () => call("test_voice"),
  };
}
