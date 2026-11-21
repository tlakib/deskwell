import { useState } from "react";
import { Undo2 } from "lucide-react";
import { formatTime, formatWater, localDate, nowIso, summarizeDay, waterProgress, weekDates } from "@deskwell/domain";
import { PageTitle } from "../Dashboard";
import { Button, Card, Field, Input, Select, Progress } from "../components/ui";
import { useHistory } from "../hooks";
import { useAction, useApp } from "../store";
import { ReminderList } from "./Reminders";

export default function Water() {
  const { snap, backend } = useApp();
  const run = useAction();
  const { history, today, zone } = useHistory(7);
  const [custom, setCustom] = useState(300);
  if (!snap) return null;
  const w = snap.settings.water;
  const todays = history ? summarizeDay(today, zone, history.events, history.water, history.focus) : null;
  const total = todays?.waterMl ?? 0;
  const week = weekDates(today, snap.settings.weekStart);
  const entries = (history?.water ?? []).filter((e) => localDate(Date.parse(e.at), zone) === today).slice(-12).reverse();
  const saveWater = (p: Partial<typeof w>) => run(() => backend.saveSettings({ ...snap.settings, water: { ...w, ...p }, updatedAt: nowIso() }));

  return (
    <>
      <PageTitle title="Water Tracker" subtitle="Log what you drink. Goals are your own; DeskWell does not give medical advice." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Today">
          <div className="text-3xl font-semibold tabular-nums">{formatWater(total, w.unit, w.glassMl)}</div>
          <div className="mb-2 text-xs text-fg-muted">of {formatWater(w.goalMl, w.unit, w.glassMl)}</div>
          <Progress value={waterProgress(total, w.goalMl)} label="Water goal" />
          <div className="mt-4 flex flex-wrap gap-2">
            {w.containers.map((ml) => (
              <Button key={ml} onClick={() => run(() => backend.addWater(ml), `+${ml} ml`)}>
                +{ml} ml
              </Button>
            ))}
            <div className="flex items-center gap-1">
              <Input aria-label="Custom amount in ml" type="number" min={1} max={5000} className="w-24" value={custom} onChange={(e) => setCustom(Number(e.target.value))} />
              <Button onClick={() => custom >= 1 && custom <= 5000 && run(() => backend.addWater(Math.round(custom)), `+${Math.round(custom)} ml`)}>Add</Button>
            </div>
            <Button variant="ghost" onClick={() => run(async () => { if (!(await backend.undoWater())) throw new Error("Nothing to undo today"); }, "Removed last entry")}>
              <Undo2 size={15} /> Undo last
            </Button>
          </div>
          {entries.length > 0 && (
            <ul className="mt-4 space-y-1 text-xs text-fg-muted">
              {entries.map((e) => (
                <li key={e.id}>
                  {formatTime(Date.parse(e.at), zone, snap.settings.timeFormat)} · {e.ml} ml
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="This week">
          <div className="flex h-40 items-end gap-2">
            {week.map((d) => {
              const ml = history ? summarizeDay(d, zone, history.events, history.water, history.focus).waterMl : 0;
              const pct = Math.min(1, w.goalMl ? ml / w.goalMl : 0);
              return (
                <div key={d} className="flex flex-1 flex-col items-center gap-1" title={`${d}: ${ml} ml`}>
                  <div className="relative w-full flex-1 overflow-hidden rounded-md bg-surface-2">
                    <div className="absolute bottom-0 w-full rounded-md bg-accent" style={{ height: `${pct * 100}%` }} />
                  </div>
                  <span className={d === today ? "text-[11px] font-semibold text-accent" : "text-[11px] text-fg-muted"}>
                    {new Date(d + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Goal & units">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Daily goal (ml)">
              <Input type="number" min={0} max={20000} defaultValue={w.goalMl} onBlur={(e) => saveWater({ goalMl: Math.max(0, Math.min(20000, Math.round(Number(e.target.value) || 0))) })} />
            </Field>
            <Field label="Show as">
              <Select value={w.unit} onChange={(e) => saveWater({ unit: e.target.value as typeof w.unit })}>
                <option value="ml">Millilitres</option>
                <option value="oz">Fluid ounces</option>
                <option value="glass">Glasses</option>
              </Select>
            </Field>
            <Field label="Glass size (ml)">
              <Input type="number" min={50} max={2000} defaultValue={w.glassMl} onBlur={(e) => saveWater({ glassMl: Math.max(50, Math.min(2000, Math.round(Number(e.target.value) || 250))) })} />
            </Field>
            <Field label="Quick buttons (ml, comma separated)">
              <Input
                defaultValue={w.containers.join(", ")}
                onBlur={(e) => {
                  const v = e.target.value.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 10 && n <= 5000);
                  if (v.length) saveWater({ containers: v.slice(0, 6) });
                }}
              />
            </Field>
          </div>
        </Card>
        <Card title="Water reminders">
          <ReminderList filter={(r) => r.category === "water"} />
        </Card>
      </div>
    </>
  );
}
