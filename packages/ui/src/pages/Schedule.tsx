import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { formatTime, localDate, nowIso, occurrencesBetween, uuid, type QuietHours, type Settings, type WorkProfile } from "@deskwell/domain";
import { PageTitle } from "../Dashboard";
import { CATEGORY_ICON, Button, Card, DayPicker, Field, Input, Select, Toggle } from "../components/ui";
import { useAction, useApp } from "../store";

export default function Schedule() {
  const { snap, backend, now } = useApp();
  const run = useAction();
  const [draft, setDraft] = useState<Settings | null>(null);
  if (!snap) return null;
  const s = draft ?? snap.settings;
  const dirty = draft !== null;
  const update = (p: Partial<Settings>) => setDraft({ ...s, ...p });
  const profile = s.profiles.find((p) => p.id === s.activeProfileId) ?? s.profiles[0];
  const setProfile = (p: WorkProfile) => update({ profiles: s.profiles.map((x) => (x.id === p.id ? p : x)) });
  const setQuiet = (q: QuietHours) => update({ quietHours: s.quietHours.map((x) => (x.id === q.id ? q : x)) });

  const ctx = { zone: snap.timeZone, settings: s };
  const horizon = now + 24 * 3600_000;
  const upcoming = snap.reminders
    .filter((r) => r.enabled && r.delivery !== "disabled")
    .flatMap((r) => occurrencesBetween(r, now, horizon, ctx, 50).map((t) => ({ r, t })))
    .sort((a, b) => a.t - b.t)
    .slice(0, 24);

  return (
    <>
      <PageTitle
        title="Schedule"
        subtitle={`All times use this device's clock and timezone (${snap.timeZone}).`}
        action={
          dirty && (
            <div className="flex gap-2">
              <Button onClick={() => setDraft(null)}>Discard</Button>
              <Button variant="primary" onClick={() => run(async () => { await backend.saveSettings({ ...s, updatedAt: nowIso() }); setDraft(null); }, "Schedule saved")}>
                Save changes
              </Button>
            </div>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Work hours">
          <Toggle label="Use work hours" description="Interval reminders without their own window run only inside these hours." checked={s.workEnabled} onChange={(v) => update({ workEnabled: v })} />
          <Field label="Active profile">
            <Select value={s.activeProfileId} onChange={(e) => update({ activeProfileId: e.target.value })}>
              {s.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          {profile && (
            <div className="mt-3 space-y-3">
              <Field label="Profile name">
                <Input value={profile.name} maxLength={40} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
              </Field>
              <DayPicker days={profile.days} onChange={(days) => setProfile({ ...profile, days })} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start">
                  <Input type="time" value={profile.start} onChange={(e) => setProfile({ ...profile, start: e.target.value })} />
                </Field>
                <Field label="End" hint="Earlier than start = night shift">
                  <Input type="time" value={profile.end} onChange={(e) => setProfile({ ...profile, end: e.target.value })} />
                </Field>
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium text-fg-muted">Breaks (no interval reminders)</span>
                {profile.breaks.map((b, i) => (
                  <div key={i} className="mb-2 flex items-end gap-2">
                    <Input aria-label="Break name" value={b.name} onChange={(e) => setProfile({ ...profile, breaks: profile.breaks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                    <Input aria-label="Break start" type="time" className="w-28" value={b.start} onChange={(e) => setProfile({ ...profile, breaks: profile.breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} />
                    <Input aria-label="Break end" type="time" className="w-28" value={b.end} onChange={(e) => setProfile({ ...profile, breaks: profile.breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} />
                    <Button size="sm" variant="ghost" aria-label="Remove break" onClick={() => setProfile({ ...profile, breaks: profile.breaks.filter((_, j) => j !== i) })}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
                <Button size="sm" onClick={() => setProfile({ ...profile, breaks: [...profile.breaks, { name: "Break", start: "13:00", end: "14:00" }] })}>
                  <Plus size={14} /> Add break
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    const id = uuid();
                    update({ profiles: [...s.profiles, { id, name: "New profile", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", breaks: [] }], activeProfileId: id });
                  }}
                >
                  <Plus size={14} /> New profile
                </Button>
                {s.profiles.length > 1 && (
                  <Button size="sm" variant="danger" onClick={() => update({ profiles: s.profiles.filter((p) => p.id !== profile.id), activeProfileId: s.profiles.find((p) => p.id !== profile.id)!.id })}>
                    Delete profile
                  </Button>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card title="Quiet hours" action={<span className="text-xs text-fg-subtle">No reminders at all</span>}>
          {s.quietHours.map((q) => (
            <div key={q.id} className="mb-3 rounded-xl border border-line p-3">
              <div className="flex items-end gap-2">
                <Field label="From">
                  <Input type="time" value={q.start} onChange={(e) => setQuiet({ ...q, start: e.target.value })} />
                </Field>
                <Field label="Until">
                  <Input type="time" value={q.end} onChange={(e) => setQuiet({ ...q, end: e.target.value })} />
                </Field>
                <Button size="sm" variant="ghost" aria-label="Remove quiet hours" onClick={() => update({ quietHours: s.quietHours.filter((x) => x.id !== q.id) })}>
                  <Trash2 size={14} />
                </Button>
              </div>
              <div className="mt-2">
                <DayPicker days={q.days} onChange={(days) => setQuiet({ ...q, days })} />
              </div>
              <Toggle label="Enabled" checked={q.enabled} onChange={(enabled) => setQuiet({ ...q, enabled })} />
            </div>
          ))}
          <Button size="sm" onClick={() => update({ quietHours: [...s.quietHours, { id: uuid(), enabled: true, start: "22:00", end: "07:00", days: [1, 2, 3, 4, 5, 6, 7] }] })}>
            <Plus size={14} /> Add quiet hours
          </Button>
        </Card>

        <Card title="Next 24 hours" className="lg:col-span-2" action={dirty ? <span className="text-xs text-accent">Preview includes unsaved changes</span> : undefined}>
          {upcoming.length === 0 ? (
            <p className="text-sm text-fg-muted">Nothing scheduled in the next 24 hours.</p>
          ) : (
            <ul className="grid gap-1 sm:grid-cols-2">
              {upcoming.map(({ r, t }) => {
                const Icon = CATEGORY_ICON[r.category];
                const day = localDate(t, snap.timeZone) === localDate(now, snap.timeZone) ? "Today" : "Tomorrow";
                return (
                  <li key={`${r.id}${t}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                    <span className="w-24 text-xs tabular-nums text-fg-muted">
                      {day} {formatTime(t, snap.timeZone, s.timeFormat)}
                    </span>
                    <Icon size={14} className="text-accent" aria-hidden />
                    <span className="truncate">{r.name}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-fg-subtle">Pause, focus mode and snoozes can move or skip these. Reminders due within a minute of each other are grouped.</p>
        </Card>
      </div>
    </>
  );
}
