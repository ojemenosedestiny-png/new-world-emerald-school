import { createContext, useContext, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { LogOut, Menu, type LucideIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { asset } from "@/lib/asset";
import { ThemeToggle, type PortalTheme } from "./theme";

/** Lets a screen inside the shell open the navigation menu (e.g. the phone home header). */
const ShellMenuContext = createContext<() => void>(() => {});
export const useOpenShellMenu = () => useContext(ShellMenuContext);

export type NavItem<K extends string> = { key: K; label: string; icon: LucideIcon; badge?: number; testId?: string };
export type NavGroup<K extends string> = { label?: string; items: NavItem<K>[] };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

function SidebarBody<K extends string>({ subtitle, groups, active, onNavigate, user, theme, onTheme, onSignOut, signingOut, footer }: {
  subtitle: string; groups: NavGroup<K>[]; active: K; onNavigate: (key: K) => void;
  user: { name: string; detail: string }; theme: PortalTheme; onTheme: (t: PortalTheme) => void;
  onSignOut: () => void; signingOut?: boolean; footer?: ReactNode;
}) {
  return (
    <>
      <Link href="/" className="flex items-center gap-3 px-2" data-testid="link-portal-home">
        <img src={asset("/logo.jpg")} alt="New World Emerald logo" className="h-10 w-10 rounded-full bg-white object-contain p-0.5" />
        <span className="leading-tight">
          <span className="block font-serif text-[17px] font-bold">New World Emerald</span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] opacity-60">{subtitle}</span>
        </span>
      </Link>
      <nav aria-label="Main" className="-mx-1 flex-1 space-y-5 overflow-y-auto px-1">
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.label && <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-[hsl(var(--p-chrome-ink)/0.45)]">{g.label}</p>}
            <ul className="space-y-0.5">
              {g.items.map((item) => (
                <li key={item.key}>
                  <button type="button" className="portal-nav-item" aria-current={active === item.key ? "page" : undefined} onClick={() => onNavigate(item.key)} data-testid={item.testId ?? "nav-" + item.key}>
                    <item.icon size={17} aria-hidden="true" />
                    <span>{item.label}</span>
                    {!!item.badge && <span className="portal-nav-badge" aria-label={`${item.badge} need attention`}>{item.badge}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="space-y-3">
        {footer}
        <ThemeToggle theme={theme} onChange={onTheme} />
        <div className="flex items-center gap-3 rounded-2xl bg-[hsl(var(--p-chrome-ink)/0.06)] p-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[hsl(var(--p-gold))] text-sm font-bold text-[hsl(205_40%_8%)]" aria-hidden="true">{initials(user.name)}</span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-semibold">{user.name}</span>
            <span className="block truncate text-[11px] text-[hsl(var(--p-chrome-ink)/0.55)]">{user.detail}</span>
          </span>
          <button type="button" onClick={onSignOut} disabled={signingOut} className="grid h-8 w-8 place-items-center rounded-lg text-[hsl(var(--p-chrome-ink)/0.7)] hover:bg-[hsl(var(--p-chrome-ink)/0.1)] hover:text-[hsl(var(--p-chrome-ink))]" aria-label="Sign out" title="Sign out" data-testid="button-shell-signout">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </>
  );
}

/** Premium app layout shared by staff and student screens. */
export function AppShell<K extends string>(props: {
  subtitle: string; groups: NavGroup<K>[]; active: K; onNavigate: (key: K) => void;
  title: string; eyebrow?: string; actions?: ReactNode; children: ReactNode;
  user: { name: string; detail: string }; theme: PortalTheme; onTheme: (t: PortalTheme) => void;
  onSignOut: () => void; signingOut?: boolean; sidebarFooter?: ReactNode;
  /** Phone-only bottom bar; the item whose key matches `active` is highlighted. */
  bottomNav?: NavItem<K>[];
  /** Hide the top bar below desktop width when the screen draws its own header. */
  hideTopbarOnMobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const navigate = (key: K) => { props.onNavigate(key); setOpen(false); window.scrollTo({ top: 0 }); };
  const body = <SidebarBody {...props} footer={props.sidebarFooter} onNavigate={navigate} />;
  return (
    <div className="portal portal-app">
      <aside className="portal-sidebar" aria-label="Sidebar">{body}</aside>
      <Sheet open={open} onOpenChange={setOpen}>
        {/* .portal supplies the theme tokens; inline styles beat its page background and text colour. */}
        <SheetContent side="left" style={{ background: "hsl(var(--p-chrome))", color: "hsl(var(--p-chrome-ink))" }} className="portal flex w-[288px] max-w-[85vw] flex-col gap-5 border-none px-3.5 py-5 text-[hsl(var(--p-chrome-ink))] [&>button]:text-[hsl(var(--p-chrome-ink))]">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Portal sections</SheetDescription>
          {body}
        </SheetContent>
      </Sheet>
      <div className={"min-w-0 " + (props.bottomNav ? "pb-20 lg:pb-0" : "")}>
        <header className={"portal-topbar " + (props.hideTopbarOnMobile ? "hidden lg:block" : "")}>
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:px-8">
            {/* Wrapper carries the breakpoint: .portal-btn-ghost sets display and would override lg:hidden. */}
            <div className="lg:hidden"><button type="button" className="portal-btn-ghost !px-2.5" onClick={() => setOpen(true)} aria-label="Open menu" data-testid="button-open-menu"><Menu size={18} /></button></div>
            <div className="min-w-0 flex-1">
              {props.eyebrow && <p className="truncate text-[11px] font-bold uppercase tracking-[0.2em] text-[hsl(var(--p-emerald))]">{props.eyebrow}</p>}
              <h1 className="truncate font-serif text-2xl font-semibold md:text-[28px]" data-testid="text-page-title">{props.title}</h1>
            </div>
            {props.actions && <div className="flex shrink-0 items-center gap-2">{props.actions}</div>}
          </div>
        </header>
        <ShellMenuContext.Provider value={() => setOpen(true)}>
          <main className={"mx-auto max-w-6xl md:px-8 md:py-8 " + (props.hideTopbarOnMobile ? "px-0 pb-6 pt-0 lg:px-8" : "px-4 py-6")}>{props.children}</main>
        </ShellMenuContext.Provider>
      </div>
      {props.bottomNav && (
        <nav aria-label="Quick navigation" className="portal-bottom-nav lg:hidden" data-testid="bottom-nav">
          {props.bottomNav.map((item) => (
            <button key={item.key} type="button" onClick={() => item.key === ("__menu" as K) ? setOpen(true) : navigate(item.key)} aria-current={props.active === item.key ? "page" : undefined} className="portal-bottom-item" data-testid={"bottom-" + item.key}>
              <span className="relative"><item.icon size={21} aria-hidden="true" />{!!item.badge && <span className="portal-bottom-dot" aria-label={item.badge + " new"}>{item.badge > 9 ? "9+" : item.badge}</span>}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
