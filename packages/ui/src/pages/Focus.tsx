import { useState } from "react";
import { Brain, Users } from "lucide-react";
import { formatCountdown, formatTime, nowIso } from "@deskwell/domain";
import { PageTitle } from "../Dashboard";
import { Button, Card, Field, Input, Toggle } from "../components/ui";
import { useHistory } from "../hooks";
import { useAction, useApp } from "../store";

export default function Focus() {
  const { snap, backend, now } = useApp();
  const run = useAction();
  const { history } = useHistory(7);
  const [minutes, setMinutes] = useState(25);
  const [holdAll, setHoldAll] = useState(false);
  if (!snap) return null;
  const s = snap.settings;
  const f = snap.state.focus;
  const opts = { pauseVoice: s.focusDefaults.pauseVoice, pausePopup: s.focusDefaults.pausePopup };

  return (
    <>
      <PageTitle title="Focus & Breaks" subtitle="Hold normal reminders while you concentrate or are in a meeting." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={f ? (f.kind === "focus" ? "Focus mode is on" : "Meeting mode is on") : "Start a session"}>
          {f ? (
            <>
              <div className="text-3xl font-semibold tabular-nums">{formatCountdown(Date.parse(f.endsAt) - now)}</div>
              <p className="text-xs text-fg-muted">Ends at {formatTime(Date.parse(f.endsAt), snap.timeZone, s.timeFormat)}. Important reminders are held until then.</p>
              <Button className="mt-3" variant="primary" onClick={() => run(() => backend.stopFocus(), "Session ended")}>
                End now
              </Button>
            </>
          ) : (
            <>
              <Field label="Minutes">
                <Input type="number" min={1} max={480} value={minutes} onChange={(e) => setMinutes(Math.max(1, Math.min(480, Number(e.target.value) || 1)))} />
              </Field>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[15, 25, 45, 60, 90].map((m) => (
                  <Button key={m} size="sm" variant={m === minutes ? "primary" : "soft"} onClick={() => setMinutes(m)}>
                    {m}
                  </Button>
                ))}
              </div>
              <Toggle label="Meeting mode: hold all reminders" description="Off = important reminders still come through." checked={holdAll} onChange={setHoldAll} />
              <div className="mt-3 flex gap-2">
                <Button variant="primary" onClick={() => run(() => backend.startFocus("focus", minutes, { ...opts, holdAll: false }), `Focus for ${minutes} min`)}>
                  <Brain size={15} /> Start focus
                </Button>
                <Button onClick={() => run(() => backend.startFocus("meeting", minutes, { ...opts, holdAll }), `Meeting mode for ${minutes} min`)}>
                  <Users size={15} /> Meeting mode
                </Button>
              </div>
            </>
          )}
        </Card>
        <Card title="While focusing">
          <Toggle label="Mute voice" checked={s.focusDefaults.pauseVoice} onChange={(v) => run(() => backend.saveSettings({ ...s, focusDefaults: { ...s.focusDefaults, pauseVoice: v }, updatedAt: nowIso() }))} />
          <Toggle label="Hide popups (notification only)" checked={s.focusDefaults.pausePopup} onChange={(v) => run(() => backend.saveSettings({ ...s, focusDefaults: { ...s.focusDefaults, pausePopup: v }, updatedAt: nowIso() }))} />
          <p className="mt-2 text-xs text-fg-subtle">Normal reminders due during focus are skipped (no backlog). Important ones are delivered once when focus ends.</p>
        </Card>
        <Card title="Recent sessions" className="lg:col-span-2">
          <ul className="space-y-1 text-sm">
            {(history?.focus ?? [])
              .slice()
              .reverse()
              .slice(0, 10)
              .map((x) => {
                const end = Date.parse(x.endedAt ?? x.endsAt);
                return (
                  <li key={x.id} className="flex gap-3 text-fg-muted">
                    <span className="w-20 capitalize text-fg">{x.kind}</span>
                    <span>
                      {new Date(x.startedAt).toLocaleDateString(undefined, { timeZone: snap.timeZone })} {formatTime(Date.parse(x.startedAt), snap.timeZone, s.timeFormat)}
                    </span>
                    <span>{Math.max(0, Math.round((end - Date.parse(x.startedAt)) / 60000))} min</span>
                  </li>
                );
              })}
            {!history?.focus.length && <li className="text-fg-muted">No sessions in the last 7 days.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
