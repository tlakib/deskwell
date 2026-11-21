import { Brain, Pause, Play } from "lucide-react";
import { BRAND, CATEGORY_META, formatCountdown, formatTime, formatWater, waterProgress, type Category } from "@deskwell/domain";
import { PageTitle } from "../Dashboard";
import { CATEGORY_ICON, Button, Card, Progress, Stat } from "../components/ui";
import { useToday } from "../hooks";
import { useAction, useApp } from "../store";

export default function Overview() {
  const { snap, now, backend } = useApp();
  const run = useAction();
  const { summary } = useToday();
  if (!snap) return null;
  const s = snap.settings;
  const paused = snap.state.pausedUntil !== null;
  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: snap.timeZone }).format(now);
  const enabled = snap.reminders.filter((r) => r.enabled);

  return (
    <>
      <PageTitle
        title={`${formatTime(now, snap.timeZone, s.timeFormat, true)}`}
        subtitle={`${dateLabel} · ${snap.timeZone}`}
        action={
          <div className="flex gap-2">
            {paused ? (
              <Button variant="primary" onClick={() => run(() => backend.setPause(null), "Resumed")}>
                <Play size={15} /> Resume reminders
              </Button>
            ) : (
              <Button onClick={() => run(() => backend.setPause("indefinite"), "Paused")}>
                <Pause size={15} /> Pause all
              </Button>
            )}
            <Button onClick={() => (window.location.hash = "#/focus")}>
              <Brain size={15} /> Focus
            </Button>
          </div>
        }
      />
      {!s.onboarded && <Welcome />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Next reminder"
          value={snap.next && !paused ? formatCountdown(Date.parse(snap.next.at) - now) : "—"}
          sub={snap.next && !paused ? snap.next.items.map((i) => i.name).join(" + ") : paused ? "Paused" : "Nothing scheduled"}
        />
        <Stat label="Completed today" value={summary?.done ?? 0} sub={`${summary?.delivered ?? 0} delivered · ${summary?.snoozed ?? 0} snoozed`} />
        <Stat label="Water" value={formatWater(summary?.waterMl ?? 0, s.water.unit, s.water.glassMl)} sub={`Goal ${formatWater(s.water.goalMl, s.water.unit, s.water.glassMl)}`} />
        <Stat label="Focus today" value={`${summary?.focusMinutes ?? 0} min`} sub={snap.state.focus ? "In progress" : "—"} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Water">
          <Progress value={waterProgress(summary?.waterMl ?? 0, s.water.goalMl)} label="Water goal" />
          <div className="mt-3 flex flex-wrap gap-2">
            {s.water.containers.map((ml) => (
              <Button key={ml} size="sm" onClick={() => run(() => backend.addWater(ml), `+${ml} ml`)}>
                +{ml} ml
              </Button>
            ))}
          </div>
        </Card>
        <Card title="Active reminders" action={<a className="text-xs text-accent hover:underline" href="#/reminders">Manage</a>}>
          <ul className="divide-y divide-line">
            {enabled.slice(0, 6).map((r) => {
              const Icon = CATEGORY_ICON[r.category as Category];
              const sched = r.schedule.type === "interval" ? `every ${r.schedule.intervalMinutes} min` : r.schedule.type === "daily" ? r.schedule.times.join(", ") : r.schedule.type;
              return (
                <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
                  <Icon size={16} className="text-accent" aria-hidden />
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="text-xs text-fg-muted">{sched}</span>
                </li>
              );
            })}
            {!enabled.length && <li className="py-2 text-sm text-fg-muted">No reminders enabled.</li>}
          </ul>
        </Card>
        <Card title="Today by category">
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary?.doneByCategory ?? {}).map(([c, n]) => (
              <span key={c} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs">
                {CATEGORY_META[c as Category].label}: <b>{n}</b>
              </span>
            ))}
            {!Object.keys(summary?.doneByCategory ?? {}).length && <span className="text-sm text-fg-muted">Complete a reminder to see it here.</span>}
          </div>
        </Card>
        <Card title="About">
          <p className="text-xs text-fg-muted">{BRAND.disclaimer}</p>
          {snap.platform === "extension" && (
            <p className="mt-2 text-xs text-fg-muted">The Chrome extension reminds you only while Chrome is running. Install the desktop app for reminders when Chrome is closed.</p>
          )}
        </Card>
      </div>
    </>
  );
}

function Welcome() {
  const { snap, backend } = useApp();
  const run = useAction();
  if (!snap) return null;
  return (
    <Card className="mb-4 border-accent/40 bg-accent/5" title={`Welcome to ${BRAND.name}`}>
      <p className="text-sm text-fg-muted">
        DeskWell is already running with gentle starter reminders during your work hours (eye rest every 20 min, move every 30 min, stretch, water and lunch).
        Voice reminders use the bundled Akib (male) voice; switch to Rimjhim (female), a system voice or your own recordings in Voice Studio.
        Everything stays on this device. Personalise the defaults to your own needs.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => run(() => backend.saveSettings({ ...snap.settings, onboarded: true }))}>
          Got it
        </Button>
        <Button onClick={() => (window.location.hash = "#/schedule")}>Set my work hours</Button>
        <Button onClick={() => run(() => backend.testVoice())}>Play test voice</Button>
      </div>
    </Card>
  );
}
