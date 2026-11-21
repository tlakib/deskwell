import { useState } from "react";
import { Download } from "lucide-react";
import { CATEGORY_META, addDays, formatTime, formatWater, summarizeDay, type Category } from "@deskwell/domain";
import { PageTitle } from "../Dashboard";
import { Button, Card, Select, Stat } from "../components/ui";
import { useHistory } from "../hooks";
import { useAction, useApp } from "../store";

export function downloadText(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function History() {
  const { snap, backend } = useApp();
  const run = useAction();
  const [days, setDays] = useState(7);
  const { history, today, zone } = useHistory(days);
  if (!snap) return null;
  const dates = Array.from({ length: days }, (_, i) => addDays(today, -(days - 1 - i)));
  const sums = history ? dates.map((d) => summarizeDay(d, zone, history.events, history.water, history.focus)) : [];
  const tot = sums.reduce(
    (a, s) => ({ delivered: a.delivered + s.delivered, done: a.done + s.done, snoozed: a.snoozed + s.snoozed, skipped: a.skipped + s.skipped, water: a.water + s.waterMl, focus: a.focus + s.focusMinutes }),
    { delivered: 0, done: 0, snoozed: 0, skipped: 0, water: 0, focus: 0 },
  );
  const max = Math.max(1, ...sums.map((s) => s.delivered));
  const names = new Map(snap.reminders.map((r) => [r.id, r.name]));
  const events = (history?.events ?? []).filter((e) => e.action !== "delivered").slice().reverse().slice(0, 50);

  const exportCsv = () => {
    const rows = [["at", "time_zone", "reminder", "category", "action", "scheduled_at"]];
    for (const e of history?.events ?? []) rows.push([e.at, e.timeZone, names.get(e.reminderId) ?? e.reminderId, e.category, e.action, e.scheduledAt]);
    for (const w of history?.water ?? []) rows.push([w.at, w.timeZone, "Water log", "water", `${w.ml} ml`, ""]);
    downloadText(`deskwell-history-${today}.csv`, rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n"), "text/csv");
  };

  return (
    <>
      <PageTitle
        title="History & Analytics"
        subtitle="Habit counts only. Completion is done ÷ delivered; it is not a health score."
        action={
          <div className="flex gap-2">
            <Select aria-label="Range" value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-32">
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </Select>
            <Button onClick={exportCsv}>
              <Download size={15} /> CSV
            </Button>
          </div>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Delivered" value={tot.delivered} />
        <Stat label="Done" value={tot.done} sub={tot.delivered ? `${Math.round((tot.done / tot.delivered) * 100)}% completion` : undefined} />
        <Stat label="Snoozed" value={tot.snoozed} />
        <Stat label="Water" value={formatWater(tot.water, snap.settings.water.unit, snap.settings.water.glassMl)} />
        <Stat label="Focus" value={`${tot.focus} min`} />
      </div>
      <Card title="Per day" className="mt-4">
        <div className="flex h-44 items-end gap-1.5">
          {sums.map((s) => (
            <div key={s.date} className="flex flex-1 flex-col items-center gap-1" title={`${s.date}: ${s.done} done of ${s.delivered}`}>
              <div className="relative w-full flex-1">
                <div className="absolute bottom-0 w-full rounded-t bg-surface-3" style={{ height: `${(s.delivered / max) * 100}%` }} />
                <div className="absolute bottom-0 w-full rounded-t bg-accent" style={{ height: `${(s.done / max) * 100}%` }} />
              </div>
              <span className="text-[10px] text-fg-muted">{s.date.slice(8)}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-4 text-xs text-fg-muted">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent" />Done</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-surface-3" />Delivered</span>
        </div>
      </Card>
      <Card title="Recent actions" className="mt-4" action={
        <Button size="sm" variant="danger" onClick={() => window.confirm("Delete all reminder history, water logs and focus sessions? This cannot be undone.") && run(() => backend.clearHistory(), "History cleared")}>
          Clear history
        </Button>
      }>
        <ul className="divide-y divide-line text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3 py-1.5">
              <span className="w-28 text-xs tabular-nums text-fg-muted">
                {e.at.slice(5, 10)} {formatTime(Date.parse(e.at), zone, snap.settings.timeFormat)}
              </span>
              <span className="flex-1 truncate">{names.get(e.reminderId) ?? CATEGORY_META[e.category as Category]?.label}</span>
              <span className="text-xs capitalize text-fg-muted">{e.action.replace("_", " ")}</span>
            </li>
          ))}
          {!events.length && <li className="py-2 text-fg-muted">No actions yet.</li>}
        </ul>
      </Card>
    </>
  );
}
