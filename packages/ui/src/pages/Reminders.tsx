import { useEffect, useState } from "react";
import { Copy, Pencil, Plus, Trash2, Volume2 } from "lucide-react";
import {
  CATEGORIES,
  CATEGORY_META,
  LANGUAGE_TAGS,
  LANGUAGES,
  ReminderSchema,
  VOICE_PACKS,
  newReminder,
  nextOccurrence,
  nowIso,
  uuid,
  formatTime,
  type Category,
  type DeliveryMode,
  type Language,
  type Reminder,
  type VoicePackId,
} from "@deskwell/domain";
import { PageTitle } from "../Dashboard";
import { CATEGORY_ICON, Button, Card, DayPicker, Empty, Field, Input, Select, Toggle } from "../components/ui";
import { useAction, useApp } from "../store";

export const DELIVERY_LABEL: Record<DeliveryMode, string> = {
  popup_voice: "Popup + voice",
  popup: "Popup only",
  voice: "Voice only",
  silent: "Silent (notification only)",
  disabled: "Disabled",
};

export function scheduleSummary(r: Reminder): string {
  const s = r.schedule;
  const days = s.days.length === 7 ? "every day" : s.days.length === 5 && !s.days.includes(6) && !s.days.includes(7) ? "weekdays" : `${s.days.length} days/week`;
  switch (s.type) {
    case "interval":
      return `Every ${s.intervalMinutes} min · ${s.window ? `${s.window.start}–${s.window.end}` : s.useWorkHours ? "work hours" : "all day"} · ${days}`;
    case "daily":
      return `At ${s.times.join(", ") || "—"} · ${days}`;
    case "once":
      return `Once at ${s.onceAt?.replace("T", " ") ?? "—"}`;
    case "dates":
      return `${s.dates.length} date(s) at ${s.times.join(", ") || "—"}`;
  }
}

export function ReminderList({ filter }: { filter?: (r: Reminder) => boolean }) {
  const { snap, backend, now } = useApp();
  const run = useAction();
  const [editing, setEditing] = useState<Reminder | null>(null);
  if (!snap) return null;
  const ctx = { zone: snap.timeZone, settings: snap.settings };
  const list = snap.reminders.filter(filter ?? (() => true));

  return (
    <>
      {list.length === 0 && <Empty>No reminders here yet.</Empty>}
      <ul className="space-y-2">
        {list.map((r) => {
          const Icon = CATEGORY_ICON[r.category];
          const next = r.enabled && r.delivery !== "disabled" ? nextOccurrence(r, now, ctx) : null;
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/12 text-accent">
                <Icon size={18} aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{r.name}</div>
                <div className="text-xs text-fg-muted">
                  {scheduleSummary(r)} · {DELIVERY_LABEL[r.delivery]}
                  {next !== null && ` · next ${formatTime(next, snap.timeZone, snap.settings.timeFormat)}`}
                </div>
              </div>
              <Toggle
                label={`Enable ${r.name}`}
                checked={r.enabled}
                onChange={(v) => run(() => backend.saveReminder({ ...r, enabled: v, updatedAt: nowIso(), revision: r.revision + 1 }))}
              />
              <Button size="sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}>
                <Pencil size={14} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Duplicate ${r.name}`}
                onClick={() => run(() => backend.saveReminder({ ...r, id: uuid(), name: `${r.name} (copy)`.slice(0, 80), createdAt: nowIso(), updatedAt: nowIso(), revision: 0 }), "Duplicated")}
              >
                <Copy size={14} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete ${r.name}`}
                onClick={() => {
                  if (window.confirm(`Delete "${r.name}"? Its history stays.`)) void run(() => backend.deleteReminder(r.id), "Deleted");
                }}
              >
                <Trash2 size={14} />
              </Button>
            </li>
          );
        })}
      </ul>
      {editing && <ReminderEditor initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

export default function Reminders() {
  const [creating, setCreating] = useState<Reminder | null>(null);
  return (
    <>
      <PageTitle
        title="Reminders"
        subtitle="Every reminder is editable. Defaults are friendly starting points, not medical advice."
        action={
          <Button variant="primary" onClick={() => setCreating(newReminder(nowIso(), uuid(), { name: "My reminder", category: "custom" }))}>
            <Plus size={15} /> New reminder
          </Button>
        }
      />
      <ReminderList />
      {creating && <ReminderEditor initial={creating} isNew onClose={() => setCreating(null)} />}
    </>
  );
}

export function ReminderEditor({ initial, onClose, isNew }: { initial: Reminder; onClose: () => void; isNew?: boolean }) {
  const { snap, backend, player } = useApp();
  const run = useAction();
  const [r, setR] = useState<Reminder>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [audio, setAudio] = useState<{ id: string; name: string }[] | null>(null);
  const s = r.schedule;
  const set = (p: Partial<Reminder>) => setR((x) => ({ ...x, ...p }));
  const setS = (p: Partial<Reminder["schedule"]>) => setR((x) => ({ ...x, schedule: { ...x.schedule, ...p } }));
  const setV = (p: Partial<Reminder["voice"]>) => setR((x) => ({ ...x, voice: { ...x.voice, ...p } }));

  useEffect(() => {
    void backend.listAudio().then((a) => setAudio(a.map(({ id, name }) => ({ id, name })))).catch(() => setAudio([]));
  }, [backend]);

  if (!snap) return null;

  const save = () => {
    const candidate = { ...r, updatedAt: nowIso(), revision: isNew ? 0 : r.revision + 1, messages: r.messages.map((m) => m.trim()).filter(Boolean) };
    const parsed = ReminderSchema.safeParse(candidate);
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      return setErr(`${i?.path.join(".")}: ${i?.message}`);
    }
    if ((s.type === "daily" || s.type === "dates") && s.times.length === 0) return setErr("Add at least one time.");
    if (s.type === "once" && !s.onceAt) return setErr("Pick a date and time.");
    if (s.type === "dates" && s.dates.length === 0) return setErr("Add at least one date.");
    if (s.type !== "once" && s.days.length === 0 && s.type !== "dates") return setErr("Pick at least one day.");
    void run(async () => {
      await backend.saveReminder(parsed.data);
      onClose();
    }, isNew ? "Reminder created" : "Saved");
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-label="Edit reminder" onClick={onClose}>
      <div className="h-full w-full max-w-xl overflow-y-auto bg-bg p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold">{isNew ? "New reminder" : `Edit "${initial.name}"`}</h2>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={r.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Category">
              <Select value={r.category} onChange={(e) => set({ category: e.target.value as Category })}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_META[c].label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Card title="When">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Schedule type">
                <Select value={s.type} onChange={(e) => setS({ type: e.target.value as Reminder["schedule"]["type"] })}>
                  <option value="interval">Repeat every N minutes</option>
                  <option value="daily">Fixed times each day</option>
                  <option value="once">One time</option>
                  <option value="dates">Specific dates</option>
                </Select>
              </Field>
              {s.type === "interval" && (
                <Field label="Every (minutes)">
                  <Input type="number" min={1} max={1440} value={s.intervalMinutes} onChange={(e) => setS({ intervalMinutes: Math.max(1, Number(e.target.value) || 1) })} />
                </Field>
              )}
              {s.type === "once" && (
                <Field label="Date & time (local)">
                  <Input type="datetime-local" value={s.onceAt ?? ""} onChange={(e) => setS({ onceAt: e.target.value || null })} />
                </Field>
              )}
            </div>
            {(s.type === "daily" || s.type === "dates") && <TimesEditor times={s.times} onChange={(times) => setS({ times })} />}
            {s.type === "dates" && <DatesEditor dates={s.dates} onChange={(dates) => setS({ dates })} />}
            {(s.type === "interval" || s.type === "daily") && (
              <div className="mt-3">
                <span className="mb-1 block text-xs font-medium text-fg-muted">Days</span>
                <DayPicker days={s.days} onChange={(days) => setS({ days })} />
              </div>
            )}
            {s.type === "interval" && (
              <div className="mt-3 space-y-1">
                <Toggle
                  label="Own time window"
                  description={s.window ? undefined : s.useWorkHours ? "Uses your active work profile (breaks excluded)." : "Runs all day on active days."}
                  checked={!!s.window}
                  onChange={(v) => setS({ window: v ? { start: "09:00", end: "17:00" } : null })}
                />
                {s.window ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="From">
                      <Input type="time" value={s.window.start} onChange={(e) => setS({ window: { ...s.window!, start: e.target.value } })} />
                    </Field>
                    <Field label="Until" hint="Earlier than start = crosses midnight">
                      <Input type="time" value={s.window.end} onChange={(e) => setS({ window: { ...s.window!, end: e.target.value } })} />
                    </Field>
                  </div>
                ) : (
                  <Toggle label="Only during work hours" checked={s.useWorkHours} onChange={(v) => setS({ useWorkHours: v })} />
                )}
              </div>
            )}
            {s.type !== "once" && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="Start date (optional)">
                  <Input type="date" value={s.startDate ?? ""} onChange={(e) => setS({ startDate: e.target.value || null })} />
                </Field>
                <Field label="End date (optional)">
                  <Input type="date" value={s.endDate ?? ""} onChange={(e) => setS({ endDate: e.target.value || null })} />
                </Field>
              </div>
            )}
          </Card>

          <Card title="How">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Delivery">
                <Select value={r.delivery} onChange={(e) => set({ delivery: e.target.value as DeliveryMode })}>
                  {Object.entries(DELIVERY_LABEL).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Language">
                <Select value={r.language} onChange={(e) => set({ language: e.target.value as Language })}>
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_TAGS[l].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Voice">
                <Select
                  value={r.voice.mode === "pack" ? `pack:${r.voice.packId}` : r.voice.mode}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v.startsWith("pack:")) setV({ mode: "pack", packId: v.slice(5) as VoicePackId });
                    else setV({ mode: v as "tts" | "audio" | "none" });
                  }}
                >
                  {Object.values(VOICE_PACKS).map((p) => (
                    <option key={p.id} value={`pack:${p.id}`}>
                      {p.label} – bundled voice
                    </option>
                  ))}
                  <option value="tts">System voice (reads the message)</option>
                  <option value="audio">My uploaded audio</option>
                  <option value="none">No voice</option>
                </Select>
              </Field>
              <Field label={`Volume ${Math.round(r.voice.volume * 100)}%`}>
                <input className="w-full accent-[var(--color-accent)]" type="range" min={0} max={1} step={0.05} value={r.voice.volume} onChange={(e) => setV({ volume: Number(e.target.value) })} />
              </Field>
            </div>
            {r.voice.mode === "pack" && (
              <p className="mt-2 text-xs text-fg-muted">
                Bundled clips speak the standard {CATEGORY_META[r.category].label.toLowerCase()} line (Bangla or English). Custom message text below is shown in the popup.{" "}
                <button className="text-accent hover:underline" onClick={() => player.previewPack(r.voice.packId, r.category, r.language, r.voice.volume)}>
                  <Volume2 size={12} className="inline" /> Preview
                </button>
              </p>
            )}
            {r.voice.mode === "tts" && (
              <Field label="Voice profile">
                <Select value={r.voice.profileId ?? ""} onChange={(e) => setV({ profileId: e.target.value || null })}>
                  <option value="">Default profile</option>
                  {snap.settings.voiceProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {r.voice.mode === "audio" && (
              <div className="mt-2">
                {audio && audio.length === 0 && <p className="text-xs text-fg-muted">No audio uploaded yet. Add files in Voice Studio.</p>}
                <div className="space-y-1">
                  {audio?.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={r.voice.audioIds.includes(a.id)}
                        onChange={(e) => setV({ audioIds: e.target.checked ? [...r.voice.audioIds, a.id] : r.voice.audioIds.filter((x) => x !== a.id) })}
                      />
                      {a.name}
                    </label>
                  ))}
                </div>
                {r.voice.audioIds.length > 1 && <Toggle label="Pick one at random each time" checked={r.voice.randomAudio} onChange={(v) => setV({ randomAudio: v })} />}
              </div>
            )}
          </Card>

          <Card title="Messages" action={<span className="text-xs text-fg-subtle">Empty = use message library</span>}>
            <MessagesEditor messages={r.messages} onChange={(messages) => set({ messages })} />
            {r.messages.length > 1 && <Toggle label="Random message each time" checked={r.randomMessage} onChange={(v) => set({ randomMessage: v })} />}
          </Card>

          <Card title="Behaviour">
            <Field label="Snooze options (minutes, comma separated)">
              <Input
                defaultValue={r.snoozeOptions.join(", ")}
                onBlur={(e) => {
                  const v = e.target.value
                    .split(/[,\s]+/)
                    .map(Number)
                    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 240);
                  set({ snoozeOptions: v.length ? [...new Set(v)].slice(0, 5) : [5] });
                }}
              />
            </Field>
            <Toggle label="Wait for snooze before next reminder" description="Off = the regular schedule continues while snoozed." checked={r.snoozePolicy === "wait"} onChange={(v) => set({ snoozePolicy: v ? "wait" : "keep" })} />
            <Toggle label="Important" description="Important reminders are held until focus ends instead of being skipped." checked={r.priority === "important"} onChange={(v) => set({ priority: v ? "important" : "normal" })} />
            <Toggle label="Respect quiet hours" checked={r.respectQuietHours} onChange={(v) => set({ respectQuietHours: v })} />
            <Toggle label="Pause during focus mode" checked={r.pauseInFocus} onChange={(v) => set({ pauseInFocus: v })} />
            <Toggle label="Group with reminders due at the same time" checked={r.group} onChange={(v) => set({ group: v })} />
          </Card>

          {err && <p className="text-sm text-danger" role="alert">{err}</p>}
          <div className="flex justify-end gap-2 pb-6">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimesEditor({ times, onChange }: { times: string[]; onChange: (t: string[]) => void }) {
  const [v, setV] = useState("12:00");
  return (
    <div className="mt-3">
      <span className="mb-1 block text-xs font-medium text-fg-muted">Times</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {times.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs">
            {t}
            <button aria-label={`Remove ${t}`} className="text-fg-muted hover:text-danger" onClick={() => onChange(times.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        <Input type="time" className="w-28" value={v} onChange={(e) => setV(e.target.value)} />
        <Button size="sm" onClick={() => v && !times.includes(v) && onChange([...times, v].sort())}>
          Add time
        </Button>
      </div>
    </div>
  );
}

function DatesEditor({ dates, onChange }: { dates: string[]; onChange: (t: string[]) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="mt-3">
      <span className="mb-1 block text-xs font-medium text-fg-muted">Dates</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {dates.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs">
            {t}
            <button aria-label={`Remove ${t}`} className="text-fg-muted hover:text-danger" onClick={() => onChange(dates.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        <Input type="date" className="w-40" value={v} onChange={(e) => setV(e.target.value)} />
        <Button size="sm" onClick={() => v && !dates.includes(v) && onChange([...dates, v].sort())}>
          Add date
        </Button>
      </div>
    </div>
  );
}

function MessagesEditor({ messages, onChange }: { messages: string[]; onChange: (m: string[]) => void }) {
  return (
    <div className="space-y-2">
      {messages.map((m, i) => (
        <div key={i} className="flex gap-2">
          <Input value={m} maxLength={500} onChange={(e) => onChange(messages.map((x, j) => (j === i ? e.target.value : x)))} />
          <Button size="sm" variant="ghost" aria-label="Remove message" onClick={() => onChange(messages.filter((_, j) => j !== i))}>
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
      <Button size="sm" onClick={() => onChange([...messages, ""])}>
        <Plus size={14} /> Add message
      </Button>
    </div>
  );
}
