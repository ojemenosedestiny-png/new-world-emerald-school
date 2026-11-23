import { useState } from "react";
import type { PortalManagement, PortalManagementExamsItem } from "@workspace/api-client-react";
import { CalendarPlus, Trash2, UserCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime, fromLocalInput, toLocalInput } from "../lib";
import { className, useCommand } from "./useCommand";

/** Students of the exam's class who have not started it: the ones who can be given a make-up. */
export function missedStudents(data: PortalManagement, exam: PortalManagementExamsItem) {
  const started = new Set(data.attempts.filter((a) => a.examId === exam.id).map((a) => a.studentId));
  const only = exam.onlyStudentIds?.length ? new Set(exam.onlyStudentIds) : null;
  return data.students.filter((s) => s.classId === exam.classId && s.active && !started.has(s.studentId) && (!only || only.has(s.id as number))).sort((a, b) => a.name.localeCompare(b.name));
}

function defaultWindow(minutes: number) {
  const start = new Date(Date.now() + 3_600_000); start.setMinutes(0, 0, 0);
  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + (minutes + 30) * 60_000).toISOString() };
}

/**
 * A make-up sitting for students who missed an exam: their own window to write it. Only they see the exam in that
 * window; the class's window and everyone else's results are unchanged.
 */
export function MakeupDialog({ data, exam, preselect = [], onClose }: { data: PortalManagement; exam: PortalManagementExamsItem; preselect?: number[]; onClose: () => void }) {
  const cmd = useCommand();
  const missed = missedStudents(data, exam);
  const makeups = (data.makeups ?? []).filter((m) => m.examId === exam.id);
  const [chosen, setChosen] = useState<number[]>(preselect);
  const [win, setWin] = useState(() => defaultWindow(exam.durationMinutes));
  const length = (new Date(win.endsAt).getTime() - new Date(win.startsAt).getTime()) / 60_000;
  const problem = !chosen.length ? "Tick at least one student."
    : !(length > 0) ? "The make-up must end after it starts."
      : length < exam.durationMinutes ? `Give at least the exam's ${exam.durationMinutes} minutes.`
        : new Date(win.endsAt).getTime() <= Date.now() ? "The make-up must end in the future." : "";
  const nameOf = (id: number) => data.students.find((s) => s.id === id)?.name ?? "Student";
  const toggle = (id: number) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const save = async () => {
    if (problem) return;
    if (await cmd.run({ action: "setMakeup", makeup: { examId: exam.id as number, studentIds: chosen, startsAt: win.startsAt, endsAt: win.endsAt } }, "Make-up set")) onClose();
  };
  const remove = (studentId: number) => void cmd.run({ action: "removeMakeup", makeup: { examId: exam.id as number, studentIds: [studentId] } }, "Make-up removed");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-2xl overflow-y-auto rounded-2xl" data-testid="makeup-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-2xl"><CalendarPlus size={22} className="text-[hsl(var(--p-emerald))]" aria-hidden /> Make-up exam</DialogTitle>
          <DialogDescription>{exam.title} / {className(data.examClasses?.length ? data.examClasses : data.classes, exam.classId)} / {exam.subject}. A student who missed it writes the same paper in their own window. Nobody else sees it again.</DialogDescription>
        </DialogHeader>

        {makeups.length > 0 && (
          <section className="rounded-2xl border border-[hsl(var(--p-gold)/0.4)] bg-[hsl(var(--p-gold-soft)/0.5)] p-3" data-testid="list-makeups">
            <p className="mb-2 text-sm font-semibold">Make-ups already set</p>
            <ul className="space-y-1.5">{makeups.map((m) => (
              <li key={m.studentId} className="flex flex-wrap items-center gap-2 text-sm" data-testid={`makeup-${m.studentId}`}>
                <span className="font-semibold">{nameOf(m.studentId)}</span>
                <span className="text-xs text-[hsl(var(--p-ink)/0.65)]">{formatDateTime(m.startsAt)} to {formatDateTime(m.endsAt)}</span>
                <button type="button" className="portal-btn-ghost ml-auto !px-2 !py-1 text-xs text-[hsl(var(--p-red))]" disabled={cmd.pending} onClick={() => remove(m.studentId)} data-testid={`button-remove-makeup-${m.studentId}`}><Trash2 size={12} /> Remove</button>
              </li>
            ))}</ul>
          </section>
        )}

        {!exam.published ? <p className="rounded-xl bg-[hsl(var(--p-paper-2))] p-3 text-sm">Publish the exam first. A make-up uses the published paper.</p> : (
          <>
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Who missed it? <span className="font-normal text-[hsl(var(--p-ink)/0.6)]">({missed.length} have not written it)</span></p>
                {missed.length > 1 && <button type="button" className="portal-btn-ghost !py-1 text-xs" onClick={() => setChosen(chosen.length === missed.length ? [] : missed.map((s) => s.id as number))} data-testid="button-makeup-all">{chosen.length === missed.length ? "Untick all" : "Tick all"}</button>}
              </div>
              {!missed.length ? <p className="rounded-xl bg-[hsl(var(--p-paper-2))] p-3 text-sm">Every student in this class has written it.</p> : (
                <div className="grid max-h-64 gap-1.5 overflow-y-auto sm:grid-cols-2">{missed.map((s) => {
                  const on = chosen.includes(s.id as number);
                  return (
                    <label key={s.id} className={"flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition " + (on ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald-soft)/0.6)]" : "border-[hsl(var(--p-line))]")}>
                      <input type="checkbox" checked={on} onChange={() => toggle(s.id as number)} data-testid={`checkbox-makeup-${s.id}`} />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      {makeups.some((m) => m.studentId === s.id) && <span className="text-[10px] font-bold uppercase text-[hsl(var(--p-gold-ink))]">Set</span>}
                    </label>
                  );
                })}</div>
              )}
            </section>
            <section className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold">Opens<input type="datetime-local" className="portal-input mt-1" value={toLocalInput(win.startsAt)} onChange={(e) => setWin({ ...win, startsAt: fromLocalInput(e.target.value) })} data-testid="input-makeup-start" /></label>
              <label className="text-sm font-semibold">Closes<input type="datetime-local" className="portal-input mt-1" value={toLocalInput(win.endsAt)} onChange={(e) => setWin({ ...win, endsAt: fromLocalInput(e.target.value) })} data-testid="input-makeup-end" /></label>
              <p className="text-xs text-[hsl(var(--p-ink)/0.6)] sm:col-span-2">The student has {exam.durationMinutes} minutes once they start, inside this window. If the class sees the right answers after the exam, they wait until every make-up has closed.</p>
            </section>
          </>
        )}
        <DialogFooter className="items-center gap-3">
          {exam.published && problem && chosen.length > 0 && <span className="text-xs text-[hsl(var(--p-red))]" data-testid="text-makeup-problem">{problem}</span>}
          <button type="button" className="portal-btn-ghost" onClick={onClose}>Close</button>
          {exam.published && <button type="button" className="portal-btn" disabled={cmd.pending || !!problem} onClick={() => void save()} data-testid="button-save-makeup"><UserCheck size={14} /> {chosen.length > 1 ? `Give ${chosen.length} students a make-up` : "Give make-up"}</button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
