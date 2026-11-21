import type { Backend, BackendEvent } from "@deskwell/ui";
import * as core from "./core";

/** Extension implementation of the UI's Backend port (chrome.storage + IndexedDB + service worker). */
export function createExtensionBackend(): Backend {
  const send = (type: string) => chrome.runtime.sendMessage({ type }).catch(() => undefined);
  return {
    platform: "extension",
    assetBase: "",
    snapshot: core.snapshot,
    subscribe(cb: (e: BackendEvent) => void) {
      const onStore = (_c: Record<string, chrome.storage.StorageChange>, area: string) => area === "local" && cb({ type: "changed" });
      const onMsg = (m: { type?: string; target?: string; from?: string; to?: string; active?: never }) => {
        if (m.target) return;
        if (m.type === "deliver" && m.active) cb({ type: "deliver", active: m.active });
        if (m.type === "timezone" && m.from && m.to) cb({ type: "timezone", from: m.from, to: m.to });
      };
      chrome.storage.onChanged.addListener(onStore);
      chrome.runtime.onMessage.addListener(onMsg);
      return () => {
        chrome.storage.onChanged.removeListener(onStore);
        chrome.runtime.onMessage.removeListener(onMsg);
      };
    },
    initDefaults: core.initDefaults,
    saveSettings: core.saveSettings,
    saveReminder: core.saveReminder,
    deleteReminder: core.deleteReminder,
    saveTemplate: core.saveTemplate,
    deleteTemplate: core.deleteTemplate,
    setPause: core.setPause,
    startFocus: core.startFocus,
    stopFocus: core.stopFocus,
    act: core.act,
    dismissPopup: core.dismissPopup,
    addWater: core.addWater,
    undoWater: core.undoWater,
    history: core.history,
    clearHistory: core.clearHistory,
    listAudio: core.listAudio,
    importAudio: core.importAudio,
    readAudio: core.readAudio,
    updateAudio: core.updateAudio,
    deleteAudio: core.deleteAudio,
    exportData: core.exportData,
    importData: core.importData,
    async openDashboard(page) {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${page ? `#/${page}` : ""}`) });
    },
    async testVoice() {
      await send("test-voice");
    },
  };
}
