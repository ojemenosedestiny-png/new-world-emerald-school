import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

export type PortalTheme = "light" | "dark" | "system";
const KEY = "nwe-portal-theme";

function readTheme(): PortalTheme {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "system"; } catch { return "system"; }
}
const systemDark = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;

/**
 * Applies the portal theme to <html> while a portal page is mounted, so dialogs rendered
 * outside the page root follow it too. The public website is unaffected once you leave.
 */
export function usePortalTheme() {
  const [theme, setTheme] = useState<PortalTheme>(readTheme);
  const [system, setSystem] = useState<boolean>(() => !!systemDark());
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setSystem(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  const resolved: "light" | "dark" = theme === "system" ? (system ? "dark" : "light") : theme;
  useEffect(() => {
    document.documentElement.dataset.portalTheme = resolved;
    return () => { delete document.documentElement.dataset.portalTheme; };
  }, [resolved]);
  const choose = (next: PortalTheme) => {
    setTheme(next);
    try { if (next === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, next); } catch { /* storage unavailable */ }
  };
  return { theme, resolved, setTheme: choose };
}

const OPTIONS: { value: PortalTheme; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/** Segmented light / dark / system control for the dark chrome surfaces. */
export function ThemeToggle({ theme, onChange }: { theme: PortalTheme; onChange: (t: PortalTheme) => void }) {
  return (
    <div role="radiogroup" aria-label="Colour theme" className="grid grid-cols-3 gap-1 rounded-xl bg-[hsl(var(--p-chrome-ink)/0.07)] p-1">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button key={value} type="button" role="radio" aria-checked={theme === value} title={label}
          onClick={() => onChange(value)}
          className={"flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors " + (theme === value ? "bg-[hsl(var(--p-chrome-ink)/0.16)] text-[hsl(var(--p-chrome-ink))]" : "text-[hsl(var(--p-chrome-ink)/0.6)] hover:text-[hsl(var(--p-chrome-ink))]")}
          data-testid={"theme-" + value}>
          <Icon size={13} aria-hidden="true" /><span>{label}</span>
        </button>
      ))}
    </div>
  );
}
