import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { localDate } from "@deskwell/domain";
import { AppProvider, Dashboard, Panel, Popup, buildBackup, useApp, type Backend } from "@deskwell/ui";
import "@deskwell/ui/styles.css";
import { createTauriBackend } from "./tauriBackend";

const backend = createTauriBackend();
const route = window.location.hash.replace(/^#\/?/, "").split("/")[0];

/** Once a day (while the main window process runs) write an automatic backup if enabled. */
function AutoBackup({ backend }: { backend: Backend }) {
  const { snap } = useApp();
  const enabled = snap?.settings.autoBackup.enabled;
  const keep = snap?.settings.autoBackup.keep ?? 7;
  const zone = snap?.timeZone ?? "UTC";
  useEffect(() => {
    if (!enabled || !backend.writeBackupFile || !backend.listBackupFiles) return;
    const check = async () => {
      try {
        const name = `auto-${localDate(Date.now(), zone)}.json`;
        const files = await backend.listBackupFiles!();
        if (files.includes(name)) return;
        const b = await buildBackup(backend, true, false);
        await backend.writeBackupFile!(name, JSON.stringify(b), keep);
      } catch (e) {
        console.warn("DeskWell auto-backup failed", e);
      }
    };
    void check();
    const t = window.setInterval(check, 60 * 60 * 1000);
    return () => window.clearInterval(t);
  }, [enabled, keep, zone]);
  return null;
}

function Root() {
  if (route === "panel")
    return (
      <AppProvider backend={backend} role="panel">
        <Panel onClose={() => void backend.hideWindow?.("panel")} />
      </AppProvider>
    );
  if (route === "popup")
    return (
      <AppProvider backend={backend} role="popup">
        <Popup onEmpty={() => void backend.hideWindow?.("popup")} />
      </AppProvider>
    );
  return (
    <AppProvider backend={backend} role="main">
      <AutoBackup backend={backend} />
      <Dashboard />
    </AppProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
