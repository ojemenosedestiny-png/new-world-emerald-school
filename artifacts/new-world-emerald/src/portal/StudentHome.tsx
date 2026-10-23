import type { ReactNode } from "react";
import type { PortalDashboard } from "@workspace/api-client-react";
import { ArrowRight, Award, CalendarClock, ClipboardList, Megaphone, PlayCircle } from "lucide-react";
import { EmptyState } from "./ui";
import { examWindow } from "./lib";

export type StudentSection = "home" | "exams" | "results" | "reports" | "revision" | "notices";

function Tile({ label, value, icon, testId }: { label: string; value: string; icon: ReactNode; testId: string }) {
  return (
    <div className="portal-card p-4" data-testid={testId}>
      <div className="flex items-center justify-between text-[hsl(var(--p-ink)/0.55)]"><p className="text-xs font-semibold">{label}</p><span aria-hidden="true">{icon}</span></div>
      <p className="portal-stat-value mt-2 text-3xl">{value}</p>
    </div>
  );
}

export function StudentHome({ data, firstName, studentId, average, nextExam, onGo }: {
  data: PortalDashboard; firstName: string; studentId: string; average: { average: number; count: number } | null;
  nextExam: ReactNode | null; onGo: (s: StudentSection) => void;
}) {
  const now = Date.now();
  const open = data.exams.filter((e) => examWindow(e.startsAt, e.endsAt, now) === "open").length;
  const upcoming = data.exams.filter((e) => examWindow(e.startsAt, e.endsAt, now) === "upcoming").length;
  const latestNotice = data.notices[data.notices.length - 1];
  const latestResult = [...data.attempts].filter((a) => a.status === "marked" && a.resultsReleased && typeof a.score === "number").pop();
  const today = new Intl.DateTimeFormat("en-NG", { weekday: "long", day: "numeric", month: "long" }).format(now);

  return (
    <div className="space-y-6">
      <section className="portal-card relative overflow-hidden p-6 md:p-8" style={{ background: "linear-gradient(120deg, hsl(var(--p-emerald) / 0.14), hsl(var(--p-gold) / 0.10)), hsl(var(--p-surface) / 0.9)" }}>
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[hsl(var(--p-emerald))]">{data.className || "Your class"} <span className="text-[hsl(var(--p-ink)/0.4)]">/ {studentId}</span></p>
        <h2 className="mt-2 font-serif text-3xl font-semibold md:text-4xl" data-testid="text-student-name">Good to see you, {firstName}.</h2>
        <p className="mt-2 text-sm text-[hsl(var(--p-ink)/0.65)]">{today}. {open ? `${open} ${open === 1 ? "exam is" : "exams are"} open now.` : upcoming ? `${upcoming} upcoming ${upcoming === 1 ? "exam" : "exams"}.` : "No exams are scheduled right now."}</p>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Open now" value={String(open)} icon={<PlayCircle size={16} />} testId="tile-open" />
        <Tile label="Upcoming" value={String(upcoming)} icon={<CalendarClock size={16} />} testId="tile-upcoming" />
        <Tile label="Average" value={average ? average.average + "%" : "-"} icon={<Award size={16} />} testId="tile-average" />
        <Tile label="Notices" value={String(data.notices.length)} icon={<Megaphone size={16} />} testId="tile-notices" />
      </div>

      <section aria-label="Next exam">
        <div className="mb-3 flex items-center justify-between"><h3 className="text-[15px] font-semibold">Next up</h3><button type="button" className="portal-btn-ghost text-xs" onClick={() => onGo("exams")}>All exams <ArrowRight size={12} /></button></div>
        {nextExam ?? <EmptyState icon={<ClipboardList size={22} />} title="Nothing scheduled" body="When your teacher publishes an exam for your class, it appears here with its date and time." />}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="portal-card p-5" aria-label="Latest result">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-[15px] font-semibold">Latest result</h3><button type="button" className="text-xs font-semibold text-[hsl(var(--p-emerald))]" onClick={() => onGo("results")}>All results</button></div>
          {latestResult ? (
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0"><p className="text-xs uppercase tracking-wider text-[hsl(var(--p-ink)/0.5)]">{latestResult.subject}</p><p className="truncate font-serif text-lg font-semibold">{latestResult.title}</p></div>
              <p className="portal-stat-value text-3xl text-[hsl(var(--p-emerald))]">{latestResult.score}<span className="text-base text-[hsl(var(--p-ink)/0.45)]"> / {latestResult.totalMarks}</span></p>
            </div>
          ) : <p className="text-sm text-[hsl(var(--p-ink)/0.55)]">Results appear here once your teacher releases them.</p>}
        </section>
        <section className="portal-card p-5" aria-label="Latest notice">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-[15px] font-semibold">Latest notice</h3><button type="button" className="text-xs font-semibold text-[hsl(var(--p-emerald))]" onClick={() => onGo("notices")}>All notices</button></div>
          {latestNotice ? <><p className="font-semibold">{latestNotice.title}</p><p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-[hsl(var(--p-ink)/0.7)]">{latestNotice.body}</p></> : <p className="text-sm text-[hsl(var(--p-ink)/0.55)]">Messages from your teachers appear here.</p>}
        </section>
      </div>
    </div>
  );
}
