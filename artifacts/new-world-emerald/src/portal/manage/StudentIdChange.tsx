import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetPortalManagementQueryKey, useApplyStudentIdChange, usePreviewStudentIdChange,
  type PortalManagement, type StudentIdPlan, type StudentIdPlanRow,
} from "@workspace/api-client-react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { StatusPill } from "../ui";
import { errorMessage } from "../lib";

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
const STATUS: Record<StudentIdPlanRow["status"], { label: string; tone: "green" | "gold" | "ink" | "red" | "muted" }> = {
  match: { label: "Matched", tone: "green" }, close: { label: "Check name", tone: "gold" }, already: { label: "Already done", tone: "muted" },
  unmatched: { label: "Choose student", tone: "red" }, ambiguous: { label: "Choose student", tone: "red" }, taken: { label: "Number in use", tone: "red" }, problem: { label: "Problem", tone: "red" },
};

/**
 * Moves students to the school's admission numbers (NW/SEC/26/00001): paste the list, check how each line was paired
 * with a student, choose students for lines that did not pair, then apply.
 */
export function StudentIdChangeDialog({ open, onClose, data }: { open: boolean; onClose: () => void; data: PortalManagement }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const preview = usePreviewStudentIdChange();
  const apply = useApplyStudentIdChange();
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<StudentIdPlan | null>(null);
  // Line number -> chosen student id (0 = leave out). Matched lines start chosen; "Check name" lines too.
  const [picks, setPicks] = useState<Record<number, number>>({});
  const [showMissing, setShowMissing] = useState(false);
  const className = useMemo(() => new Map(data.classes.map((c) => [c.id, c.name])), [data.classes]);
  const students = useMemo(() => [...data.students].sort((a, b) => a.name.localeCompare(b.name)), [data.students]);

  const reset = () => { setPlan(null); setPicks({}); setShowMissing(false); };
  const close = () => { reset(); setText(""); onClose(); };
  const check = async () => {
    try {
      const p = await preview.mutateAsync({ data: { text } });
      setPlan(p);
      setPicks(Object.fromEntries(p.rows.filter((r) => (r.status === "match" || r.status === "close") && r.student).map((r) => [r.line, r.student!.id])));
    } catch (e) { toast({ variant: "destructive", title: "List not read", description: errorMessage(e) }); }
  };

  const chosen = plan ? plan.rows.filter((r) => picks[r.line]).map((r) => ({ id: picks[r.line], newId: r.newId, line: r.line })) : [];
  const usedTwice = useMemo(() => {
    const seen = new Map<number, number>(); const twice = new Set<number>();
    for (const c of chosen) { if (seen.has(c.id)) { twice.add(c.id); } seen.set(c.id, c.line); }
    return twice;
  }, [chosen]);
  const counts = plan ? {
    ready: chosen.length, already: plan.rows.filter((r) => r.status === "already").length,
    open: plan.rows.filter((r) => !picks[r.line] && r.status !== "already").length,
  } : null;
  const go = async () => {
    if (!chosen.length || usedTwice.size) return;
    if (!window.confirm(`Give ${chosen.length} students their new admission numbers? They sign in with the new number from now on (their passwords stay the same). The old IDs stop working.`)) return;
    try {
      const r = await apply.mutateAsync({ data: { changes: chosen.map(({ id, newId }) => ({ id, newId })) } });
      toast({ title: "Student IDs changed", description: r.message });
      await qc.invalidateQueries({ queryKey: getGetPortalManagementQueryKey() });
      close();
    } catch (e) { toast({ variant: "destructive", title: "Not changed", description: errorMessage(e) }); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-4xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Change to admission numbers</DialogTitle>
          <DialogDescription>Students will sign in with their admission number, like NW/SEC/26/00001 or NW/PRY/26/00001. Passwords, results, fees and everything else stay with each student.</DialogDescription>
        </DialogHeader>

        {!plan ? (
          <div className="space-y-3">
            <label className="block text-sm font-semibold" htmlFor="id-list">Paste the enrollment list
              <span className={"block font-normal " + MUTED}>Copy the columns from Excel (admission number and name), one student per line. Header lines are ignored.</span>
            </label>
            <textarea id="id-list" className="portal-input min-h-[220px] font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={"NW/SEC/26/00001\tAbdulkarim Salami\nNW/SEC/26/00002\tAnnabel Igwe\nNW/PRY/26/00001\tChimamanda Chinedu"} data-testid="input-id-list" />
            <div className="flex justify-end">
              <button type="button" className="portal-btn" disabled={!text.trim() || preview.isPending} onClick={() => void check()} data-testid="button-check-id-list">
                {preview.isPending ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />} Check the list
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3" data-testid="id-change-summary">
              <div className="rounded-xl bg-[hsl(var(--p-emerald)/0.08)] p-3"><p className={"text-xs " + MUTED}>Ready to change</p><p className="font-serif text-2xl font-semibold" data-testid="text-id-ready">{counts!.ready}</p></div>
              <div className="rounded-xl bg-[hsl(var(--p-ink)/0.05)] p-3"><p className={"text-xs " + MUTED}>Already have their number</p><p className="font-serif text-2xl font-semibold">{counts!.already}</p></div>
              <div className="rounded-xl bg-[hsl(var(--p-gold-soft))] p-3"><p className={"text-xs " + MUTED}>Left out (choose a student to include)</p><p className="font-serif text-2xl font-semibold" data-testid="text-id-open">{counts!.open}</p></div>
            </div>
            {usedTwice.size > 0 && <p className="rounded-xl bg-[hsl(var(--p-red)/0.1)] p-3 text-sm font-semibold text-[hsl(var(--p-red))]">The same student is chosen on two lines. Fix the lines marked in red.</p>}

            <div className="max-h-[45dvh] overflow-y-auto rounded-xl border border-[hsl(var(--p-line))]">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-[hsl(var(--p-surface,0_0%_100%))] text-xs uppercase tracking-wide"><tr><th className="p-2">New number</th><th className="p-2">Name on list</th><th className="p-2">Student in the portal</th></tr></thead>
                <tbody className="divide-y divide-[hsl(var(--p-line))]">
                  {plan.rows.map((r) => {
                    const pick = picks[r.line] ?? 0;
                    const clash = pick && usedTwice.has(pick);
                    return (
                      <tr key={r.line} className={clash ? "bg-[hsl(var(--p-red)/0.08)]" : ""} data-testid={`id-row-${r.line}`}>
                        <td className="whitespace-nowrap p-2 font-mono text-xs">{r.newId}</td>
                        <td className="p-2">{r.name || <span className={MUTED}>(no name)</span>}<div className="mt-0.5"><StatusPill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusPill></div></td>
                        <td className="p-2">
                          {r.status === "already" || r.status === "problem" || r.status === "taken" ? (
                            <span className={"text-xs " + MUTED}>{r.message}</span>
                          ) : (
                            <>
                              <select className="portal-input !py-1.5 text-xs" value={pick} onChange={(e) => setPicks({ ...picks, [r.line]: Number(e.target.value) })} aria-label={`Student for ${r.newId}`} data-testid={`select-id-student-${r.line}`}>
                                <option value={0}>Leave out</option>
                                {students.map((s) => <option key={s.id} value={s.id}>{s.name} · {className.get(s.classId) ?? ""} · {s.studentId}</option>)}
                              </select>
                              {r.message && <p className={"mt-0.5 text-xs " + MUTED}>{r.message}</p>}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {plan.notInList.length > 0 && (
              <div className="text-sm">
                <button type="button" className="font-semibold text-[hsl(var(--p-emerald))] underline-offset-2 hover:underline" onClick={() => setShowMissing(!showMissing)} data-testid="button-show-not-in-list">
                  {plan.notInList.length} active {plan.notInList.length === 1 ? "student is" : "students are"} in the portal but not on this list {showMissing ? "(hide)" : "(show)"}
                </button>
                {showMissing && <ul className={"mt-2 max-h-40 list-disc overflow-y-auto pl-5 text-xs " + MUTED}>{plan.notInList.map((s) => <li key={s.id}>{s.name} · {s.className} · <span className="font-mono">{s.studentId}</span></li>)}</ul>}
                <p className={"mt-1 text-xs " + MUTED}>They keep their current ID. Add them to the list, or choose them on a line above.</p>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="portal-btn-ghost" onClick={reset} data-testid="button-id-list-back">Back to the list</button>
              <button type="button" className="portal-btn" disabled={!chosen.length || usedTwice.size > 0 || apply.isPending} onClick={() => void go()} data-testid="button-apply-ids">
                {apply.isPending && <Loader2 size={15} className="animate-spin" />} Change {chosen.length} student {chosen.length === 1 ? "ID" : "IDs"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
