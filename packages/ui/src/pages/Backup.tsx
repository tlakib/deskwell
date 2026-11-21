import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { BRAND, nowIso, parseBackup, sealBackup, type Backup as B, type BackupPreview } from "@deskwell/domain";
import { PageTitle } from "../Dashboard";
import type { Backend } from "../backend";
import { Button, Card, Toggle } from "../components/ui";
import { useAction, useApp } from "../store";
import { downloadText } from "./History";

async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Build a sealed backup. Exported for the auto-backup timer. */
export async function buildBackup(backend: Backend, withHistory: boolean, withAudio: boolean): Promise<B> {
  const d = await backend.exportData(withHistory);
  if (!d.settings) throw new Error("Nothing to back up yet.");
  const audio = withAudio ? await Promise.all(d.audio.map(async (a) => ({ ...a, dataBase64: await blobToBase64(await backend.readAudio(a.id)) }))) : null;
  return sealBackup({
    format: "deskwell-backup",
    version: 1,
    createdAt: nowIso(),
    app: `${BRAND.name} ${BRAND.version}`,
    platform: backend.platform,
    settings: d.settings,
    reminders: d.reminders,
    templates: d.templates,
    history: withHistory ? d.history : null,
    audio,
  });
}

export default function Backup() {
  const { snap, backend } = useApp();
  const run = useAction();
  const [withHistory, setWithHistory] = useState(true);
  const [withAudio, setWithAudio] = useState(true);
  const [pending, setPending] = useState<{ backup: B; preview: BackupPreview } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    backend.listBackupFiles?.().then(setFiles).catch(() => undefined);
  }, [backend, snap?.settings.updatedAt]);
  if (!snap) return null;
  const s = snap.settings;

  const exportNow = () =>
    run(async () => {
      const b = await buildBackup(backend, withHistory, withAudio);
      downloadText(`deskwell-backup-${b.createdAt.slice(0, 10)}.json`, JSON.stringify(b, null, 2));
    }, "Backup downloaded");

  const onFile = async (f: File | undefined) => {
    setError(null);
    setPending(null);
    if (!f) return;
    const r = await parseBackup(await f.text());
    if (!r.backup) setError(r.preview.error ?? "Invalid backup.");
    else setPending({ backup: r.backup, preview: r.preview });
    if (input.current) input.current.value = "";
  };

  const restore = () =>
    pending &&
    run(async () => {
      // Safety backup of the current data first, so a restore can always be undone.
      const safety = await buildBackup(backend, true, false);
      const text = JSON.stringify(safety);
      if (backend.writeBackupFile) await backend.writeBackupFile(`safety-${safety.createdAt.replace(/[:.]/g, "-")}.json`, text);
      else downloadText(`deskwell-safety-${safety.createdAt.slice(0, 10)}.json`, text);
      const b = pending.backup;
      for (const a of b.audio ?? []) {
        const bin = Uint8Array.from(atob(a.dataBase64), (c) => c.charCodeAt(0));
        await backend.importAudio(new Blob([bin], { type: a.mime }), a.name, a.category, a.id);
      }
      await backend.importData({ settings: b.settings, reminders: b.reminders, templates: b.templates, history: b.history });
      setPending(null);
    }, "Backup restored. A safety copy of your previous data was saved first.");

  return (
    <>
      <PageTitle title="Backup & Sync" subtitle="Your data stays on this device unless you export it." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Export">
          <Toggle label="Include history" checked={withHistory} onChange={setWithHistory} />
          <Toggle label="Include uploaded audio" checked={withAudio} onChange={setWithAudio} />
          <Button className="mt-2" variant="primary" onClick={exportNow}>
            <Download size={15} /> Download backup
          </Button>
          <p className="mt-2 text-xs text-fg-subtle">A JSON file with a SHA-256 checksum. Works across the desktop app and the Chrome extension.</p>
        </Card>
        <Card title="Restore">
          <input ref={input} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          <Button onClick={() => input.current?.click()}>
            <Upload size={15} /> Choose backup file
          </Button>
          {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
          {pending && (
            <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3 text-sm">
              <div className="font-medium">Backup from {new Date(pending.preview.createdAt!).toLocaleString()}</div>
              <ul className="mt-1 text-xs text-fg-muted">
                <li>{pending.preview.reminders} reminders, {pending.preview.templates} messages</li>
                <li>{pending.preview.events} history events, {pending.preview.waterEntries} water entries</li>
                <li>{pending.preview.audioFiles} audio files · made on {pending.preview.platform}</li>
              </ul>
              <p className="mt-2 text-xs">Restoring replaces your current settings, reminders and messages{pending.backup.history ? " and history" : ""}.</p>
              <div className="mt-2 flex gap-2">
                <Button variant="primary" size="sm" onClick={restore}>
                  Restore
                </Button>
                <Button size="sm" onClick={() => setPending(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
        {backend.writeBackupFile && (
          <Card title="Automatic backups">
            <Toggle label="Back up automatically once a day" checked={s.autoBackup.enabled} onChange={(v) => run(() => backend.saveSettings({ ...s, autoBackup: { ...s.autoBackup, enabled: v }, updatedAt: nowIso() }))} />
            <p className="text-xs text-fg-subtle">Keeps the newest {s.autoBackup.keep} copies (without audio) in the app's backups folder.</p>
            {files.length > 0 && (
              <ul className="mt-2 max-h-32 overflow-y-auto text-xs text-fg-muted">
                {files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </Card>
        )}
        <Card title="Sync">
          <p className="text-sm text-fg-muted">
            <span className="mr-2 rounded bg-surface-3 px-1.5 py-0.5 text-[11px] font-medium text-fg">Local only</span>
            Cloud sync is not available in this version. Move data between devices with export and restore. The code has a sync provider interface with conflict rules ready for a future, opt-in sync.
          </p>
        </Card>
      </div>
    </>
  );
}
