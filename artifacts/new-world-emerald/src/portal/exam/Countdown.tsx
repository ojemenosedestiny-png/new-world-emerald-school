import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Remaining ms, corrected by server clock offset. */
export function useRemaining(deadline: string | undefined, offsetMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(t); }, []);
  if (!deadline) return null;
  return Math.max(0, new Date(deadline).getTime() - (now + offsetMs));
}

export function Countdown({ remaining }: { remaining: number }) {
  const total = Math.ceil(remaining / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const urgent = total <= 300;
  const announced = useRef<number>(-1);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const mark = [600, 300, 60].find((x) => total <= x && announced.current !== x && total > x - 2);
    if (mark) { announced.current = mark; setMsg(mark / 60 + " minutes remaining"); }
  }, [total]);
  return (
    <div className={cn("flex items-center gap-2 rounded-full px-3.5 py-1.5 font-bold tabular-nums transition-colors", urgent ? "bg-[hsl(var(--p-red))] text-white" : "bg-[hsl(var(--p-paper)/0.12)] text-[hsl(var(--p-paper))]")} data-testid="text-countdown">
      <span className="sr-only">Time remaining</span>
      <span className="text-lg">{h > 0 ? h + ":" : ""}{pad(m)}:{pad(s)}</span>
      <span className="sr-only" aria-live="polite">{msg}</span>
    </div>
  );
}
