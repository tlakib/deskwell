import { useEffect, useState } from "react";
import { BellOff, CheckCircle2, SkipForward, Square, Timer } from "lucide-react";
import { CATEGORY_META, type Category } from "@deskwell/domain";
import { CATEGORY_ICON, Button } from "./components/ui";
import { useAction, useApp } from "./store";

/** The DeskWell reminder popup: one card per due reminder (grouped reminders stack). */
export function Popup({ onEmpty }: { onEmpty?: () => void }) {
  const { snap, backend } = useApp();
  const run = useAction();
  const items = snap?.active?.items ?? [];
  const [left, setLeft] = useState<number | null>(null);
  const seconds = snap?.settings.popupSeconds ?? 60;

  useEffect(() => {
    if (!items.length) {
      onEmpty?.();
      return;
    }
    if (!seconds) return;
    setLeft(seconds);
    const t = window.setInterval(() => setLeft((l) => (l === null ? null : l - 1)), 1000);
    return () => window.clearInterval(t);
  }, [snap?.active?.createdAt, items.length, seconds, onEmpty]);

  useEffect(() => {
    // Auto-hide: the reminder stays in history as delivered (not done/skipped).
    if (left !== null && left <= 0) void backend.dismissPopup();
  }, [left, backend]);

  if (!items.length) return <div className="p-4 text-sm text-fg-muted">No reminder due.</div>;

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto bg-bg p-3 text-fg" role="alertdialog" aria-label="DeskWell reminder">
      {items.map((d) => {
        const Icon = CATEGORY_ICON[d.category as Category] ?? CATEGORY_ICON.custom;
        return (
          <article key={d.occurrenceId} className="rounded-2xl border border-line bg-surface p-3 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
                <Icon size={22} aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-fg-muted">{CATEGORY_META[d.category as Category]?.title ?? "Reminder"}</div>
                <h1 className="text-base font-semibold leading-tight">{d.name}</h1>
                <p className="mt-1 text-sm text-fg-muted">{d.message}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button size="sm" variant="primary" autoFocus onClick={() => run(() => backend.act(d.occurrenceId, d.reminderId, "done"))}>
                <CheckCircle2 size={14} /> Done
              </Button>
              {d.snoozeOptions.map((m) => (
                <Button key={m} size="sm" onClick={() => run(() => backend.act(d.occurrenceId, d.reminderId, "snoozed", m))}>
                  <Timer size={14} /> {m}m
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => run(() => backend.act(d.occurrenceId, d.reminderId, "skipped"))}>
                <SkipForward size={14} /> Skip
              </Button>
              <Button size="sm" variant="ghost" onClick={() => run(() => backend.act(d.occurrenceId, d.reminderId, "muted_today"))}>
                <BellOff size={14} /> Not today
              </Button>
            </div>
          </article>
        );
      })}
      <div className="flex items-center justify-between px-1 text-[11px] text-fg-subtle">
        <StopVoice />
        {left !== null && seconds > 0 && <span>Hides in {Math.max(0, left)} s</span>}
      </div>
    </div>
  );
}

function StopVoice() {
  const { backend, player } = useApp();
  return (
    <button
      className="inline-flex items-center gap-1 hover:text-fg"
      onClick={() => {
        player.stop();
        void backend.dismissPopup().catch(() => undefined);
      }}
    >
      <Square size={11} /> Stop voice & close
    </button>
  );
}
