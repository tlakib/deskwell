import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { defaultReminders, defaultSettings, defaultTemplates, nowIso } from "@deskwell/domain";
import type { Backend, Snapshot } from "./backend";
import { VoicePlayer } from "./voice";

interface Ctx {
  backend: Backend;
  snap: Snapshot | null;
  error: string | null;
  refresh: () => Promise<void>;
  player: VoicePlayer;
  now: number;
  toast: (msg: string) => void;
  toastMsg: string | null;
  tzNotice: string | null;
  clearTzNotice: () => void;
}

const C = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("useApp outside provider");
  return c;
}

/** Run an async action and surface any error as a toast. */
export function useAction() {
  const { toast, refresh } = useApp();
  return useCallback(
    async (fn: () => Promise<unknown>, ok?: string) => {
      try {
        await fn();
        if (ok) toast(ok);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e));
      } finally {
        await refresh();
      }
    },
    [toast, refresh],
  );
}

export function AppProvider({ backend, children, role }: { backend: Backend; children: ReactNode; role: "main" | "panel" | "popup" | "options" }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [toastMsg, setToast] = useState<string | null>(null);
  const [tzNotice, setTzNotice] = useState<string | null>(null);
  const player = useMemo(() => new VoicePlayer(backend), [backend]);
  const snapRef = useRef<Snapshot | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      let s = await backend.snapshot();
      if (!s.settings || !s.settings.profiles) {
        const t = nowIso();
        await backend.initDefaults(defaultSettings(t), defaultReminders(t), defaultTemplates());
        s = await backend.snapshot();
      }
      snapRef.current = s;
      setSnap(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [backend]);

  const toast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    void refresh();
    const off = backend.subscribe((e) => {
      if (e.type === "changed") void refresh();
      if (e.type === "deliver") {
        void refresh();
        // Only the always-alive main/background window speaks, so voices never double up.
        if (role === "main" && e.active.playVoice && snapRef.current) {
          for (const d of e.active.items) if (d.delivery === "popup_voice" || d.delivery === "voice") player.playDelivery(d, snapRef.current.settings);
        }
      }
      if (e.type === "stop-voice" && role === "main") player.stop();
      if (e.type === "test-voice" && role === "main" && snapRef.current) {
        const s = snapRef.current;
        player.playDelivery(
          {
            occurrenceId: "test",
            reminderId: "test",
            name: "Test",
            category: "walk",
            message: "This is your DeskWell test voice. Have a great day.",
            scheduledAt: nowIso(),
            delivery: "voice",
            voice: { mode: "pack", packId: "akib", profileId: null, audioIds: [], randomAudio: false, volume: 1 },
            language: s.settings.language,
            snoozeOptions: [],
            priority: "normal",
          },
          s.settings,
        );
      }
      if (e.type === "timezone") setTzNotice(`Your timezone changed from ${e.from} to ${e.to}. DeskWell updated your local schedule.`);
    });
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      off();
      window.clearInterval(t);
    };
  }, [backend, refresh, player, role]);

  // Apply theme.
  useEffect(() => {
    const theme = snap?.settings.theme ?? "system";
    const root = document.documentElement;
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.classList.toggle("dark", dark);
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [snap?.settings.theme]);

  return (
    <C.Provider value={{ backend, snap, error, refresh, player, now, toast, toastMsg, tzNotice, clearTzNotice: () => setTzNotice(null) }}>
      {children}
    </C.Provider>
  );
}
