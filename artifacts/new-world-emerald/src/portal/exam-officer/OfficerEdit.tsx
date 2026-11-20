import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetExamOfficerActivityQueryKey, getGetExamOfficerExamQueryKey, getGetExamOfficerOverviewQueryKey, useEditExamOfficerExam,
  type ExamOfficerPaper, type PortalExamQuestionsItem,
} from "@workspace/api-client-react";
import { AlertTriangle, CalendarClock, Lock, Plus, Save, Send } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Field } from "../ui";
import { errorMessage, fromLocalInput, newQuestionId, toLocalInput } from "../lib";
import { QuestionEditor, validateExam } from "../manage/ExamEditor";
import { QuestionSheetImport } from "../manage/QuestionSheetImport";

type Q = PortalExamQuestionsItem;

/**
 * The exam officer or the Head of School changes a teacher's exam: its title, instructions, length, opening and
 * closing times and every question, then saves it or saves and publishes it to students in one step.
 */
export function OfficerEditDialog({ paper, onClose }: { paper: ExamOfficerPaper; onClose: () => void }) {
  const e = paper.exam;
  const qc = useQueryClient();
  const { toast } = useToast();
  const save = useEditExamOfficerExam();
  const locked = paper.locked === true;
  const published = ["scheduled", "open", "closed", "released"].includes(e.status);
  const [title, setTitle] = useState(e.title);
  const [instructions, setInstructions] = useState(paper.instructions);
  const [duration, setDuration] = useState(e.durationMinutes);
  const [startsAt, setStartsAt] = useState(e.startsAt);
  const [endsAt, setEndsAt] = useState(e.endsAt);
  const [questions, setQuestions] = useState<Q[]>(() => (paper.editQuestions ?? []).map((q) => ({ ...q })));
  const [notes, setNotes] = useState<Record<string, string[]>>({});
  const [showErrors, setShowErrors] = useState(false);

  const draft = {
    title, subject: e.subject, classId: e.classId, durationMinutes: duration, startsAt, endsAt, instructions, questions,
    mode: e.mode === "pdf" ? "pdf" as const : "interactive" as const, fileId: e.mode === "pdf" ? "kept" : null, published: false, resultsReleased: false,
  };
  const errorsFor = (publishing: boolean) => validateExam({ ...draft, published: publishing }, publishing);
  const closingPassed = !!endsAt && new Date(endsAt) <= new Date();
  const total = questions.reduce((s, q) => s + (Number(q.marks) || 0), 0);
  const setQ = (i: number, q: Q) => setQuestions((qs) => qs.map((x, k) => (k === i ? q : x)));
  const move = (i: number, d: -1 | 1) => setQuestions((qs) => { const c = [...qs]; const [x] = c.splice(i, 1); c.splice(i + d, 0, x); return c; });
  const add = (type: Q["type"]) => setQuestions((qs) => [...qs, { id: newQuestionId(), type, text: "", options: type === "mcq" ? ["", "", "", ""] : [], marks: 1, correctAnswer: null }]);

  const submit = async (publish: boolean) => {
    setShowErrors(true);
    if (errorsFor(publish || published).length) return;
    const clean = questions.map(({ passage, ...q }) => (passage?.trim() ? { ...q, passage } : q));
    try {
      const r = await save.mutateAsync({ examId: e.id, data: { title: title.trim(), instructions, durationMinutes: Number(duration), startsAt, endsAt, questions: clean, ...(publish ? { publish: true } : {}) } });
      toast({ title: r.message });
      await Promise.all([qc.invalidateQueries({ queryKey: getGetExamOfficerOverviewQueryKey() }), qc.invalidateQueries({ queryKey: getGetExamOfficerExamQueryKey(e.id) }), qc.invalidateQueries({ queryKey: getGetExamOfficerActivityQueryKey() })]);
      onClose();
    } catch (err) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(err) }); }
  };
  const errors = errorsFor(published);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-3xl overflow-y-auto rounded-2xl" data-testid="officer-edit-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Edit exam</DialogTitle>
          <DialogDescription>{e.subject} · {e.className}{e.setBy ? ` · set by ${e.setBy}` : ""}. Your changes are saved in the exam's history.{(e.linkedClasses ?? []).length > 0 ? ` They also reach ${(e.linkedClasses ?? []).join(", ")}, which sit the same paper.` : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <section className="rounded-2xl border border-[hsl(var(--p-line))] p-4" aria-labelledby="officer-when">
            <h3 id="officer-when" className="mb-3 flex items-center gap-2 font-serif text-lg font-semibold"><CalendarClock size={17} className="text-[hsl(var(--p-emerald))]" aria-hidden /> Date and time</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" htmlFor="o-title"><input id="o-title" className="portal-input" maxLength={200} value={title} onChange={(x) => setTitle(x.target.value)} data-testid="input-officer-title" /></Field>
              <Field label="Duration (minutes)" htmlFor="o-dur"><input id="o-dur" type="number" min={1} max={300} className="portal-input" value={duration} onChange={(x) => setDuration(Number(x.target.value))} data-testid="input-officer-duration" /></Field>
              <Field label="Opens" htmlFor="o-start"><input id="o-start" type="datetime-local" className="portal-input" value={toLocalInput(startsAt)} onChange={(x) => setStartsAt(fromLocalInput(x.target.value))} data-testid="input-officer-start" /></Field>
              <Field label="Closes" htmlFor="o-end"><input id="o-end" type="datetime-local" className="portal-input" value={toLocalInput(endsAt)} onChange={(x) => setEndsAt(fromLocalInput(x.target.value))} data-testid="input-officer-end" /></Field>
            </div>
            {closingPassed && <p className="mt-2 text-xs font-semibold text-[hsl(var(--p-gold-ink))]">The closing time has passed. Set a later one before publishing.</p>}
            <div className="mt-4"><Field label="Instructions for students" htmlFor="o-ins"><textarea id="o-ins" className="portal-input min-h-[70px]" maxLength={5000} value={instructions} onChange={(x) => setInstructions(x.target.value)} data-testid="input-officer-instructions" /></Field></div>
          </section>

          <section aria-labelledby="officer-questions">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 id="officer-questions" className="font-serif text-lg font-semibold">Questions <span className="text-sm font-normal text-[hsl(var(--p-ink)/0.55)]">{questions.length} / {total} marks</span></h3>
              {!locked && <div className="flex gap-2"><button type="button" className="portal-btn-ghost" onClick={() => add("mcq")} data-testid="button-officer-add-mcq"><Plus size={13} /> Multiple choice</button><button type="button" className="portal-btn-ghost" onClick={() => add("written")}><Plus size={13} /> Written</button></div>}
            </div>
            {locked ? (
              <p className="flex items-start gap-2 rounded-xl bg-[hsl(var(--p-paper-2)/0.8)] p-3 text-sm" data-testid="text-officer-locked"><Lock size={15} className="mt-0.5 shrink-0" aria-hidden /> Students have started this exam, so its questions are locked to keep marking fair. You can still change the title, instructions, length and times.</p>
            ) : (
              <>
                <QuestionSheetImport existing={questions.length} onImport={(qs, byId) => { setQuestions((x) => [...x, ...qs].slice(0, 200)); setNotes((n) => ({ ...n, ...byId })); }} />
                <div className="space-y-3">
                  {questions.map((q, i) => (
                    <QuestionEditor key={q.id} q={q} i={i} count={questions.length} classId={e.classId} notes={notes[q.id]} onChange={(nq) => setQ(i, nq)} onMove={(d) => move(i, d)} onRemove={() => setQuestions((qs) => qs.filter((_, k) => k !== i))} />
                  ))}
                </div>
              </>
            )}
          </section>

          {showErrors && errors.length > 0 && (
            <div role="alert" className="rounded-xl border border-[hsl(var(--p-red)/0.3)] bg-[hsl(var(--p-red)/0.06)] p-3 text-sm" data-testid="officer-edit-errors">
              <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={15} aria-hidden /> Fix before saving</p>
              <ul className="mt-1 list-disc pl-5">{errors.slice(0, 8).map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <button type="button" className="portal-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className={published ? "portal-btn" : "portal-btn-ghost"} disabled={save.isPending} onClick={() => void submit(false)} data-testid="button-officer-save"><Save size={14} aria-hidden /> {save.isPending ? "Saving..." : published ? "Save changes" : "Save without publishing"}</button>
          {!published && <button type="button" className="portal-btn" disabled={save.isPending || closingPassed} onClick={() => void submit(true)} data-testid="button-officer-save-publish"><Send size={14} aria-hidden /> Save and publish</button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
