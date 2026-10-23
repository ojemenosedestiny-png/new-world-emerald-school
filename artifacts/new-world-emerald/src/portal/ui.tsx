import type { ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowLeft, RotateCw } from "lucide-react";
import { asset } from "@/lib/asset";
import { cn } from "@/lib/utils";

export function PortalBrand({ subtitle }: { subtitle: string }) {
  return (
    <Link href="/" className="flex items-center gap-3" data-testid="link-portal-home">
      <img src={asset("/logo.jpg")} alt="New World Emerald logo" className="h-10 w-10 rounded-full bg-white object-contain p-0.5" />
      <span className="leading-tight">
        <span className="block font-serif text-[17px] font-bold">New World Emerald</span>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] opacity-60">{subtitle}</span>
      </span>
    </Link>
  );
}

export function PortalHeader({ subtitle, children }: { subtitle: string; children?: ReactNode }) {
  return (
    <header className="portal-header sticky top-0 z-30 text-[hsl(var(--p-chrome-ink))]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 md:px-8">
        <PortalBrand subtitle={subtitle} />
        <div className="flex items-center gap-2">{children}</div>
      </div>
    </header>
  );
}

export function StatusPill({ tone, children, testId }: { tone: "green" | "gold" | "ink" | "red" | "muted"; children: ReactNode; testId?: string }) {
  return (
    <span data-testid={testId} className={cn("portal-pill", "portal-pill-" + tone)}>
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="portal-empty">
      <div className="portal-empty-icon" aria-hidden="true">{icon}</div>
      <h3 className="font-serif text-xl font-semibold text-[hsl(var(--p-ink))]">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[hsl(var(--p-ink)/0.62)]">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorPanel({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-[hsl(var(--p-red)/0.25)] bg-[hsl(var(--p-red)/0.06)] p-5 text-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 shrink-0 text-[hsl(var(--p-red))]" size={18} />
        <div className="flex-1">
          <p className="font-semibold text-[hsl(var(--p-ink))]">{title}</p>
          <p className="mt-1 text-[hsl(var(--p-ink)/0.7)]">{message}</p>
          {onRetry && (
            <button onClick={onRetry} className="portal-btn-ghost mt-3" data-testid="button-retry">
              <RotateCw size={14} /> Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("portal-skeleton", className)} aria-hidden="true" />;
}

export function BackToWebsite({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-1.5 text-sm font-medium transition-opacity hover:opacity-100", light ? "text-[hsl(var(--p-paper)/0.75)]" : "text-[hsl(var(--p-ink)/0.6)]")} data-testid="link-back-website">
      <ArrowLeft size={15} /> School website
    </Link>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="portal-label">{label}</label>
      {children}
      {hint && <p className="text-xs text-[hsl(var(--p-ink)/0.55)]">{hint}</p>}
    </div>
  );
}
