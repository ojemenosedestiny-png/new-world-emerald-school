import { useEffect, useMemo, useState } from "react";
import type { ReportWorkspace, ReportTerm } from "@workspace/api-client-react";
import { FileUp, Save } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "../ui";
import { parseScoreCsv, parseScorePart, previewGrade } from "./scoreSheet";
import { useReportCommand } from "./useReportCommand";
import { BookOpenCheck } from "lucide-react";

type Entry = { ca: string; exam: string; total: string; grade: string };
type Draft = Record<number, Entry>;
const BLANK: Entry = { ca: "", exam: "", total: "", grade: "" };
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function ScoresEditor({ ws, term, locked }: { ws: ReportWorkspace; term: ReportTerm; locked: boolean }) {
  const cmd = useReportCommand();
  const [subjectId, setSubjectId] = useState<number>(ws.subjects[0]?.id ?? 0);
  const [draft, setDraft] = useState<Draft>({});
  const [csvOpen, setCsvOpen] = useState(false);
  const [csv, setCsv] = useState("");
  useEffect(() => { if (!ws.subjects.some((s) => s.id === subjectId)) setSubjectId(ws.subjects[0]?.id ?? 0); }, [ws.subjects, subjectId]);

  const saved = useMemo(() => {
    const map: Draft = {};
    for (const s of ws.scores) if (s.subjectId === subjectId) map[s.studentId] = { ca: fmt(s.ca), exam: fmt(s.exam), total: fmt(s.total), grade: s.grade ?? "" };
    return map;
  }, [ws.scores, subjectId]);
  useEffect(() => { setDraft(saved); }, [saved]);

  const possible = term.caMax + term.examMax;
  // Manual mode: the teacher may type a total and a grade; otherwise they come from CA + exam and the scale.
  const manual = ws.workflow?.mode === "manual";
  const grades = new Set(ws.gradingScale.map((b) => b.grade.toUpperCase()));
  const rows = ws.students.map((st) => {
    const d = { ...BLANK, ...draft[st.id] };
    const ca = parseScorePart(d.ca, term.caMax), exam = parseScorePart(d.exam, term.examMax);
    const typed = manual ? parseScorePart(d.total, possible) : { value: null };
    const gradeText = manual ? d.grade.trim().toUpperCase() : "";
    const gradeError = gradeText && !grades.has(gradeText) ? "Not on the grading scale" : undefined;
    const entered = ca.value !== null || exam.value !== null || typed.value !== null;
    const total = typed.value ?? (ca.value ?? 0) + (exam.value ?? 0);
    const grade = gradeText || previewGrade(possible ? (total / possible) * 100 : 0, ws.gradingScale);
    const before = { ...BLANK, ...saved[st.id] };
    return { st, d, ca, exam, typed, gradeText, gradeError, entered, total, grade, dirty: before.ca !== d.ca || before.exam !== d.exam || before.total !== d.total || before.grade !== d.grade };
  });
  const changed = rows.filter((r) => r.dirty);
  const invalid = rows.some((r) => r.ca.error || r.exam.error || ("error" in r.typed && r.typed.error) || r.gradeError);
  const enteredCount = rows.filter((r) => r.entered).length;
  const set = (id: number, key: keyof Entry, value: string) => setDraft((p) => ({ ...p, [id]: { ...BLANK, ...p[id], [key]: value } }));

  const save = () => cmd.run({ action: "saveScores", scores: { termId: term.id, entries: changed.map((r) => ({ studentId: r.st.id, subjectId, ca: r.ca.value, exam: r.exam.value, total: r.typed.value, grade: r.gradeText || null })) } }, `Saved ${changed.length} ${changed.length === 1 ? "score" : "scores"}`);
  const csvRows = useMemo(() => parseScoreCsv(csv, ws.students, term), [csv, ws.students, term]);
  const csvValid = csvRows.filter((r) => !r.error);
  const applyCsv = () => {
    setDraft((p) => { const next = { ...p }; for (const r of csvValid) next[r.id!] = { ...BLANK, ...p[r.id!], ca: fmt(r.ca), exam: fmt(r.exam) }; return next; });
    setCsvOpen(false); setCsv("");
  };

  if (!ws.subjects.length) return <EmptyState icon={<BookOpenCheck size={22} />} title="No subjects for this class" body="An administrator adds the class's subjects in the Subjects tab. Scores are entered per subject." />;
  if (!ws.students.length) return <EmptyState icon={<BookOpenCheck size={22} />} title="No active students" body="Enrol students in this class to enter their scores." />;
  const subject = ws.subjects.find((s) => s.id === subjectId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Subject">
        {ws.subjects.map((s) => {
          const count = ws.scores.filter((x) => x.subjectId === s.id).length;
          return (
            <button key={s.id} role="tab" aria-selected={s.id === subjectId} className={"portal-tab border border-[hsl(var(--p-line))] " + (s.id === subjectId ? "!bg-[hsl(var(--p-ink))] !text-[hsl(var(--p-paper))]" : "bg-[hsl(var(--p-surface)/0.7)]")} onClick={() => { if (!changed.length || window.confirm("Discard unsaved scores for this subject?")) setSubjectId(s.id); }} data-testid={"subject-tab-" + s.id}>
              {s.name} <span className="opacity-60">{count}/{ws.students.length}</span>
            </button>
          );
        })}
      </div>

      <div className="portal-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--p-line))] px-4 py-3">
          <p className="text-sm"><b>{subject?.name}</b> <span className="text-[hsl(var(--p-ink)/0.6)]">/ {enteredCount} of {ws.students.length} entered / CA out of {term.caMax}, exam out of {term.examMax}</span></p>
          <div className="flex gap-2">
            <button className="portal-btn-ghost" disabled={locked} onClick={() => setCsvOpen(true)} data-testid="button-import-scores"><FileUp size={13} /> Paste or upload</button>
            <button className="portal-btn" disabled={locked || !changed.length || invalid || cmd.pending} onClick={() => void save()} data-testid="button-save-scores"><Save size={14} /> {cmd.pending ? "Saving..." : changed.length ? `Save ${changed.length} ${changed.length === 1 ? "change" : "changes"}` : "Saved"}</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-[hsl(var(--p-paper-2)/0.7)] text-left text-xs uppercase tracking-wider text-[hsl(var(--p-ink)/0.6)]">
              <tr><th className="px-4 py-2">Student</th><th className="px-2 py-2 w-28">CA /{term.caMax}</th><th className="px-2 py-2 w-28">Exam /{term.examMax}</th><th className="px-2 py-2 w-24">Total{manual ? ` /${possible}` : ""}</th><th className="px-2 py-2 w-20">Grade</th></tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--p-line))]">
              {rows.map((r) => (
                <tr key={r.st.id} className={r.dirty ? "bg-[hsl(var(--p-gold-soft)/0.45)]" : ""} data-testid={"score-row-" + r.st.id}>
                  <td className="px-4 py-2"><p className="font-semibold">{r.st.name}</p><p className="font-mono text-xs text-[hsl(var(--p-ink)/0.5)]">{r.st.studentId}</p></td>
                  {(["ca", "exam"] as const).map((k) => (
                    <td key={k} className="px-2 py-2">
                      <input inputMode="decimal" className={"portal-input !py-1.5 text-center " + (r[k].error ? "!border-[hsl(var(--p-red))]" : "")} value={r.d[k]} disabled={locked} aria-label={`${k === "ca" ? "CA" : "Exam"} score for ${r.st.name}`} aria-invalid={!!r[k].error} title={r[k].error} onChange={(e) => set(r.st.id, k, e.target.value)} data-testid={`input-${k}-${r.st.id}`} />
                    </td>
                  ))}
                  {manual ? (<>
                    <td className="px-2 py-2"><input inputMode="decimal" className={"portal-input !py-1.5 text-center " + ("error" in r.typed && r.typed.error ? "!border-[hsl(var(--p-red))]" : "")} value={r.d.total} disabled={locked} placeholder={r.ca.value !== null || r.exam.value !== null ? String((r.ca.value ?? 0) + (r.exam.value ?? 0)) : ""} aria-label={`Total for ${r.st.name}`} onChange={(e) => set(r.st.id, "total", e.target.value)} data-testid={`input-total-${r.st.id}`} /></td>
                    <td className="px-2 py-2"><input className={"portal-input !py-1.5 text-center uppercase " + (r.gradeError ? "!border-[hsl(var(--p-red))]" : "")} maxLength={4} value={r.d.grade} disabled={locked} placeholder={r.entered ? r.grade : ""} title={r.gradeError} aria-label={`Grade for ${r.st.name}`} onChange={(e) => set(r.st.id, "grade", e.target.value)} data-testid={`input-grade-${r.st.id}`} /></td>
                  </>) : (<>
                    <td className="px-2 py-2 font-semibold tabular-nums">{r.entered ? r.total : "-"}</td>
                    <td className="px-2 py-2 font-bold">{r.entered ? r.grade : "-"}</td>
                  </>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {manual && <p className="border-t border-[hsl(var(--p-line))] px-4 py-2 text-xs text-[hsl(var(--p-ink)/0.6)]">Manual results: type a total and grade to use them instead of the calculated ones. Leave them empty to calculate from CA and exam.</p>}
        {invalid && <p className="border-t border-[hsl(var(--p-line))] px-4 py-2 text-xs text-[hsl(var(--p-red))]">Fix the highlighted scores before saving.</p>}
      </div>

      <Dialog open={csvOpen} onOpenChange={setCsvOpen}>
        <DialogContent className="portal !min-h-0 max-h-[92dvh] max-w-xl overflow-y-auto rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">Import {subject?.name} scores</DialogTitle>
            <DialogDescription>One student per line: Student ID, CA, Exam. Copying three columns from Excel works. Scores fill the grid for you to check before saving.</DialogDescription></DialogHeader>
          <textarea className="portal-input min-h-[160px] font-mono text-sm" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"Student ID, CA, Exam\nNWE/2026/001, 32, 51"} data-testid="input-score-csv" />
          <label className="portal-btn-ghost w-fit cursor-pointer"><FileUp size={13} /> Upload CSV
            <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => { e.target.files?.[0]?.text().then(setCsv); e.target.value = ""; }} />
          </label>
          {csvRows.length > 0 && (
            <div className="max-h-48 divide-y divide-[hsl(var(--p-line))] overflow-y-auto rounded-xl border border-[hsl(var(--p-line))] text-sm">
              {csvRows.map((r) => <div key={r.line} className="flex gap-3 px-3 py-1.5"><span className="w-36 truncate font-mono">{r.studentId}</span><span className="flex-1">{fmt(r.ca) || "-"} / {fmt(r.exam) || "-"}</span>{r.error && <span className="text-xs text-[hsl(var(--p-red))]">Line {r.line}: {r.error}</span>}</div>)}
            </div>
          )}
          <DialogFooter><button className="portal-btn" disabled={!csvValid.length} onClick={applyCsv} data-testid="button-apply-csv">Fill {csvValid.length} {csvValid.length === 1 ? "row" : "rows"}</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
