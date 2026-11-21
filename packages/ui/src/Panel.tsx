import { Brain, CheckCircle2, LayoutDashboard, Pause, Play, Settings2, SkipForward, Timer, Volume2, VolumeX, X } from "lucide-react";
import { BRAND, formatCountdown, formatTime, formatWater, waterProgress, type Category } from "@deskwell/domain";
import { CATEGORY_ICON, Button, Progress, cx } from "./components/ui";
import { useToday } from "./hooks";
import { useAction, useApp } from "./store";

/** Compact tray / menu-bar / toolbar panel. */
export function Panel({ onClose }: { onClose?: () => void }) {
  const { snap, now, backend, toastMsg } = useApp();
  const run = useAction();
  const { summary } = useToday();
  if (!snap) return <div className="p-4 text-sm text-fg-muted">Loading…</div>;

  const s = snap.settings;
  const paused = snap.state.pausedUntil !== null;
  const focus = snap.state.focus;
  const focusLeft = focus ? Date.parse(focus.endsAt) - now : 0;
  const next = snap.next;
  const active = snap.active?.items[0];
  const voiceOn = snap.reminders.some((r) => r.enabled && r.voice.mode !== "none" && (r.delivery === "popup_voice" || r.delivery === "voice"));
  const water = summary?.waterMl ?? 0;
  const moves = (summary?.doneByCategory.walk ?? 0) + (summary?.doneByCategory.stand ?? 0) + (summary?.doneByCategory.stretch ?? 0);
  const eyes = summary?.doneByCategory.eyes ?? 0;
  const snooze = active?.snoozeOptions[0] ?? 5;
  const NextIcon = next ? CATEGORY_ICON[(next.items[0]?.category as Category) ?? "custom"] ?? CATEGORY_ICON.custom : null;

  return (
    <div className="flex h-full flex-col gap-3 bg-bg p-3 text-fg">
      <header className="flex items-center gap-2">
        <img src="icon.png" alt="" className="h-7 w-7 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight">{BRAND.name}</div>
          <div className={cx("text-xs", paused ? "text-danger" : "text-ok")}>{paused ? "Paused" : focus ? (focus.kind === "focus" ? "Focus mode" : "Meeting mode") : "Running"}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums leading-tight">{formatTime(now, snap.timeZone, s.timeFormat)}</div>
          <div className="text-[10px] text-fg-subtle">{snap.timeZone}</div>
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" aria-label="Close panel" onClick={onClose}>
            <X size={16} />
          </Button>
        )}
      </header>

      {active ? (
        <div className="rounded-xl border border-accent/40 bg-accent/10 p-3">
          <div className="text-xs font-medium text-accent">Due now</div>
          <div className="text-sm font-semibold">{active.name}</div>
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" variant="primary" onClick={() => run(() => backend.act(active.occurrenceId, active.reminderId, "done"), "Nice! Marked done.")}>
              <CheckCircle2 size={14} /> Done
            </Button>
            <Button size="sm" onClick={() => run(() => backend.act(active.occurrenceId, active.reminderId, "snoozed", snooze), `Snoozed ${snooze} min`)}>
              <Timer size={14} /> {snooze} min
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run(() => backend.act(active.occurrenceId, active.reminderId, "skipped"))}>
              <SkipForward size={14} /> Skip
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="text-xs text-fg-muted">Next reminder</div>
          {next && !paused ? (
            <div className="mt-1 flex items-center gap-2">
              {NextIcon && <NextIcon size={18} className="text-accent" aria-hidden />}
              <div className="min-w-0 flex-1 truncate text-sm font-semibold">{next.items.map((i) => i.name).join(" + ")}</div>
              <div className="text-sm tabular-nums text-fg-muted">in {formatCountdown(Date.parse(next.at) - now)}</div>
            </div>
          ) : (
            <div className="mt-1 text-sm text-fg-muted">{paused ? "Reminders are paused." : "Nothing scheduled right now."}</div>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-line bg-surface p-2">
          <div className="text-[11px] text-fg-muted">Water</div>
          <div className="text-sm font-semibold tabular-nums">{formatWater(water, s.water.unit, s.water.glassMl)}</div>
          <Progress value={waterProgress(water, s.water.goalMl)} label="Water goal progress" />
        </div>
        <div className="rounded-xl border border-line bg-surface p-2">
          <div className="text-[11px] text-fg-muted">Moves</div>
          <div className="text-lg font-semibold tabular-nums">{moves}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-2">
          <div className="text-[11px] text-fg-muted">Eye rests</div>
          <div className="text-lg font-semibold tabular-nums">{eyes}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {s.water.containers.slice(0, 3).map((ml) => (
          <Button key={ml} size="sm" onClick={() => run(() => backend.addWater(ml), `+${ml} ml`)}>
            +{ml} ml
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {paused ? (
          <Button variant="primary" onClick={() => run(() => backend.setPause(null), "Reminders resumed")}>
            <Play size={15} /> Resume
          </Button>
        ) : (
          <Button onClick={() => run(() => backend.setPause("indefinite"), "Reminders paused")}>
            <Pause size={15} /> Pause all
          </Button>
        )}
        {focus ? (
          <Button variant="primary" onClick={() => run(() => backend.stopFocus(), "Focus ended")}>
            <Brain size={15} /> End {formatCountdown(focusLeft)}
          </Button>
        ) : (
          <Button onClick={() => run(() => backend.startFocus("focus", 25, s.focusDefaults ? { ...s.focusDefaults, holdAll: false } : { pauseVoice: true, pausePopup: false, holdAll: false }), "Focus for 25 min")}>
            <Brain size={15} /> Focus 25
          </Button>
        )}
        <Button onClick={() => run(() => backend.testVoice())}>
          {voiceOn ? <Volume2 size={15} /> : <VolumeX size={15} />} Test voice
        </Button>
        <Button onClick={() => run(() => backend.openDashboard())}>
          <LayoutDashboard size={15} /> Dashboard
        </Button>
      </div>
      <div className="mt-auto flex items-center justify-between text-[11px] text-fg-subtle">
        <span>Voice {voiceOn ? "on" : "off"}</span>
        <button className="inline-flex items-center gap-1 hover:text-fg" onClick={() => run(() => backend.openDashboard("settings"))}>
          <Settings2 size={12} /> Settings
        </button>
      </div>
      {toastMsg && <div role="status" className="rounded-lg bg-fg px-3 py-1.5 text-center text-xs text-bg">{toastMsg}</div>}
    </div>
  );
}
