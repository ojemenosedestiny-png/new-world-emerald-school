import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useManagePrincipal, getGetPrincipalOverviewQueryKey, getGetPrincipalActivityQueryKey, useGetPrincipalActivity,
  type PrincipalOverview, type PrincipalClass, type PrincipalCommand, type PrincipalTeacher, type PrincipalTeacherDay, type GetPrincipalActivitySection,
} from "@workspace/api-client-react";
import { ArrowLeftRight, CalendarDays, ChevronLeft, ChevronRight, Clock, Layers, Search, UserMinus, UserPlus, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Skeleton, StatusPill } from "../ui";
import { errorMessage } from "../lib";
import { armName, groupClasses } from "./groups";

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

/** Teacher choices: this section's teachers first, then any other teacher (some teach in both schools). */
function TeacherOptions({ teachers }: { teachers: PrincipalTeacher[] }) {
  const here = teachers.filter((t) => t.inSection), elsewhere = teachers.filter((t) => !t.inSection);
  if (!elsewhere.length) return <>{here.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</>;
  return (<>
    {here.length > 0 && <optgroup label="Teachers in this school">{here.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
    <optgroup label="Other teachers">{elsewhere.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
  </>);
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

/** Every class in the section: its class teachers (assign, change, remove) and the teacher for each subject. */
export function ClassesView({ data, classes = "JSS 1 to SS 3" }: { data: PrincipalOverview; classes?: string }) {
  const cmd = usePrincipalCommand();
  const [search, setSearch] = useState("");
  const [replacing, setReplacing] = useState<{ cls: PrincipalClass; teacherId: number } | null>(null);
  const [sort, setSort] = useState<ClassSort>("school");
  const shown = data.classes.filter((c) => !search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase()) || c.teachers.some((t) => t.name.toLowerCase().includes(search.trim().toLowerCase())));
  const groups = sortGroups(groupClasses(shown), sort);
  const noTeacher = data.classes.filter((c) => !c.teachers.length).length;
  const noSubjectTeacher = data.classes.reduce((n, c) => n + c.subjects.filter((s) => !s.teacherId).length, 0);
  if (!data.classes.length) return <EmptyState icon={<Users size={22} />} title="No classes yet" body={`Classes ${classes} appear here once the school office adds them in the staff portal (named like ${classes.split(" to ")[0]}).`} />;
  return (
    <div className="space-y-5">
      <Figures items={[["Classes", data.classes.length], ["Teachers", data.teachers.filter((t) => t.inSection).length], ["Classes without a class teacher", noTeacher, noTeacher > 0], ["Subjects without a teacher", noSubjectTeacher, noSubjectTeacher > 0]]} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[14rem] max-w-sm flex-1">
          <span className="sr-only">Search classes or teachers</span>
          <Search size={15} className={"absolute left-3 top-1/2 -translate-y-1/2 " + MUTED} aria-hidden="true" />
          <input className="portal-input !pl-9" placeholder="Search a class or teacher" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-classes" />
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">Sort
          <select className="portal-input !w-auto" value={sort} onChange={(e) => setSort(e.target.value as ClassSort)} data-testid="select-sort-classes">
            {(Object.keys(SORTS) as ClassSort[]).map((k) => <option key={k} value={k}>{SORTS[k]}</option>)}
          </select>
        </label>
      </div>
      {groups.map(({ group, classes: arms }) => (
        <section key={group.key} className="space-y-3" aria-labelledby={arms.length > 1 ? `group-${group.key}` : undefined} data-testid={`year-group-${group.key.replace(/\s+/g, "-")}`}>
          {arms.length > 1 && (
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[hsl(var(--p-line))] pb-2">
              <h2 id={`group-${group.key}`} className="flex items-center gap-2 font-serif text-2xl font-semibold"><Layers size={18} aria-hidden="true" className="text-[hsl(var(--p-emerald))]" />{group.label}</h2>
              <p className={"text-sm " + MUTED}>{arms.length} arms: {arms.map((a) => armName(a.name) || a.name).join(", ")} · {arms.reduce((n, a) => n + a.students, 0)} students</p>
            </div>
          )}
          {arms.length > 1 && <GroupSubjects label={group.label} arms={arms} data={data} cmd={cmd} />}
          <div className="grid gap-4 xl:grid-cols-2">
            {arms.map((c) => <ClassCard key={c.id} cls={c} data={data} cmd={cmd} onReplace={(teacherId) => setReplacing({ cls: c, teacherId })} />)}
          </div>
        </section>
      ))}
      {replacing && <ReplaceDialog data={data} cls={replacing.cls} teacherId={replacing.teacherId} cmd={cmd} onClose={() => setReplacing(null)} />}
    </div>
  );
}

type ClassSort = "school" | "name" | "attention" | "students";
const SORTS: Record<ClassSort, string> = { school: "School order (Year 1 to SS 3)", name: "Name A to Z", attention: "Needs teachers first", students: "Most students first" };
const gaps = (arms: PrincipalClass[]) => arms.reduce((n, c) => n + (c.teachers.length ? 0 : 1) + c.subjects.filter((s) => !s.teacherId).length, 0);

/** Year groups in the chosen order. */
function sortGroups(groups: ReturnType<typeof groupClasses<PrincipalClass>>, sort: ClassSort) {
  const by: Record<ClassSort, (a: typeof groups[number], b: typeof groups[number]) => number> = {
    school: (a, b) => a.group.order - b.group.order || a.group.label.localeCompare(b.group.label, undefined, { numeric: true }),
    name: (a, b) => a.group.label.localeCompare(b.group.label, undefined, { numeric: true }),
    attention: (a, b) => gaps(b.classes) - gaps(a.classes) || a.group.order - b.group.order,
    students: (a, b) => b.classes.reduce((n, c) => n + c.students, 0) - a.classes.reduce((n, c) => n + c.students, 0),
  };
  return [...groups].sort(by[sort]);
}

/**
 * One subject's teacher for every arm of a year group at once. A subject offered in some arms only is set there;
 * when the arms have different teachers it reads "Different in each arm" until one is chosen for all.
 */
function GroupSubjects({ label, arms, data, cmd }: { label: string; arms: PrincipalClass[]; data: PrincipalOverview; cmd: ReturnType<typeof usePrincipalCommand> }) {
  const subjects = new Map<string, { name: string; rows: { classId: number; teacherId: number | null }[] }>();
  for (const c of arms) for (const s of c.subjects) {
    const key = s.name.trim().toLowerCase();
    const entry = subjects.get(key) ?? { name: s.name.trim(), rows: [] };
    entry.rows.push({ classId: c.id, teacherId: s.teacherId });
    subjects.set(key, entry);
  }
  if (!subjects.size) return null;
  return (
    <details className="portal-card p-4" data-testid={`group-subjects-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <summary className="cursor-pointer font-semibold">Subject teachers for all {label} arms <span className={"font-normal " + MUTED}>({subjects.size} subjects)</span></summary>
      <p className={"mt-2 text-sm " + MUTED}>Choose a teacher once to set it in every arm that offers the subject. Change a single arm in its own card below.</p>
      <ul className="mt-3 divide-y divide-[hsl(var(--p-line))]">
        {[...subjects.values()].sort((a, b) => a.name.localeCompare(b.name)).map((sub) => {
          const ids = new Set(sub.rows.map((r) => r.teacherId));
          const same = ids.size === 1 ? [...ids][0] : undefined;
          return (
            <li key={sub.name} className="flex flex-wrap items-center gap-3 py-2">
              <span className="min-w-0 flex-1 text-sm font-medium">{sub.name} <span className={"text-xs " + MUTED}>{sub.rows.length} of {arms.length} arms</span></span>
              <label className="w-60 shrink-0"><span className="sr-only">Teacher for {sub.name} in all {label} arms</span>
                <select className={"portal-input !py-1.5 text-sm " + (same === null ? "!border-[hsl(var(--p-gold))]" : "")} value={same === undefined ? "mixed" : same ?? ""} disabled={cmd.pending}
                  onChange={(e) => { if (e.target.value === "mixed") return; void cmd.run({ action: "setGroupSubjectTeacher", classId: sub.rows[0].classId, classIds: sub.rows.map((r) => r.classId), subjectName: sub.name, teacherId: e.target.value ? Number(e.target.value) : null }); }}
                  data-testid={`select-group-subject-${sub.name.toLowerCase().replace(/\s+/g, "-")}`}>
                  {same === undefined && <option value="mixed">Different in each arm</option>}
                  <option value="">No teacher</option>
                  <TeacherOptions teachers={data.teachers} />
                </select>
              </label>
            </li>
          );
        })}
      </ul>
    </details>
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
            <TeacherOptions teachers={available} />
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
                  <TeacherOptions teachers={data.teachers} />
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
            <TeacherOptions teachers={data.teachers.filter((t) => t.id !== teacherId)} />
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

/** Each of the section's teachers with their classes and subjects here. */
export function TeachersView({ data }: { data: PrincipalOverview }) {
  const teachers = data.teachers.filter((t) => t.inSection);
  const className = new Map(data.classes.map((c) => [c.id, c.name]));
  const subjectsOf = (id: number) => data.classes.flatMap((c) => c.subjects.filter((s) => s.teacherId === id).map((s) => `${s.name} (${c.name})`));
  if (!teachers.length) return <EmptyState icon={<Users size={22} />} title="No teachers yet" body="The school office adds teachers in the staff portal under Teachers." />;
  return (
    <div className="portal-card overflow-x-auto !p-0">
      <table className="w-full min-w-[640px] text-sm">
        <thead className={"text-left text-xs uppercase tracking-wider " + MUTED}><tr><th className="px-4 py-3">Teacher</th><th className="px-3 py-3">Class teacher of</th><th className="px-3 py-3">Subjects</th></tr></thead>
        <tbody>
          {teachers.map((t) => {
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
export function ActivityView({ today, section = "secondary" }: { today: string; section?: GetPrincipalActivitySection }) {
  const [date, setDate] = useState(today);
  const q = useGetPrincipalActivity({ date, section }, { query: { queryKey: getGetPrincipalActivityQueryKey({ date, section }), refetchInterval: date === today ? 60_000 : false } });
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
