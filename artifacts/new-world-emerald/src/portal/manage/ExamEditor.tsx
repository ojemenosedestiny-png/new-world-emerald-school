import { useRef, useState } from "react";
import { useImportPortalPdf, type PortalManagement, type PortalExam, type PortalExamQuestionsItem } from "@workspace/api-client-react";
import { AlertTriangle, ArrowDown, ArrowUp, FileText, Plus, Trash2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Field } from "../ui";
import { OPTION_LETTERS, errorMessage, fileUrl, fromLocalInput, newQuestionId, toLocalInput } from "../lib";
import { ClassSelect } from "./ClassSelect";
import { useCommand } from "./useCommand";

type Q = PortalExamQuestionsItem;
const MAX_PDF = 15 * 1024 * 1024;

export function blankExam(classId: number): PortalExam {
  const start = new Date(Date.now() + 86400000); start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 3 * 3600000);
  return { title: "", subject: "", classId, durationMinutes: 40, startsAt: start.toISOString(), endsAt: end.toISOString(), mode: "interactive", fileId: null, instructions: "", questions: [], published: false, resultsReleased: false };
}

export function validateExam(e: PortalExam, publishing: boolean): string[] {
  const errs: string[] = [];
  if (!e.title.trim()) errs.push("Add a title.");
  if (!e.subject.trim()) errs.push("Add a subject.");
  if (!e.classId) errs.push("Choose a class.");
  if (!(e.durationMinutes >= 1 && e.durationMinutes <= 300)) errs.push("Duration must be 1 to 300 minutes.");
  if (!e.startsAt || !e.endsAt || new Date(e.endsAt) <= new Date(e.startsAt)) errs.push("The window must end after it starts.");
  if (e.mode === "pdf" && !e.fileId) errs.push("PDF mode needs an uploaded exam paper.");
  if (e.questions.length === 0) errs.push("Add at least one question or answer slot.");
  e.questions.forEach((q, i) => {
    if (!q.text.trim()) errs.push("Question " + (i + 1) + " has no text.");
    if (!(q.marks >= 0.5 && q.marks <= 100)) errs.push("Question " + (i + 1) + " marks must be 0.5 to 100.");
    if (q.type === "mcq") {
      if (q.options.length < 2 || q.options.length > 8) errs.push("Question " + (i + 1) + " needs 2 to 8 options.");
      if (q.options.some((o) => !o.trim())) errs.push("Question " + (i + 1) + " has an empty option.");
      if (publishing && (q.correctAnswer == null || q.correctAnswer >= q.options.length)) errs.push("Question " + (i + 1) + " needs a confirmed answer key before publishing.");
    }
  });
  return errs;
}

function QuestionEditor({ q, i, count, onChange, onMove, onRemove }: { q: Q; i: number; count: number; onChange: (q: Q) => void; onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  const p = "q" + i;
  return (
    <div className="rounded-2xl border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface)/0.8)] p-4" data-testid={"editor-question-" + i}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-[hsl(var(--p-ink))] text-xs font-bold text-[hsl(var(--p-paper))]">{i + 1}</span>
        <select aria-label={"Question " + (i + 1) + " type"} className="portal-input !w-auto !py-1.5 text-sm" value={q.type} onChange={(e) => { const t = e.target.value as Q["type"]; onChange({ ...q, type: t, options: t === "mcq" ? (q.options.length >= 2 ? q.options : ["", "", "", ""]) : [], correctAnswer: null }); }} data-testid={"select-qtype-" + i}>
          <option value="mcq">Multiple choice</option><option value="written">Written</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm">Marks <input type="number" min={0.5} max={100} step={0.5} className="portal-input !w-20 !py-1.5" value={q.marks} onChange={(e) => onChange({ ...q, marks: Number(e.target.value) })} data-testid={"input-qmarks-" + i} /></label>
        <div className="ml-auto flex gap-1">
          <button type="button" className="portal-btn-ghost !px-2" disabled={i === 0} onClick={() => onMove(-1)} aria-label="Move up"><ArrowUp size={13} /></button>
          <button type="button" className="portal-btn-ghost !px-2" disabled={i === count - 1} onClick={() => onMove(1)} aria-label="Move down"><ArrowDown size={13} /></button>
          <button type="button" className="portal-btn-ghost !px-2 text-[hsl(var(--p-red))]" onClick={onRemove} aria-label={"Delete question " + (i + 1)} data-testid={"button-remove-q-" + i}><Trash2 size={13} /></button>
        </div>
      </div>
      <label htmlFor={p + "-text"} className="sr-only">Question text</label>
      <textarea id={p + "-text"} className="portal-input min-h-[70px] text-sm" maxLength={12000} placeholder="Question text, or a slot label such as Question 3" value={q.text} onChange={(e) => onChange({ ...q, text: e.target.value })} data-testid={"input-qtext-" + i} />
      {q.type === "mcq" ? (
        <div className="mt-3 space-y-2">
          <p className="portal-label">Options. Select the correct answer.</p>
          {q.options.map((o, oi) => (
            <div key={oi} className="flex items-center gap-2">
              <input type="radio" name={p + "-key"} aria-label={"Mark option " + OPTION_LETTERS[oi] + " correct"} checked={q.correctAnswer === oi} onChange={() => onChange({ ...q, correctAnswer: oi })} data-testid={"radio-key-" + i + "-" + oi} />
              <span className="w-5 text-sm font-bold">{OPTION_LETTERS[oi]}</span>
              <input className="portal-input !py-1.5 text-sm" aria-label={"Option " + OPTION_LETTERS[oi]} maxLength={3000} value={o} onChange={(e) => { const opts = [...q.options]; opts[oi] = e.target.value; onChange({ ...q, options: opts }); }} data-testid={"input-option-" + i + "-" + oi} />
              <button type="button" className="portal-btn-ghost !px-2" disabled={q.options.length <= 2} aria-label={"Remove option " + OPTION_LETTERS[oi]} onClick={() => { const opts = q.options.filter((_, x) => x !== oi); const k = q.correctAnswer; onChange({ ...q, options: opts, correctAnswer: k == null || k === oi ? null : k > oi ? k - 1 : k }); }}><Trash2 size={12} /></button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button type="button" className="portal-btn-ghost" disabled={q.options.length >= 8} onClick={() => onChange({ ...q, options: [...q.options, ""] })}><Plus size={12} /> Option</button>
            {q.correctAnswer == null ? <span className="text-xs font-semibold text-[hsl(var(--p-gold-ink))]">Answer key not set</span> : <span className="text-xs font-semibold text-[hsl(var(--p-emerald))]">Key: {OPTION_LETTERS[q.correctAnswer]}</span>}
          </div>
        </div>
      ) : (
        <div className="mt-3"><label htmlFor={p + "-rubric"} className="portal-label mb-1">Marking guide (staff only, optional)</label>
          <textarea id={p + "-rubric"} className="portal-input min-h-[56px] text-sm" maxLength={5000} value={q.rubric ?? ""} onChange={(e) => onChange({ ...q, rubric: e.target.value })} /></div>
      )}
    </div>
  );
}

export function ExamEditor({ data, initial, onClose }: { data: PortalManagement; initial: PortalExam; onClose: () => void }) {
  const cmd = useCommand();
  const { toast } = useToast();
  const upload = useImportPortalPdf();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exam, setExam] = useState<PortalExam>(initial);
  const [noKeyConfirmed, setNoKeyConfirmed] = useState(false);
  const [importNote, setImportNote] = useState<{ warning: string; extractedText: string; found: number } | null>(null);
  const [bulk, setBulk] = useState({ count: 10, marks: 1, type: "written" as Q["type"], options: 4 });
  const [showErrors, setShowErrors] = useState(false);
  const set = (patch: Partial<PortalExam>) => setExam((e) => ({ ...e, ...patch }));
  const setQ = (i: number, q: Q) => setExam((e) => ({ ...e, questions: e.questions.map((x, xi) => (xi === i ? q : x)) }));
  const errors = validateExam(exam, exam.published);
  const needsKeyConfirm = exam.published && !!exam.fileId && !noKeyConfirmed;
  const totalMarks = exam.questions.reduce((s, q) => s + (Number(q.marks) || 0), 0);

  const addQ = (type: Q["type"]) => setExam((e) => ({ ...e, questions: [...e.questions, { id: newQuestionId(), type, text: "", options: type === "mcq" ? ["", "", "", ""] : [], marks: 1, correctAnswer: null }] }));
  const move = (i: number, d: -1 | 1) => setExam((e) => { const qs = [...e.questions]; const [x] = qs.splice(i, 1); qs.splice(i + d, 0, x); return { ...e, questions: qs }; });
  const generate = () => {
    const start = exam.questions.length;
    const slots: Q[] = Array.from({ length: Math.min(200 - start, Math.max(1, bulk.count)) }, (_, k) => ({
      id: newQuestionId() + "-" + k, type: bulk.type, text: "Question " + (start + k + 1), marks: bulk.marks,
      options: bulk.type === "mcq" ? OPTION_LETTERS.slice(0, bulk.options) : [], correctAnswer: null,
    }));
    set({ questions: [...exam.questions, ...slots] });
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (f.type !== "application/pdf") { toast({ variant: "destructive", title: "PDF files only" }); return; }
    if (f.size > MAX_PDF) { toast({ variant: "destructive", title: "File too large", description: "The limit is 15 MB." }); return; }
    if (!exam.classId) { toast({ variant: "destructive", title: "Choose a class first" }); return; }
    upload.mutate({ data: f, params: { classId: exam.classId } }, {
      onSuccess: (r) => {
        setNoKeyConfirmed(false);
        setImportNote({ warning: r.warning, extractedText: r.extractedText, found: r.questions.length });
        setExam((e) => ({ ...e, fileId: r.fileId, questions: e.questions.length === 0 && r.questions.length ? r.questions.map((q) => ({ ...q, correctAnswer: null })) : e.questions }));
        toast({ title: "PDF uploaded", description: r.questions.length ? r.questions.length + " questions detected. Review every one." : "No questions detected. Add answer slots manually." });
      },
      onError: (e) => toast({ variant: "destructive", title: "Upload failed", description: errorMessage(e) }),
    });
  };

  const save = async () => {
    setShowErrors(true);
    if (errors.length || needsKeyConfirm) return;
    const payload = { ...exam, title: exam.title.trim(), subject: exam.subject.trim(), durationMinutes: Number(exam.durationMinutes) };
    if (await cmd.run({ action: "saveExam", exam: payload }, exam.id ? "Exam updated" : "Exam saved")) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-3xl overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">{exam.id ? "Edit exam" : "New exam"}</DialogTitle>
          <DialogDescription>Drafts can be incomplete. Publishing requires every multiple choice answer key.</DialogDescription></DialogHeader>
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" htmlFor="e-title"><input id="e-title" className="portal-input" maxLength={200} value={exam.title} onChange={(e) => set({ title: e.target.value })} data-testid="input-exam-title" /></Field>
            <Field label="Subject" htmlFor="e-subject"><input id="e-subject" className="portal-input" maxLength={100} value={exam.subject} onChange={(e) => set({ subject: e.target.value })} data-testid="input-exam-subject" /></Field>
            <Field label="Class" htmlFor="e-class" hint={exam.fileId ? "Class is fixed once a PDF is uploaded for it." : undefined}><ClassSelect id="e-class" classes={data.classes} value={exam.classId} disabled={!!exam.fileId} onChange={(v) => set({ classId: v })} /></Field>
            <Field label="Duration (minutes)" htmlFor="e-dur"><input id="e-dur" type="number" min={1} max={300} className="portal-input" value={exam.durationMinutes} onChange={(e) => set({ durationMinutes: Number(e.target.value) })} data-testid="input-exam-duration" /></Field>
            <Field label="Opens" htmlFor="e-start"><input id="e-start" type="datetime-local" className="portal-input" value={toLocalInput(exam.startsAt)} onChange={(e) => set({ startsAt: fromLocalInput(e.target.value) })} data-testid="input-exam-start" /></Field>
            <Field label="Closes" htmlFor="e-end"><input id="e-end" type="datetime-local" className="portal-input" value={toLocalInput(exam.endsAt)} onChange={(e) => set({ endsAt: fromLocalInput(e.target.value) })} data-testid="input-exam-end" /></Field>
          </div>
          <Field label="Instructions for students" htmlFor="e-ins"><textarea id="e-ins" className="portal-input min-h-[70px]" maxLength={5000} value={exam.instructions} onChange={(e) => set({ instructions: e.target.value })} data-testid="input-exam-instructions" /></Field>

          <fieldset className="rounded-2xl bg-[hsl(var(--p-paper-2)/0.7)] p-4">
            <legend className="portal-label px-1">Exam format</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" checked={exam.mode === "interactive"} onChange={() => set({ mode: "interactive" })} data-testid="radio-mode-interactive" /> Interactive questions on screen</label>
              <label className="flex items-center gap-2"><input type="radio" checked={exam.mode === "pdf"} onChange={() => set({ mode: "pdf" })} data-testid="radio-mode-pdf" /> Original PDF paper with answer slots</label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
              <button type="button" className="portal-btn-ghost" disabled={upload.isPending} onClick={() => fileRef.current?.click()} data-testid="button-upload-exam-pdf"><Upload size={13} /> {upload.isPending ? "Uploading and reading..." : exam.fileId ? "Replace PDF" : "Upload PDF (max 15 MB)"}</button>
              {exam.fileId && <a className="portal-btn-ghost" href={fileUrl(exam.fileId)} target="_blank" rel="noreferrer"><FileText size={13} /> View uploaded paper</a>}
              {exam.fileId && exam.mode === "interactive" && <button type="button" className="portal-btn-ghost" onClick={() => set({ fileId: null })}>Detach PDF</button>}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[hsl(var(--p-ink)/0.6)]">Text is read from numbered, typed PDFs with A to D choices. Scanned papers and complex layouts are not read automatically (there is no OCR): use PDF mode and create answer slots below. Correct answers are never guessed.</p>
            {importNote && (
              <div className="mt-3 rounded-xl border border-[hsl(var(--p-gold)/0.5)] bg-[hsl(var(--p-gold-soft)/0.6)] p-3 text-sm">
                <p className="font-semibold">{importNote.found} questions detected{importNote.found && exam.questions.length && importNote.found !== exam.questions.length ? " (existing questions kept)" : ""}</p>
                {importNote.warning && <p className="mt-1">{importNote.warning}</p>}
                {importNote.extractedText && <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold">Show extracted text</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-[hsl(var(--p-surface)/0.8)] p-2 text-xs">{importNote.extractedText}</pre></details>}
              </div>
            )}
          </fieldset>

          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="font-serif text-lg font-semibold">Questions <span className="text-sm font-normal text-[hsl(var(--p-ink)/0.55)]">{exam.questions.length} / {totalMarks} marks</span></p>
              <div className="flex gap-2"><button type="button" className="portal-btn-ghost" onClick={() => addQ("mcq")} data-testid="button-add-mcq"><Plus size={13} /> Multiple choice</button><button type="button" className="portal-btn-ghost" onClick={() => addQ("written")} data-testid="button-add-written"><Plus size={13} /> Written</button></div>
            </div>
            <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-[hsl(var(--p-line))] p-3 text-sm">
              <span className="w-full text-xs font-semibold text-[hsl(var(--p-ink)/0.6)]">Bulk create answer slots</span>
              <label className="flex items-center gap-1">Count <input type="number" min={1} max={200} className="portal-input !w-20 !py-1.5" value={bulk.count} onChange={(e) => setBulk({ ...bulk, count: Number(e.target.value) })} data-testid="input-bulk-count" /></label>
              <label className="flex items-center gap-1">Marks each <input type="number" min={0.5} max={100} step={0.5} className="portal-input !w-20 !py-1.5" value={bulk.marks} onChange={(e) => setBulk({ ...bulk, marks: Number(e.target.value) })} /></label>
              <select aria-label="Slot type" className="portal-input !w-auto !py-1.5" value={bulk.type} onChange={(e) => setBulk({ ...bulk, type: e.target.value as Q["type"] })}><option value="written">Written</option><option value="mcq">Multiple choice</option></select>
              {bulk.type === "mcq" && <label className="flex items-center gap-1">Options <input type="number" min={2} max={8} className="portal-input !w-16 !py-1.5" value={bulk.options} onChange={(e) => setBulk({ ...bulk, options: Math.min(8, Math.max(2, Number(e.target.value))) })} /></label>}
              <button type="button" className="portal-btn-ghost" onClick={generate} disabled={exam.questions.length >= 200} data-testid="button-bulk-generate">Generate</button>
            </div>
            <div className="space-y-3">{exam.questions.map((q, i) => <QuestionEditor key={q.id} q={q} i={i} count={exam.questions.length} onChange={(nq) => setQ(i, nq)} onMove={(d) => move(i, d)} onRemove={() => set({ questions: exam.questions.filter((_, x) => x !== i) })} />)}</div>
          </div>

          <div className="space-y-2 rounded-2xl bg-[hsl(var(--p-emerald-soft)/0.5)] p-4 text-sm">
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={exam.published} onChange={(e) => set({ published: e.target.checked })} data-testid="checkbox-exam-published" /> Publish to students in this class</label>
            {exam.published && exam.fileId && (
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={noKeyConfirmed} onChange={(e) => setNoKeyConfirmed(e.target.checked)} data-testid="checkbox-no-answer-key" /> I have checked the uploaded PDF and it does not contain an answer key or marking scheme.</label>
            )}
          </div>

          {showErrors && (errors.length > 0 || needsKeyConfirm) && (
            <div role="alert" className="rounded-xl border border-[hsl(var(--p-red)/0.3)] bg-[hsl(var(--p-red)/0.06)] p-3 text-sm">
              <p className="flex items-center gap-2 font-semibold"><AlertTriangle size={15} /> Fix before saving</p>
              <ul className="mt-1 list-disc pl-5">{errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}{needsKeyConfirm && <li>Confirm the PDF contains no answer key.</li>}</ul>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <button className="portal-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="portal-btn" onClick={save} disabled={cmd.pending || upload.isPending} data-testid="button-save-exam">{cmd.pending ? "Saving..." : exam.published ? "Save and publish" : "Save draft"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
