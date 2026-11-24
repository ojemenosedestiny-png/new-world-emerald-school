import { useMemo, useState } from "react";
import type { PortalManagement, PortalManagementAttemptsItem } from "@workspace/api-client-react";
import { BookOpen, CalendarPlus, CheckSquare, Folder, FolderOpen, Library } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, StatusPill } from "../ui";
import { OPTION_LETTERS, examFolder, fileUrl, formatDateTime } from "../lib";
import { className, useCommand } from "./useCommand";
import { MakeupDialog, missedStudents } from "./MakeupDialog";

type MarkRow = { questionId: string; score: string; feedback: string };

function GradeDialog({ attempt, onClose }: { attempt: PortalManagementAttemptsItem; onClose: () => void }) {
  const cmd = useCommand();
  const existing = new Map((attempt.marks ?? []).map((m) => [m.questionId, m]));
  const [rows, setRows] = useState<MarkRow[]>(() => attempt.questionKeys.map((q) => {
    const m = existing.get(q.id);
    if (m) return { questionId: q.id, score: String(m.score), feedback: m.feedback };
    const ans = attempt.answers[q.id];
    const auto = q.type === "mcq" && q.correctAnswer != null && ans !== undefined && ans !== "" ? (Number(ans) === q.correctAnswer ? q.marks : 0) : "";
    return { questionId: q.id, score: String(auto), feedback: "" };
  }));
  const invalid = rows.some((r, i) => r.score === "" || Number.isNaN(Number(r.score)) || Number(r.score) < 0 || Number(r.score) > attempt.questionKeys[i].marks);
  const total = rows.reduce((s, r) => s + (Number(r.score) || 0), 0);
  const save = async () => {
    if (invalid) return;
    if (await cmd.run({ action: "grade", grade: { attemptId: attempt.id, marks: rows.filter((r) => attempt.questionKeys.find((q) => q.id === r.questionId)?.type === "written").map((r) => ({ questionId: r.questionId, score: Number(r.score), feedback: r.feedback })) } }, "Marks saved")) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-3xl overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">{attempt.studentName}</DialogTitle>
          <DialogDescription>{attempt.title} / {attempt.studentId} / submitted answers{attempt.focusLosses ? ` / left the exam screen ${attempt.focusLosses} ${attempt.focusLosses === 1 ? "time" : "times"}` : ""}</DialogDescription></DialogHeader>
        {attempt.fileId && <a className="portal-btn-ghost w-fit" href={fileUrl(attempt.fileId)} target="_blank" rel="noreferrer">Open exam paper</a>}
        <div className="space-y-3">{attempt.questionKeys.map((q, i) => {
          const ans = attempt.answers[q.id] ?? "";
          const r = rows[i];
          return (
            <div key={q.id} className="rounded-2xl border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface)/0.8)] p-4" data-testid={"grade-q-" + q.id}>
              <p className="text-sm font-semibold"><span className="mr-2 text-[hsl(var(--p-ink)/0.45)]">{i + 1}.</span>{q.text}</p>
              {q.type === "mcq" ? (
                <p className="mt-2 text-sm">Answer: <b>{ans === "" ? "No answer" : OPTION_LETTERS[Number(ans)] + ". " + (q.options[Number(ans)] ?? "")}</b> / Key: <b>{q.correctAnswer == null ? "not set" : OPTION_LETTERS[q.correctAnswer]}</b></p>
              ) : (
                <div className="mt-2 whitespace-pre-wrap rounded-xl bg-[hsl(var(--p-paper-2)/0.6)] p-3 text-sm">{ans || <span className="italic opacity-60">No answer</span>}</div>
              )}
              {q.rubric && <p className="mt-2 text-xs text-[hsl(var(--p-ink)/0.6)]">Guide: {q.rubric}</p>}
              <div className="mt-3 grid gap-2 sm:grid-cols-[120px_1fr]">
                <label className="text-xs font-semibold">{q.type === "mcq" ? "Automatic score" : "Score"} / {q.marks}<input type="number" min={0} max={q.marks} step={0.5} readOnly={q.type === "mcq"} className="portal-input mt-1 !py-1.5" value={r.score} onChange={(e) => setRows(rows.map((x, xi) => xi === i ? { ...x, score: e.target.value } : x))} data-testid={"input-score-" + q.id} /></label>
                <label className="text-xs font-semibold">Feedback<input className="portal-input mt-1 !py-1.5" maxLength={3000} disabled={q.type === "mcq"} value={r.feedback} onChange={(e) => setRows(rows.map((x, xi) => xi === i ? { ...x, feedback: e.target.value } : x))} data-testid={"input-feedback-" + q.id} /></label>
              </div>
            </div>
          );
        })}</div>
        <DialogFooter className="items-center gap-3">
          <span className="text-sm font-semibold">Total {total} / {attempt.totalMarks}</span>
          {invalid && <span className="text-xs text-[hsl(var(--p-red))]">Every score must be between 0 and the question's marks.</span>}
          <button className="portal-btn" onClick={save} disabled={cmd.pending || invalid} data-testid="button-save-grade">{cmd.pending ? "Saving..." : "Save marks"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Attempt = PortalManagementAttemptsItem;
const pct = (a: Attempt) => (a.status === "marked" && typeof a.score === "number" && a.totalMarks > 0 ? Math.round((a.score / a.totalMarks) * 100) : null);

/**
 * Marking, filed like the school: a folder for each year (Year 1, JSS 1...), the year's classes (Amber, A, B, C),
 * then each subject and its exams, with every student's script and score in one place.
 */
export function MarkingPanel({ data }: { data: PortalManagement }) {
  const [open, setOpen] = useState<number | null>(null);
  const [show, setShow] = useState<"todo" | "all">("todo");
  const [folderKey, setFolderKey] = useState("all");
  const [classPick, setClassPick] = useState<number | null>(null);
  const [makeupFor, setMakeupFor] = useState<number | null>(null);
  const classes = data.examClasses?.length ? data.examClasses : data.classes;
  const nameOf = (id: number) => className(classes, id);
  const submitted = data.attempts.filter((a) => a.status !== "in_progress");
  const list = submitted.filter((a) => show === "all" || a.status === "submitted");
  const current = data.attempts.find((a) => a.id === open);
  const makeupExam = data.exams.find((e) => e.id === makeupFor);

  const folders = useMemo(() => {
    const map = new Map<string, { key: string; label: string; rank: number; attempts: Attempt[]; toMark: number; classIds: Set<number> }>();
    for (const a of submitted) {
      const f = examFolder(nameOf(a.classId));
      const entry = map.get(f.key) ?? { ...f, attempts: [], toMark: 0, classIds: new Set<number>() };
      entry.attempts.push(a); entry.classIds.add(a.classId);
      if (a.status === "submitted") entry.toMark++;
      map.set(f.key, entry);
    }
    return [...map.values()].sort((x, y) => x.rank - y.rank || x.label.localeCompare(y.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.attempts, classes]);
  const folder = folders.find((f) => f.key === folderKey) ?? null;
  const arms = folder ? [...folder.classIds].sort((x, y) => nameOf(x).localeCompare(nameOf(y), undefined, { numeric: true })) : [];
  const pickedClass = classPick !== null && arms.includes(classPick) ? classPick : null;
  const visible = list.filter((a) => (!folder || examFolder(nameOf(a.classId)).key === folder.key) && (pickedClass === null || a.classId === pickedClass));

  // Year, then subject, then exam (newest first), each exam's scripts by student name.
  const years = new Map<string, { label: string; rank: number; subjects: Map<string, Map<number, Attempt[]>> }>();
  for (const a of visible) {
    const f = examFolder(nameOf(a.classId));
    const y = years.get(f.key) ?? { label: f.label, rank: f.rank, subjects: new Map() };
    const subject = a.subject || "Other";
    const exams = y.subjects.get(subject) ?? new Map<number, Attempt[]>();
    exams.set(a.examId, [...(exams.get(a.examId) ?? []), a]);
    y.subjects.set(subject, exams);
    years.set(f.key, y);
  }
  const ordered = [...years.entries()].sort((x, y) => x[1].rank - y[1].rank);
  const examOf = (id: number) => data.exams.find((e) => e.id === id);
  const tile = (active: boolean) => "flex min-h-[96px] flex-col rounded-2xl border p-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--p-emerald))] "
    + (active ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald))] text-[hsl(var(--p-paper))] shadow-md" : "border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface))] hover:border-[hsl(var(--p-emerald)/0.5)]");
  const toMarkAll = submitted.filter((a) => a.status === "submitted").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <button className={"portal-tab " + (show === "todo" ? "!bg-[hsl(var(--p-ink))] !text-[hsl(var(--p-paper))]" : "")} onClick={() => setShow("todo")} data-testid="button-filter-todo">Awaiting marking{toMarkAll ? ` (${toMarkAll})` : ""}</button>
        <button className={"portal-tab " + (show === "all" ? "!bg-[hsl(var(--p-ink))] !text-[hsl(var(--p-paper))]" : "")} onClick={() => setShow("all")} data-testid="button-filter-all">All submitted and scores</button>
      </div>

      {folders.length > 0 && (
        <nav aria-label="Marking by year" className="rounded-3xl border border-[hsl(var(--p-line))] bg-[hsl(var(--p-paper-2)/0.5)] p-4" data-testid="marking-folders">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            <button type="button" aria-pressed={!folder} className={tile(!folder)} onClick={() => { setFolderKey("all"); setClassPick(null); }} data-testid="marking-folder-all">
              <Library size={18} aria-hidden className={folder ? "text-[hsl(var(--p-emerald))]" : ""} />
              <span className="mt-1.5 font-serif text-lg font-semibold leading-tight">All years</span>
              <span className={"mt-auto text-xs " + (!folder ? "text-[hsl(var(--p-paper)/0.8)]" : "text-[hsl(var(--p-ink)/0.6)]")}>{submitted.length} scripts{toMarkAll ? ` · ${toMarkAll} to mark` : ""}</span>
            </button>
            {folders.map((f) => {
              const active = folder?.key === f.key;
              const Icon = active ? FolderOpen : Folder;
              return (
                <button key={f.key} type="button" aria-pressed={active} className={tile(active)} onClick={() => { setFolderKey(f.key); setClassPick(null); }} data-testid={"marking-folder-" + f.key}>
                  <span className="flex items-start justify-between gap-2"><Icon size={18} aria-hidden className={active ? "" : "text-[hsl(var(--p-gold))]"} />
                    {f.toMark > 0 && <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold " + (active ? "bg-[hsl(var(--p-paper)/0.2)]" : "bg-[hsl(var(--p-gold-soft))] text-[hsl(var(--p-gold-ink))]")}>{f.toMark} to mark</span>}</span>
                  <span className="mt-1.5 font-serif text-lg font-semibold leading-tight">{f.label}</span>
                  <span className={"mt-auto text-xs " + (active ? "text-[hsl(var(--p-paper)/0.8)]" : "text-[hsl(var(--p-ink)/0.6)]")}>{f.attempts.length} scripts · {f.classIds.size} {f.classIds.size === 1 ? "class" : "classes"}</span>
                </button>
              );
            })}
          </div>
          {folder && arms.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[hsl(var(--p-line))] pt-3" role="group" aria-label={`${folder.label} classes`}>
              <span className="mr-1 text-xs font-semibold text-[hsl(var(--p-ink)/0.6)]">{folder.label} classes:</span>
              <button type="button" aria-pressed={pickedClass === null} onClick={() => setClassPick(null)} className={"rounded-full border px-3 py-1 text-sm font-semibold " + (pickedClass === null ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald))] text-white" : "border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface))]")} data-testid="marking-class-all">All {folder.label}</button>
              {arms.map((c) => (
                <button key={c} type="button" aria-pressed={pickedClass === c} onClick={() => setClassPick(c)} className={"rounded-full border px-3 py-1 text-sm font-semibold " + (pickedClass === c ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald))] text-white" : "border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface))]")} data-testid={"marking-class-" + c}>{nameOf(c)}</button>
              ))}
            </div>
          )}
        </nav>
      )}

      {visible.length === 0 ? <EmptyState icon={<CheckSquare size={22} />} title={show === "todo" ? "Nothing to mark" : "No submissions yet"} body="Submitted attempts from your classes appear here, filed by year, class and subject. Multiple-choice scores are calculated automatically; written answers are marked by staff." /> : (
        <div className="space-y-8">{ordered.map(([key, y]) => (
          <section key={key} aria-labelledby={"mark-year-" + key} data-testid={"marking-year-" + key}>
            {!folder && (
              <div className="mb-3 flex items-center gap-3">
                <FolderOpen size={20} className="text-[hsl(var(--p-gold))]" aria-hidden />
                <h3 id={"mark-year-" + key} className="font-serif text-2xl font-semibold">{y.label}</h3>
                <span className="h-px flex-1 bg-[hsl(var(--p-line))]" />
              </div>
            )}
            <div className="space-y-5">{[...y.subjects.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([subject, exams]) => (
              <div key={subject} className="rounded-3xl border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface)/0.6)] p-4" data-testid={"marking-subject-" + subject}>
                <h4 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-[hsl(var(--p-emerald))]"><BookOpen size={15} aria-hidden /> {subject}</h4>
                <div className="space-y-4">{[...exams.entries()].sort((a, b) => (examOf(b[0])?.startsAt ?? "").localeCompare(examOf(a[0])?.startsAt ?? "")).map(([examId, scripts]) => {
                  const exam = examOf(examId);
                  const marked = scripts.map(pct).filter((n): n is number => n !== null);
                  const average = marked.length ? Math.round(marked.reduce((s, n) => s + n, 0) / marked.length) : null;
                  const waiting = scripts.filter((a) => a.status === "submitted").length;
                  const missed = exam ? missedStudents(data, exam).length : 0;
                  return (
                    <article key={examId} className="overflow-hidden rounded-2xl border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface))]" data-testid={"marking-exam-" + examId}>
                      <header className="flex flex-wrap items-center gap-2 border-b border-[hsl(var(--p-line))] bg-[hsl(var(--p-paper-2)/0.5)] px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-serif text-lg font-semibold leading-tight">{scripts[0].title}</p>
                          <p className="text-xs text-[hsl(var(--p-ink)/0.6)]">{nameOf(scripts[0].classId)}{exam ? ` / ${formatDateTime(exam.startsAt)}` : ""}</p>
                        </div>
                        <span className="rounded-full bg-[hsl(var(--p-paper-2))] px-2.5 py-0.5 text-xs font-semibold">{scripts.length} {scripts.length === 1 ? "script" : "scripts"}</span>
                        {waiting > 0 && <StatusPill tone="gold">{waiting} to mark</StatusPill>}
                        {average !== null && <StatusPill tone="green">Average {average}%</StatusPill>}
                        {exam && exam.published && !exam.resultsReleased && missed > 0 && <button type="button" className="portal-btn-ghost !py-1 text-xs" onClick={() => setMakeupFor(examId)} data-testid={"button-marking-makeup-" + examId}><CalendarPlus size={12} /> Make-up ({missed} missed)</button>}
                      </header>
                      <div className="divide-y divide-[hsl(var(--p-line))]">{[...scripts].sort((a, b) => a.studentName.localeCompare(b.studentName)).map((a) => {
                        const p = pct(a);
                        return (
                          <div key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center" data-testid={"row-attempt-" + a.id}>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold">{a.studentName} <span className="font-mono text-xs text-[hsl(var(--p-ink)/0.5)]">{a.studentId}</span></p>
                              <p className="text-xs text-[hsl(var(--p-ink)/0.55)]">{a.closedBy === "student" && a.submittedAt ? `Submitted by the student ${formatDateTime(a.submittedAt)}` : `Last answer saved ${formatDateTime(a.savedAt)}`}</p>
                              {a.closedBy === "time" && <p className="text-xs font-semibold text-[hsl(var(--p-gold-ink))]" data-testid={"text-closed-by-time-" + a.id}>Time ran out before the student submitted{a.submittedAt ? ` (closed ${formatDateTime(a.submittedAt)})` : ""}. If the connection failed, use Reopen in the exam's results.</p>}
                              {(a.focusLosses ?? 0) > 0 && <p className="text-xs font-semibold text-[hsl(var(--p-red))]" data-testid={"text-focus-losses-" + a.id}>Left the exam screen {a.focusLosses} {a.focusLosses === 1 ? "time" : "times"}</p>}
                            </div>
                            {p !== null && <div className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-[hsl(var(--p-paper-2))] sm:block" aria-hidden><div className="h-full rounded-full bg-[hsl(var(--p-emerald))]" style={{ width: p + "%" }} /></div>}
                            {a.status === "marked" ? <StatusPill tone="green"><span data-testid={"text-score-" + a.id}>{a.score ?? "-"} / {a.totalMarks}{p !== null ? ` (${p}%)` : ""}</span></StatusPill> : <StatusPill tone="gold">To mark</StatusPill>}
                            <button className="portal-btn-ghost" onClick={() => setOpen(a.id)} data-testid={"button-grade-" + a.id}>{a.status === "marked" ? "Review marks" : "Mark"}</button>
                          </div>
                        );
                      })}</div>
                    </article>
                  );
                })}</div>
              </div>
            ))}</div>
          </section>
        ))}</div>
      )}
      {current && <GradeDialog key={current.id} attempt={current} onClose={() => setOpen(null)} />}
      {makeupExam && <MakeupDialog data={data} exam={makeupExam} onClose={() => setMakeupFor(null)} />}
    </div>
  );
}
