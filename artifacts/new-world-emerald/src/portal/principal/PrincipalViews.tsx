import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useManagePrincipal, getGetPrincipalOverviewQueryKey, getGetPrincipalActivityQueryKey, useGetPrincipalActivity,
  type PrincipalOverview, type PrincipalClass, type PrincipalCommand, type PrincipalTeacherDay,
} from "@workspace/api-client-react";
import { ArrowLeftRight, CalendarDays, ChevronLeft, ChevronRight, Clock, Search, UserMinus, UserPlus, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Skeleton, StatusPill } from "../ui";
import { errorMessage } from "../lib";

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
const time = (iso: string | null | undefined) => iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";
const longDate = (d: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(d + "T12:00:00Z"));
const shiftDay = (d: string, by: number) => new Date(Date.parse(d + "T12:00:00Z") + by * 86_400_000).toISOString().slice(0, 10);

function usePrincipalCommand() {
  const m = useManagePrincipal();
  const qc = useQueryClient();
  const { toast } = useToast();
  const run = async (data: PrincipalCommand) => {
    try {
      const r = await m.mutateAsync({ data });
      toast({ title: r.message });
      await qc.invalidateQueries({ queryKey: getGetPrincipalOverviewQueryKey() });
      return true;
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); return false; }
  };
  return { run, pending: m.isPending };
}

function Figures({ items }: { items: [string, string | number, boolean?][] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, value, warn]) => (
        <div key={label} className="portal-card p-4">
          <p className={"text-xs font-semibold uppercase tracking-wider " + MUTED}>{label}</p>
          <p className={"mt-1 font-serif text-3xl font-semibold tabular-nums " + (warn ? "text-[hsl(var(--p-red))]" : "")}>{value}</p>
        </div>
      ))}
    </div>
  );
}

/** Every class: its class teachers (assign, change, remove) and the teacher for each subject. */
export function ClassesView({ data }: { data: PrincipalOverview }) {
  const cmd = usePrincipalCommand();
  const [search, setSearch] = useState("");
  const [replacing, setReplacing] = useState<{ cls: PrincipalClass; teacherId: number } | null>(null);
  const shown = data.classes.filter((c) => !search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase()) || c.teachers.some((t) => t.name.toLowerCase().includes(search.trim().toLowerCase())));
  const noTeacher = data.classes.filter((c) => !c.teachers.length).length;
  const noSubjectTeacher = data.classes.reduce((n, c) => n + c.subjects.filter((s) => !s.teacherId).length, 0);
  if (!data.classes.length) return <EmptyState icon={<Users size={22} />} title="No classes yet" body="The school office adds classes in the staff portal. They then appear here to assign teachers." />;
  return (
    <div className="space-y-5">
      <Figures items={[["Classes", data.classes.length], ["Teachers", data.teachers.length], ["Classes without a class teacher", noTeacher, noTeacher > 0], ["Subjects without a teacher", noSubjectTeacher, noSubjectTeacher > 0]]} />
      <label className="relative block max-w-sm">
        <span className="sr-only">Search classes or teachers</span>
        <Search size={15} className={"absolute left-3 top-1/2 -translate-y-1/2 " + MUTED} aria-hidden="true" />
        <input className="portal-input !pl-9" placeholder="Search a class or teacher" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-classes" />
      </label>
      <div className="grid gap-4 xl:grid-cols-2">
        {shown.map((c) => <ClassCard key={c.id} cls={c} data={data} cmd={cmd} onReplace={(teacherId) => setReplacing({ cls: c, teacherId })} />)}
      </div>
      {replacing && <ReplaceDialog data={data} cls={replacing.cls} teacherId={replacing.teacherId} cmd={cmd} onClose={() => setReplacing(null)} />}
    </div>
  );
}

function ClassCard({ cls, data, cmd, onReplace }: { cls: PrincipalClass; data: PrincipalOverview; cmd: ReturnType<typeof usePrincipalCommand>; onReplace: (teacherId: number) => void }) {
  const [pick, setPick] = useState("");
  const available = data.teachers.filter((t) => !cls.teachers.some((x) => x.id === t.id));
  return (
    <section className="portal-card p-5" aria-labelledby={`class-${cls.id}`} data-testid={`principal-class-${cls.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`class-${cls.id}`} className="font-serif text-2xl font-semibold">{cls.name}</h2>
        <span className={"text-sm " + MUTED}>{cls.students} {cls.students === 1 ? "student" : "students"}</span>
      </div>
      <h3 className={"mt-4 text-xs font-semibold uppercase tracking-wider " + MUTED}>Class teachers</h3>
      {cls.teachers.length ? (
        <ul className="mt-2 space-y-2">
          {cls.teachers.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-[hsl(var(--p-paper-2)/0.7)] px-3 py-2">
              <span className="min-w-0 flex-1 font-medium">{t.name}</span>
              <button type="button" className="portal-btn-ghost !min-h-[34px] !px-3 text-xs" disabled={cmd.pending || data.teachers.length < 2} onClick={() => onReplace(t.id)} data-testid={`button-change-${cls.id}-${t.id}`}><ArrowLeftRight size={13} aria-hidden="true" /> Change</button>
              <button type="button" className="portal-btn-ghost !min-h-[34px] !px-3 text-xs text-[hsl(var(--p-red))]" disabled={cmd.pending} onClick={() => { if (window.confirm(`Remove ${t.name} from ${cls.name}?`)) void cmd.run({ action: "remove", classId: cls.id, teacherId: t.id }); }} data-testid={`button-remove-${cls.id}-${t.id}`}><UserMinus size={13} aria-hidden="true" /> Remove</button>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 rounded-xl bg-[hsl(var(--p-gold-soft))] px-3 py-2 text-sm text-[hsl(var(--p-gold-ink))]">No class teacher yet.</p>}
      <div className="mt-3 flex gap-2">
        <label className="min-w-0 flex-1"><span className="sr-only">Teacher to assign to {cls.name}</span>
          <select className="portal-input" value={pick} onChange={(e) => setPick(e.target.value)} disabled={!available.length} data-testid={`select-assign-${cls.id}`}>
            <option value="">{available.length ? "Choose a teacher to assign" : "Every teacher is already here"}</option>
            {available.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <button type="button" className="portal-btn" disabled={!pick || cmd.pending} onClick={async () => { if (await cmd.run({ action: "assign", classId: cls.id, teacherId: Number(pick) })) setPick(""); }} data-testid={`button-assign-${cls.id}`}><UserPlus size={15} aria-hidden="true" /> Assign</button>
      </div>
      <h3 className={"mt-5 text-xs font-semibold uppercase tracking-wider " + MUTED}>Subject teachers</h3>
      {cls.subjects.length ? (
        <ul className="mt-2 divide-y divide-[hsl(var(--p-line))]">
          {cls.subjects.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 text-sm font-medium">{s.name}</span>
              <label className="w-52 shrink-0"><span className="sr-only">Teacher for {s.name} in {cls.name}</span>
                <select className={"portal-input !py-1.5 text-sm " + (s.teacherId ? "" : "!border-[hsl(var(--p-gold))]")} value={s.teacherId ?? ""} disabled={cmd.pending}
                  onChange={(e) => void cmd.run({ action: "setSubjectTeacher", classId: cls.id, subjectId: s.id, teacherId: e.target.value ? Number(e.target.value) : null })} data-testid={`select-subject-${s.id}`}>
                  <option value="">No teacher</option>
                  {data.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            </li>
          ))}
        </ul>
      ) : <p className={"mt-2 text-sm " + MUTED}>No subjects yet. The office adds them under Report cards → Subjects.</p>}
    </section>
  );
}

function ReplaceDialog({ data, cls, teacherId, cmd, onClose }: { data: PrincipalOverview; cls: PrincipalClass; teacherId: number; cmd: ReturnType<typeof usePrincipalCommand>; onClose: () => void }) {
  const out = data.teachers.find((t) => t.id === teacherId);
  const [into, setInto] = useState("");
  const theirSubjects = cls.subjects.filter((s) => s.teacherId === teacherId);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Change teacher</DialogTitle>
          <DialogDescription>Replace {out?.name} in {cls.name}.{theirSubjects.length ? ` Their subjects here (${theirSubjects.map((s) => s.name).join(", ")}) move to the new teacher.` : ""}</DialogDescription>
        </DialogHeader>
        <label className="block text-sm font-semibold">New teacher
          <select className="portal-input mt-1" value={into} onChange={(e) => setInto(e.target.value)} data-testid="select-replace-teacher">
            <option value="">Choose a teacher</option>
            {data.teachers.filter((t) => t.id !== teacherId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <DialogFooter className="gap-2">
          <button type="button" className="portal-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="portal-btn" disabled={!into || cmd.pending} onClick={async () => { if (await cmd.run({ action: "replace", classId: cls.id, teacherId, newTeacherId: Number(into) })) onClose(); }} data-testid="button-confirm-replace">{cmd.pending ? "Saving..." : "Change teacher"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Each teacher with their classes and subjects. */
export function TeachersView({ data }: { data: PrincipalOverview }) {
  const className = new Map(data.classes.map((c) => [c.id, c.name]));
  const subjectsOf = (id: number) => data.classes.flatMap((c) => c.subjects.filter((s) => s.teacherId === id).map((s) => `${s.name} (${c.name})`));
  if (!data.teachers.length) return <EmptyState icon={<Users size={22} />} title="No teachers yet" body="The school office adds teachers in the staff portal under Teachers." />;
  return (
    <div className="portal-card overflow-x-auto !p-0">
      <table className="w-full min-w-[640px] text-sm">
        <thead className={"text-left text-xs uppercase tracking-wider " + MUTED}><tr><th className="px-4 py-3">Teacher</th><th className="px-3 py-3">Class teacher of</th><th className="px-3 py-3">Subjects</th></tr></thead>
        <tbody>
          {data.teachers.map((t) => {
            const classes = t.classIds.map((id) => className.get(id)).filter(Boolean);
            const subjects = subjectsOf(t.id);
            return (
              <tr key={t.id} className="border-t border-[hsl(var(--p-line))] align-top" data-testid={`principal-teacher-${t.id}`}>
                <td className="px-4 py-3"><p className="font-semibold">{t.name}</p><p className={"break-all text-xs " + MUTED}>{t.email}</p></td>
                <td className="px-3 py-3">{classes.length ? classes.join(", ") : <StatusPill tone="gold">No class</StatusPill>}</td>
                <td className="px-3 py-3">{subjects.length ? subjects.join(", ") : <span className={MUTED}>None</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const KIND_LABEL: Record<keyof PrincipalTeacherDay["counts"], string> = {
  register: "Register", scores: "Report cards", exams: "Exams", marking: "Marking", messages: "Messages",
  assignments: "Assignments", notes: "Revision notes", announcements: "Announcements", other: "Other",
};

/** What each teacher did on a chosen day. */
export function ActivityView({ today }: { today: string }) {
  const [date, setDate] = useState(today);
  const q = useGetPrincipalActivity({ date }, { query: { queryKey: getGetPrincipalActivityQueryKey({ date }), refetchInterval: date === today ? 60_000 : false } });
  const teachers = useMemo(() => [...(q.data?.teachers ?? [])].sort((a, b) => (a.firstSeen ? 0 : 1) - (b.firstSeen ? 0 : 1) || (a.firstSeen ?? "").localeCompare(b.firstSeen ?? "") || a.name.localeCompare(b.name)), [q.data]);
  const active = teachers.filter((t) => t.firstSeen).length;
  return (
    <div className="space-y-5">
      <div className="portal-card flex flex-wrap items-center gap-2 p-4">
        <CalendarDays size={18} className={MUTED} aria-hidden="true" />
        <button type="button" className="portal-btn-ghost !min-h-[36px] !px-2" onClick={() => setDate(shiftDay(date, -1))} aria-label="Previous day" data-testid="button-prev-day"><ChevronLeft size={16} /></button>
        <label><span className="sr-only">Day</span><input type="date" className="portal-input !w-auto !py-1.5" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} data-testid="input-activity-date" /></label>
        <button type="button" className="portal-btn-ghost !min-h-[36px] !px-2" disabled={date >= today} onClick={() => setDate(shiftDay(date, 1))} aria-label="Next day" data-testid="button-next-day"><ChevronRight size={16} /></button>
        {date !== today && <button type="button" className="portal-btn-ghost !min-h-[36px] text-xs" onClick={() => setDate(today)}>Today</button>}
        <p className="ml-auto font-serif text-lg font-semibold">{longDate(date)}</p>
      </div>
      {q.isLoading ? <Skeleton className="h-60" /> : q.isError || !q.data ? <ErrorPanel title="Activity did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : (<>
        <Figures items={[["Teachers active", `${active} of ${teachers.length}`], ["Registers taken", teachers.reduce((n, t) => n + t.counts.register, 0)], ["Scripts and homework marked", teachers.reduce((n, t) => n + t.counts.marking, 0)], ["Messages answered", teachers.reduce((n, t) => n + t.counts.messages, 0)]]} />
        {!teachers.length ? <EmptyState icon={<Users size={22} />} title="No teachers yet" body="Teachers appear here once the office adds them." /> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {teachers.map((t) => <TeacherDay key={t.id} t={t} />)}
          </div>
        )}
        <p className={"text-xs " + MUTED}>Times are Nigerian time. A teacher counts as active when they open the staff portal or make a change. Viewing pages without changing anything only shows as time in the portal.</p>
      </>)}
    </div>
  );
}

function TeacherDay({ t }: { t: PrincipalTeacherDay }) {
  const kinds = (Object.keys(t.counts) as (keyof PrincipalTeacherDay["counts"])[]).filter((k) => t.counts[k] > 0);
  return (
    <article className="portal-card p-5" data-testid={`teacher-day-${t.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><h3 className="font-semibold">{t.name}</h3><p className={"text-xs " + MUTED}>{t.classes.length ? t.classes.join(", ") : "No class assigned"}</p></div>
        {t.firstSeen ? <StatusPill tone="green">Active {time(t.firstSeen)}{t.lastSeen && t.lastSeen !== t.firstSeen ? ` – ${time(t.lastSeen)}` : ""}</StatusPill> : <StatusPill tone="muted">No activity</StatusPill>}
      </header>
      {kinds.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {kinds.map((k) => <span key={k} className="rounded-full bg-[hsl(var(--p-emerald-soft))] px-2.5 py-0.5 text-xs font-semibold text-[hsl(var(--p-emerald))]">{KIND_LABEL[k]} · {t.counts[k]}</span>)}
        </div>
      )}
      {t.actions.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold">Timeline ({t.actions.length} {t.actions.length === 1 ? "change" : "changes"})</summary>
          <ol className="mt-2 space-y-1.5 border-l-2 border-[hsl(var(--p-line))] pl-3">
            {t.actions.map((a, i) => <li key={i} className="flex gap-3 text-sm"><span className={"w-16 shrink-0 whitespace-nowrap tabular-nums " + MUTED}><Clock size={11} className="mr-1 inline" aria-hidden="true" />{time(a.at)}</span><span>{a.label}</span></li>)}
          </ol>
        </details>
      ) : t.firstSeen ? <p className={"mt-3 text-sm " + MUTED}>Opened the portal but made no changes.</p> : null}
    </article>
  );
}
