import { useState } from "react";
import { useListClassStudents, getListClassStudentsQueryKey } from "@workspace/api-client-react";
import { Check, Search, UserCheck, Users, X } from "lucide-react";
import { Avatar } from "../photos";

/**
 * Who writes the exam: the whole class, or particular students of it (for example one child who missed the paper).
 * `chosen` is null for the whole class, or the chosen students' ids.
 */
export function ExamAudience({ classId, className, chosen, onChange }: { classId: number; className: string; chosen: number[] | null | undefined; onChange: (ids: number[] | null) => void }) {
  const some = Array.isArray(chosen);
  const picked = chosen ?? [];
  const option = (on: boolean) => "flex flex-1 items-start gap-3 rounded-2xl border p-3 text-left transition " + (on ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald-soft)/0.5)] ring-1 ring-[hsl(var(--p-emerald)/0.4)]" : "border-[hsl(var(--p-line))] hover:border-[hsl(var(--p-emerald)/0.5)]");

  return (
    <fieldset className="rounded-2xl border border-[hsl(var(--p-line))] p-4" data-testid="fieldset-exam-audience">
      <legend className="portal-label px-1">Who writes this exam?</legend>
      <div className="flex flex-col gap-2 sm:flex-row" role="radiogroup">
        <button type="button" role="radio" aria-checked={!some} className={option(!some)} onClick={() => onChange(null)} data-testid="audience-whole-class">
          <Users size={18} className="mt-0.5 shrink-0 text-[hsl(var(--p-emerald))]" aria-hidden />
          <span><span className="block text-sm font-semibold">The whole class</span><span className="block text-xs text-[hsl(var(--p-ink)/0.6)]">Every student in {className || "the class"}{" "}sees it.</span></span>
        </button>
        <button type="button" role="radio" aria-checked={some} className={option(some)} onClick={() => onChange(picked)} data-testid="audience-particular">
          <UserCheck size={18} className="mt-0.5 shrink-0 text-[hsl(var(--p-emerald))]" aria-hidden />
          <span><span className="block text-sm font-semibold">Particular students</span><span className="block text-xs text-[hsl(var(--p-ink)/0.6)]">Only the students you choose see it, for example a child who missed the exam.</span></span>
        </button>
      </div>

      {some && <StudentSearch classId={classId} className={className} picked={picked} onChange={onChange} />}
    </fieldset>
  );
}

/** Search the class's students by name or ID and tick the ones who write the exam (loads only when needed). */
function StudentSearch({ classId, className, picked, onChange }: { classId: number; className: string; picked: number[]; onChange: (ids: number[]) => void }) {
  const [search, setSearch] = useState("");
  const list = useListClassStudents(classId, { query: { queryKey: getListClassStudentsQueryKey(classId), enabled: classId > 0, staleTime: 60_000 } });
  const students = list.data ?? [];
  const s = search.trim().toLowerCase();
  const shown = students.filter((x) => !s || x.name.toLowerCase().includes(s) || x.studentId.toLowerCase().includes(s));
  const toggle = (id: number) => onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const nameOf = (id: number) => students.find((x) => x.id === id)?.name ?? "Student";
  return (
        <div className="mt-4 space-y-3">
          {picked.length > 0 && (
            <div className="flex flex-wrap gap-1.5" data-testid="audience-chosen">
              {picked.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--p-emerald))] py-0.5 pl-2.5 pr-1 text-xs font-semibold text-white">
                  {nameOf(id)}
                  <button type="button" className="grid h-4 w-4 place-items-center rounded-full hover:bg-white/20" onClick={() => toggle(id)} aria-label={`Remove ${nameOf(id)}`}><X size={10} /></button>
                </span>
              ))}
            </div>
          )}
          {!classId ? <p className="text-sm text-[hsl(var(--p-ink)/0.6)]">Choose the class above first (for example Year 8 Gold), then search for the student.</p> : (
            <>
              <label className="relative block"><span className="sr-only">Search students in {className}</span>
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--p-ink)/0.45)]" aria-hidden />
                <input className="portal-input !pl-9" placeholder={`Search a student's name or ID in ${className || "this class"}`} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-audience-search" />
              </label>
              {list.isLoading ? <p className="text-sm text-[hsl(var(--p-ink)/0.6)]">Loading students...</p>
                : list.isError ? <p className="text-sm text-[hsl(var(--p-red))]">The class list did not load. Try again.</p>
                  : !students.length ? <p className="text-sm text-[hsl(var(--p-ink)/0.6)]">No students are enrolled in {className} yet.</p>
                    : !shown.length ? <p className="text-sm text-[hsl(var(--p-ink)/0.6)]">No student in {className} matches "{search}".</p> : (
                      <ul className="grid max-h-60 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2" data-testid="audience-results">
                        {shown.map((x) => {
                          const on = picked.includes(x.id);
                          return (
                            <li key={x.id}>
                              <button type="button" aria-pressed={on} onClick={() => toggle(x.id)} className={"flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left text-sm transition " + (on ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald-soft)/0.6)]" : "border-[hsl(var(--p-line))] hover:bg-[hsl(var(--p-paper-2))]")} data-testid={`audience-student-${x.id}`}>
                                <Avatar name={x.name} size={30} hue="156 62% 30%" />
                                <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{x.name}</span><span className="block truncate font-mono text-[10px] text-[hsl(var(--p-ink)/0.5)]">{x.studentId}</span></span>
                                {on && <Check size={15} className="shrink-0 text-[hsl(var(--p-emerald))]" aria-hidden />}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
              <p className="text-xs text-[hsl(var(--p-ink)/0.6)]">{picked.length ? `Only ${picked.length === 1 ? nameOf(picked[0]) : `these ${picked.length} students`} will see this exam. The rest of ${className} will not.` : "Tick at least one student."}</p>
            </>
          )}
        </div>
  );
}
