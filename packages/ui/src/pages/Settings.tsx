import { useEffect, useState } from "react";
import { ExternalLink, Linkedin, Power } from "lucide-react";
import { BRAND, LANGUAGE_TAGS, LANGUAGES, nowIso, type Language, type Settings as S } from "@deskwell/domain";
import { PageTitle } from "../Dashboard";
import { Button, Card, Field, Input, Select, Toggle } from "../components/ui";
import { useAction, useApp } from "../store";

export default function Settings() {
  const { snap, backend } = useApp();
  const run = useAction();
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => {
    backend.getAutostart?.().then(setAutostart).catch(() => setAutostart(null));
  }, [backend]);
  if (!snap) return null;
  const s = snap.settings;
  const save = (p: Partial<S>) => run(() => backend.saveSettings({ ...s, ...p, updatedAt: nowIso() }));
  const desktop = snap.platform === "desktop";

  return (
    <>
      <PageTitle title="Settings" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="General">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Default language">
              <Select value={s.language} onChange={(e) => save({ language: e.target.value as Language })}>
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_TAGS[l].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Theme">
              <Select value={s.theme} onChange={(e) => save({ theme: e.target.value as S["theme"] })}>
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            </Field>
            <Field label="Time format">
              <Select value={s.timeFormat} onChange={(e) => save({ timeFormat: e.target.value as S["timeFormat"] })}>
                <option value="system">System</option>
                <option value="12">12-hour</option>
                <option value="24">24-hour</option>
              </Select>
            </Field>
            <Field label="Week starts on">
              <Select value={s.weekStart} onChange={(e) => save({ weekStart: Number(e.target.value) })}>
                <option value={1}>Monday</option>
                <option value={6}>Saturday</option>
                <option value={7}>Sunday</option>
              </Select>
            </Field>
          </div>
          <p className="mt-3 text-xs text-fg-subtle">Timezone: {snap.timeZone} (from this device; change it in your system settings).</p>
          {autostart !== null && <Toggle label="Start DeskWell when I sign in" checked={autostart} onChange={(v) => run(async () => { await backend.setAutostart!(v); setAutostart(v); })} />}
        </Card>

        <Card title="Popups & notifications">
          <Toggle label={desktop ? "Also show a system notification" : "Show Chrome notifications"} checked={s.nativeNotifications} onChange={(v) => save({ nativeNotifications: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hide popup after (seconds, 0 = never)">
              <Input type="number" min={0} max={3600} defaultValue={s.popupSeconds} onBlur={(e) => save({ popupSeconds: Math.max(0, Math.min(3600, Math.round(Number(e.target.value) || 0))) })} />
            </Field>
            {desktop && (
              <Field label="Popup position">
                <Select value={s.popupPosition} onChange={(e) => save({ popupPosition: e.target.value as S["popupPosition"] })}>
                  <option value="bottom-right">Bottom right</option>
                  <option value="top-right">Top right</option>
                  <option value="center">Centre</option>
                </Select>
              </Field>
            )}
          </div>
          <Field label={`Master volume ${Math.round(s.masterVolume * 100)}%`}>
            <input className="w-full accent-[var(--color-accent)]" type="range" min={0} max={1} step={0.05} defaultValue={s.masterVolume} onMouseUp={(e) => save({ masterVolume: Number((e.target as HTMLInputElement).value) })} onKeyUp={(e) => save({ masterVolume: Number((e.target as HTMLInputElement).value) })} />
          </Field>
          <Field label="After the computer was asleep or off">
            <Select value={s.catchUp} onChange={(e) => save({ catchUp: e.target.value as S["catchUp"] })}>
              <option value="skip">Skip missed reminders quietly</option>
              <option value="summary">Show one short summary</option>
            </Select>
          </Field>
          <p className="mt-2 text-xs text-fg-subtle">DeskWell never fires a burst of old reminders.</p>
        </Card>

        <Card title="When I'm away">
          <Field label="If the computer is idle">
            <Select value={s.idlePolicy} onChange={(e) => save({ idlePolicy: e.target.value as S["idlePolicy"] })}>
              <option value="ignore">Keep reminding</option>
              <option value="pause_all">Hold all reminders</option>
              <option value="pause_normal">Hold normal reminders</option>
            </Select>
          </Field>
          <Field label="Idle after (minutes)">
            <Input type="number" min={1} max={120} defaultValue={s.idleMinutes} onBlur={(e) => save({ idleMinutes: Math.max(1, Math.min(120, Math.round(Number(e.target.value) || 5))) })} />
          </Field>
          <p className="mt-2 text-xs text-fg-subtle">
            {desktop ? "Desktop app: idle detection is not implemented yet; this setting is saved but has no effect." : "Uses Chrome's idle state (no activity in Chrome or the system)."} DeskWell never records keystrokes, screens or browsing.
          </p>
        </Card>

        <Card title="About">
          <div className="flex items-center gap-3">
            <img src="icon.png" alt="" className="h-12 w-12 rounded-xl" />
            <div>
              <div className="font-semibold">
                {BRAND.name} <span className="text-xs font-normal text-fg-muted">v{BRAND.version}</span>
              </div>
              <div className="text-xs text-fg-muted">{BRAND.tagline}</div>
            </div>
          </div>
          <p className="mt-3 text-sm">
            Made by <b>{BRAND.author}</b>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <a className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm hover:bg-surface-3" href={BRAND.authorLinkedIn} target="_blank" rel="noreferrer">
              <Linkedin size={14} /> LinkedIn
            </a>
            <a className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm hover:bg-surface-3" href={BRAND.repository} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> Source code
            </a>
          </div>
          <p className="mt-3 text-xs text-fg-muted">Free and open source under the {BRAND.license} license. Bundled voices were generated with ElevenLabs.</p>
          <p className="mt-2 text-xs text-fg-muted">{BRAND.disclaimer}</p>
          {backend.quit && (
            <Button className="mt-3" variant="danger" size="sm" onClick={() => run(() => backend.quit!())}>
              <Power size={14} /> Quit DeskWell
            </Button>
          )}
        </Card>
      </div>
    </>
  );
}
