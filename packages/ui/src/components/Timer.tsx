import { useEffect, useState } from "react";
import { Play, Square } from "lucide-react";
import { Button } from "./ui";

/** A small guided countdown used for exercises and eye breaks. Purely local; logs nothing. */
export function GuidedTimer({ seconds, label, onDone }: { seconds: number; label: string; onDone?: () => void }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (left === null) return;
    if (left <= 0) {
      setLeft(null);
      onDone?.();
      return;
    }
    const t = window.setTimeout(() => setLeft((l) => (l === null ? null : l - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [left, onDone]);
  return left === null ? (
    <Button size="sm" onClick={() => setLeft(seconds)} aria-label={`Start ${label}`}>
      <Play size={13} /> {seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`}
    </Button>
  ) : (
    <Button size="sm" variant="primary" onClick={() => setLeft(null)} aria-label={`Stop ${label}`}>
      <Square size={12} /> <span className="tabular-nums">{left}s</span>
    </Button>
  );
}
