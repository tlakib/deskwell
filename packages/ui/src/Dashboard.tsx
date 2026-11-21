import { Suspense, lazy, useEffect, useState, type ComponentType } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  Brain,
  CalendarClock,
  Droplet,
  Eye,
  HardDriveDownload,
  LayoutDashboard,
  Mic,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { BRAND } from "@deskwell/domain";
import { cx } from "./components/ui";
import { useApp } from "./store";

const pages: { id: string; label: string; icon: LucideIcon; load: () => Promise<{ default: ComponentType }> }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, load: () => import("./pages/Overview") },
  { id: "reminders", label: "Reminders", icon: Bell, load: () => import("./pages/Reminders") },
  { id: "schedule", label: "Schedule", icon: CalendarClock, load: () => import("./pages/Schedule") },
  { id: "water", label: "Water Tracker", icon: Droplet, load: () => import("./pages/Water") },
  { id: "movement", label: "Movement & Exercises", icon: Activity, load: () => import("./pages/Movement") },
  { id: "eyes", label: "Eye Care", icon: Eye, load: () => import("./pages/EyeCare") },
  { id: "voice", label: "Voice Studio", icon: Mic, load: () => import("./pages/VoiceStudio") },
  { id: "focus", label: "Focus & Breaks", icon: Brain, load: () => import("./pages/Focus") },
  { id: "history", label: "History & Analytics", icon: BarChart3, load: () => import("./pages/History") },
  { id: "settings", label: "Settings", icon: Settings2, load: () => import("./pages/Settings") },
  { id: "backup", label: "Backup & Sync", icon: HardDriveDownload, load: () => import("./pages/Backup") },
];

const lazyPages = Object.fromEntries(pages.map((p) => [p.id, lazy(p.load)]));

function currentPage() {
  const h = window.location.hash.replace(/^#\/?/, "");
  return pages.some((p) => p.id === h) ? h : "overview";
}

export function Dashboard() {
  const { snap, error, backend, toastMsg, tzNotice, clearTzNotice } = useApp();
  const [page, setPage] = useState(currentPage);

  useEffect(() => {
    const onHash = () => setPage(currentPage());
    window.addEventListener("hashchange", onHash);
    const off = backend.subscribe((e) => {
      if (e.type === "navigate") window.location.hash = `#/${e.page}`;
    });
    return () => {
      window.removeEventListener("hashchange", onHash);
      off();
    };
  }, [backend]);

  const Page = lazyPages[page];

  return (
    <div className="flex h-full bg-bg text-fg">
      <nav aria-label="DeskWell sections" className="flex w-14 shrink-0 flex-col border-r border-line bg-surface md:w-56">
        <div className="flex items-center gap-2 px-3 py-4">
          <img src="icon.png" alt="" className="h-8 w-8 rounded-lg" />
          <div className="hidden md:block">
            <div className="text-sm font-semibold">{BRAND.name}</div>
            <div className="text-[11px] leading-tight text-fg-subtle">{BRAND.tagline}</div>
          </div>
        </div>
        <ul className="flex-1 space-y-0.5 overflow-y-auto px-2">
          {pages.map((p) => (
            <li key={p.id}>
              <a
                href={`#/${p.id}`}
                aria-current={page === p.id ? "page" : undefined}
                title={p.label}
                className={cx(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent",
                  page === p.id ? "bg-accent/12 font-medium text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <p.icon size={17} aria-hidden />
                <span className="hidden md:inline">{p.label}</span>
              </a>
            </li>
          ))}
        </ul>
        <div className="hidden px-3 py-3 text-[11px] text-fg-subtle md:block">
          Made by{" "}
          <a className="text-accent hover:underline" href={BRAND.authorLinkedIn} target="_blank" rel="noreferrer">
            {BRAND.author}
          </a>
        </div>
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl p-4 md:p-6">
          {tzNotice && (
            <div role="status" className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 p-3 text-sm">
              <span>{tzNotice}</span>
              <button className="text-xs text-fg-muted hover:text-fg" onClick={clearTzNotice}>
                Dismiss
              </button>
            </div>
          )}
          {error && <div className="mb-4 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">Could not load DeskWell data: {error}</div>}
          {snap ? (
            <Suspense fallback={<div className="text-sm text-fg-muted">Loading…</div>}>
              <Page />
            </Suspense>
          ) : (
            <div className="text-sm text-fg-muted">Loading…</div>
          )}
        </div>
      </main>
      {toastMsg && (
        <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-fg px-4 py-2 text-sm text-bg shadow-lg">
          {toastMsg}
        </div>
      )}
    </div>
  );
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
