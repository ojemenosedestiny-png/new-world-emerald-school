import { useMemo, useState, type CSSProperties } from "react";
import { useGetStudentReports, getGetStudentReportsQueryKey, type PortalDashboard } from "@workspace/api-client-react";
import { Award, Bell, BookOpen, ChevronRight, ClipboardList, FileBarChart, Megaphone, Menu, MapPin, Search, Timer, UserRound, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useOpenShellMenu } from "./shell/AppShell";
import { examWindow } from "./lib";
import { markSeen, readSeen, searchPortal, studentNotifications } from "./notifications";

export type StudentSection = "home" | "exams" | "results" | "reports" | "revision" | "notices" | "profile";

type Feature = { section: StudentSection; label: string; detail: string; icon: LucideIcon; tile: string; badge?: number };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

/** Phone-first home: greeting, bell, search, feature tiles and what is coming up. */
export function StudentHome({ data, name, studentId, onGo }: { data: PortalDashboard; name: string; studentId: string; onGo: (s: StudentSection) => void }) {
  const openMenu = useOpenShellMenu();
  const reports = useGetStudentReports({ query: { queryKey: getGetStudentReportsQueryKey() } });
  const [query, setQuery] = useState("");
  const [seenVersion, setSeenVersion] = useState(0);
  const now = Date.now();
  const firstName = name.split(" ")[0];
  const openExams = data.exams.filter((e) => examWindow(e.startsAt, e.endsAt, now) === "open" && !data.attempts.some((a) => a.examId === e.id && a.status !== "in_progress")).length;
  const notifications = useMemo(() => studentNotifications(data, reports.data, readSeen(studentId), now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, reports.data, studentId, seenVersion]);
  const unseen = notifications.filter((n) => n.unseen).length;
  const newNotices = notifications.filter((n) => n.kind === "notice" && n.unseen).length;

  const features: Feature[] = [
    { section: "profile", label: "Profile", detail: "Your details and password", icon: UserRound, tile: "262 60% 55%" },
    { section: "exams", label: "Exams", detail: "Schedule and start", icon: ClipboardList, tile: "152 55% 36%", badge: openExams },
    { section: "results", label: "GradeSheet", detail: "Your exam results", icon: Award, tile: "41 80% 46%" },
    { section: "reports", label: "Report cards", detail: "Term results and PDF", icon: FileBarChart, tile: "212 75% 52%" },
    { section: "notices", label: "Notices", detail: "Latest updates", icon: Megaphone, tile: "330 65% 55%", badge: newNotices },
    { section: "revision", label: "Library", detail: "Notes and resources", icon: BookOpen, tile: "183 60% 36%" },
  ];
  const hits = searchPortal(query, data, features);
  const upcoming = data.exams
    .filter((e) => examWindow(e.startsAt, e.endsAt, now) !== "closed")
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .slice(0, 4);
  const day = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-NG", opts).format(new Date(iso));

  return (
    <div className="space-y-6">
      <section className="portal-hero rounded-b-[28px] px-5 pb-14 pt-5 lg:rounded-[28px] lg:px-8 lg:pt-7" data-testid="home-hero">
        <div className="flex items-center gap-3">
          <div className="lg:hidden"><button type="button" onClick={openMenu} className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-white" aria-label="Open menu" data-testid="button-home-menu"><Menu size={20} /></button></div>
          <div className="min-w-0 flex-1">
            <p className="font-serif text-2xl font-semibold leading-tight">Student Portal</p>
            <p className="mt-1 text-[15px] text-white/90" data-testid="text-student-name">Hello, {firstName} <span aria-hidden="true">👋</span></p>
            <p className="text-sm text-white/70">Have a great day ahead!</p>
          </div>
          <Popover onOpenChange={(open) => { if (!open && unseen) { markSeen(studentId, notifications.map((n) => n.key)); setSeenVersion((v) => v + 1); } }}>
            <PopoverTrigger asChild>
              <button type="button" className="relative grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label={unseen ? `Notifications, ${unseen} new` : "Notifications"} data-testid="button-notifications">
                <Bell size={20} />
                {unseen > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[hsl(4_70%_52%)] px-1 text-[10px] font-bold" data-testid="badge-notifications">{unseen > 9 ? "9+" : unseen}</span>}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="portal !min-h-0 w-[min(92vw,360px)] rounded-2xl p-0" data-testid="panel-notifications">
              <p className="border-b border-[hsl(var(--p-line))] px-4 py-3 text-sm font-semibold">Notifications</p>
              {notifications.length === 0 ? <p className="px-4 py-6 text-center text-sm text-[hsl(var(--p-ink)/0.55)]">You are all caught up.</p> : (
                <ul className="max-h-[60vh] divide-y divide-[hsl(var(--p-line))] overflow-y-auto">
                  {notifications.slice(0, 15).map((n) => (
                    <li key={n.key}>
                      <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[hsl(var(--p-paper-2)/0.6)]" onClick={() => onGo(n.section)}>
                        <span className={"mt-1.5 h-2 w-2 shrink-0 rounded-full " + (n.unseen ? "bg-[hsl(var(--p-emerald))]" : "bg-transparent")} aria-hidden="true" />
                        <span className="min-w-0"><span className="block truncate text-sm font-semibold">{n.title}</span><span className="block truncate text-xs text-[hsl(var(--p-ink)/0.6)]">{n.detail}</span></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </PopoverContent>
          </Popover>
          <button type="button" onClick={() => onGo("profile")} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[hsl(41_72%_52%)] font-bold text-[hsl(205_40%_10%)] ring-2 ring-white/40" aria-label="Your profile" data-testid="button-avatar">{initials(name)}</button>
        </div>
      </section>

      <div className="relative z-10 -mt-12 px-4 lg:px-0">
        <label className="relative block">
          <span className="sr-only">Search</span>
          <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--p-emerald))]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search anything..." className="portal-input !rounded-2xl !py-3.5 shadow-[0_14px_30px_-20px_hsl(var(--p-ink)/0.5)]" style={{ paddingLeft: "2.75rem" }} data-testid="input-home-search" />
        </label>
        {query.trim().length >= 2 && (
          <div className="portal-card mt-2 overflow-hidden" data-testid="panel-search">
            {hits.length === 0 ? <p className="px-4 py-4 text-sm text-[hsl(var(--p-ink)/0.6)]">Nothing matches "{query.trim()}".</p> : (
              <ul className="divide-y divide-[hsl(var(--p-line))]">
                {hits.map((h) => (
                  <li key={h.key}><button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[hsl(var(--p-paper-2)/0.6)]" onClick={() => { setQuery(""); onGo(h.section); }}>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{h.label}</span><span className="block truncate text-xs text-[hsl(var(--p-ink)/0.6)]">{h.detail}</span></span>
                    <ChevronRight size={15} className="opacity-50" />
                  </button></li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <section className="px-4 lg:px-0" aria-label="Quick access">
        <h2 className="mb-3 text-lg font-semibold">Quick Access</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {features.map((f) => (
            <button key={f.section} type="button" onClick={() => onGo(f.section)} className="portal-tile" style={{ "--tile": f.tile } as CSSProperties} data-testid={"tile-" + f.section}>
              {!!f.badge && <span className="absolute right-3 top-3 rounded-full bg-[hsl(var(--tile))] px-2 py-0.5 text-[11px] font-bold text-white">{f.badge}</span>}
              <span className="portal-tile-icon"><f.icon size={20} aria-hidden="true" /></span>
              <span className="mt-auto flex items-end justify-between gap-2">
                <span className="min-w-0"><span className="block font-semibold">{f.label}</span><span className="block text-xs text-[hsl(var(--p-ink)/0.6)]">{f.detail}</span></span>
                <ChevronRight size={16} className="shrink-0 opacity-50" />
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="px-4 lg:px-0" aria-label="Upcoming exams">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">Upcoming</h2><button type="button" className="text-sm font-semibold text-[hsl(var(--p-emerald))]" onClick={() => onGo("exams")}>View all</button></div>
        {upcoming.length === 0 ? (
          <p className="portal-card px-4 py-6 text-center text-sm text-[hsl(var(--p-ink)/0.6)]">Nothing scheduled. New exams appear here when your teacher publishes them.</p>
        ) : (
          <div className="portal-card divide-y divide-[hsl(var(--p-line))] overflow-hidden">
            {upcoming.map((e, i) => {
              const open = examWindow(e.startsAt, e.endsAt, now) === "open";
              return (
                <button key={e.id} type="button" onClick={() => onGo("exams")} className="flex w-full items-center gap-4 p-4 text-left hover:bg-[hsl(var(--p-paper-2)/0.5)]" data-testid={"upcoming-" + e.id}>
                  <span className="grid h-16 w-14 shrink-0 place-items-center rounded-2xl text-center" style={{ background: i % 2 ? "hsl(var(--p-gold-soft))" : "hsl(var(--p-emerald-soft))" }}>
                    <span className="leading-tight"><span className="block text-[10px] font-bold uppercase text-[hsl(var(--p-ink)/0.55)]">{day(e.startsAt, { month: "short" })}</span><span className="block text-xl font-bold">{day(e.startsAt, { day: "numeric" })}</span><span className="block text-[10px] text-[hsl(var(--p-ink)/0.55)]">{day(e.startsAt, { weekday: "short" })}</span></span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{e.title}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-[hsl(var(--p-ink)/0.6)]"><Timer size={12} /> {day(e.startsAt, { hour: "numeric", minute: "2-digit" })} - {day(e.endsAt, { hour: "numeric", minute: "2-digit" })} / {e.durationMinutes} min</span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-[hsl(var(--p-ink)/0.6)]"><MapPin size={12} /> {e.subject}</span>
                  </span>
                  <span className={"shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold " + (open ? "bg-[hsl(var(--p-emerald-soft))] text-[hsl(var(--p-emerald))]" : "bg-[hsl(var(--p-gold-soft))] text-[hsl(var(--p-gold-ink))]")}>{open ? "Open now" : "Upcoming"}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
