import { useEffect, useState } from "react";
import { addDays, localDate, startOfLocalDay, summarizeDay, toIso, type DaySummary } from "@deskwell/domain";
import type { History } from "./backend";
import { useApp } from "./store";

/** History for the last `days` local days (inclusive of today), refreshed when data changes. */
export function useHistory(days: number) {
  const { backend, snap, now } = useApp();
  const zone = snap?.timeZone ?? "UTC";
  const today = localDate(now, zone);
  const [data, setData] = useState<History | null>(null);
  const stamp = JSON.stringify([snap?.next?.at, snap?.active?.createdAt, snap?.state, today]);
  const [tick, setTick] = useState(0);

  useEffect(() => backend.subscribe((e) => (e.type === "changed" || e.type === "deliver") && setTick((t) => t + 1)), [backend]);

  useEffect(() => {
    let live = true;
    const from = toIso(startOfLocalDay(addDays(today, -(days - 1)), zone));
    const to = toIso(startOfLocalDay(addDays(today, 1), zone));
    backend
      .history(from, to)
      .then((h) => live && setData(h))
      .catch(() => live && setData({ events: [], water: [], focus: [] }));
    return () => {
      live = false;
    };
  }, [backend, days, today, zone, stamp, tick]);

  return { history: data, today, zone };
}

export function useToday(): { summary: DaySummary | null; zone: string; today: string } {
  const { history, today, zone } = useHistory(1);
  return { summary: history ? summarizeDay(today, zone, history.events, history.water, history.focus) : null, zone, today };
}
