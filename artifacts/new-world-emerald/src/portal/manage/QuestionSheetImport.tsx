import { useRef, useState } from "react";
import type { PortalExamQuestionsItem } from "@workspace/api-client-react";
import { CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MAX_SHEET, SheetError, TEMPLATE_HEADINGS, downloadQuestionTemplate, readQuestionSheet } from "./questionSheet";

type Q = PortalExamQuestionsItem;
type Summary = { file: string; sheet: string; added: number; existing: number; keys: number; mcq: number; general: string[]; flagged: number };

async function bytesOf(f: File): Promise<Uint8Array> {
  if (typeof f.arrayBuffer === "function") return new Uint8Array(await f.arrayBuffer());
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(f);
  });
}

/** "Upload questions from Excel": rows become draft questions in the editor, added after any already there. */
export function QuestionSheetImport({ existing, onImport }: { existing: number; onImport: (questions: Q[], notes: Record<string, string[]>) => void }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [problem, setProblem] = useState("");

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setProblem("");
    if (f.size > MAX_SHEET) { setProblem("The file is larger than 5 MB. Keep only the questions sheet and try again."); return; }
    setReading(true);
    try {
      const r = await readQuestionSheet(await bytesOf(f), f.name);
      const room = Math.max(0, 200 - existing);
      const questions = r.questions.slice(0, room);
      const general = [...r.general];
      if (questions.length < r.questions.length) general.push(`Only ${questions.length} of the ${r.questions.length} questions were added: an exam holds at most 200.`);
      const notes: Record<string, string[]> = {};
      for (const n of r.notes) { const q = questions[n.index]; if (q) (notes[q.id] ??= []).push(n.message); }
      if (questions.length) onImport(questions, notes);
      setSummary({ file: f.name, sheet: r.sheet, added: questions.length, existing, keys: r.keys, mcq: r.mcq, general, flagged: Object.keys(notes).length });
      if (questions.length) toast({ title: `${questions.length} question${questions.length === 1 ? "" : "s"} added from Excel`, description: "Check each one before saving." });
      else toast({ variant: "destructive", title: "No questions found", description: general[0] });
    } catch (e) {
      setSummary(null);
      setProblem(e instanceof SheetError ? e.message : "This file could not be read. Save it as Excel Workbook (.xlsx) or CSV and try again.");
    } finally { setReading(false); }
  };

  return (
    <section className="mb-4 rounded-2xl border border-[hsl(var(--p-emerald)/0.25)] bg-[hsl(var(--p-emerald-soft)/0.35)] p-4" data-testid="panel-excel-import">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[hsl(var(--p-emerald))] text-[hsl(var(--p-paper))] shadow-sm"><FileSpreadsheet size={20} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="font-serif text-base font-semibold leading-tight">Upload questions from Excel</p>
          <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--p-ink)/0.65)]">One question per row, headings in row 1. Excel Workbook (.xlsx) or CSV, up to 5 MB. Questions are added after any already in this exam, and each one stays editable below.</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <button type="button" className="portal-btn-ghost" onClick={downloadQuestionTemplate} data-testid="button-excel-template"><Download size={13} /> Template</button>
          <input ref={input} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-excel-file" />
          <button type="button" className="portal-btn" disabled={reading || existing >= 200} onClick={() => input.current?.click()} data-testid="button-upload-excel"><Upload size={13} /> {reading ? "Reading..." : "Upload Excel"}</button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Columns the sheet can have">
        {TEMPLATE_HEADINGS.map((h, i) => (
          <span key={h} className={"rounded-md border px-2 py-0.5 font-mono text-[11px] " + (i < 7 ? "border-[hsl(var(--p-emerald)/0.35)] bg-[hsl(var(--p-surface))] font-semibold text-[hsl(var(--p-emerald))]" : "border-dashed border-[hsl(var(--p-line))] text-[hsl(var(--p-ink)/0.55)]")}>{h}</span>
        ))}
        <span className="self-center text-[11px] text-[hsl(var(--p-ink)/0.5)]">Dashed columns are optional. Add E to H for more choices.</span>
      </div>
      {problem && <p role="alert" className="mt-3 rounded-lg border border-[hsl(var(--p-red)/0.3)] bg-[hsl(var(--p-red)/0.06)] px-3 py-2 text-sm font-semibold" data-testid="text-excel-problem">{problem}</p>}
      {summary && (
        <div className="mt-3 rounded-xl border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface)/0.9)] p-3 text-sm" data-testid="summary-excel-import">
          <p className="flex flex-wrap items-center gap-2 font-semibold"><CheckCircle2 size={15} className="text-[hsl(var(--p-emerald))]" aria-hidden />
            {summary.added} question{summary.added === 1 ? "" : "s"} added from {summary.file}{summary.sheet !== summary.file ? ` (sheet “${summary.sheet}”)` : ""}{summary.existing && summary.added ? `, after the ${summary.existing} already here` : ""}.</p>
          {summary.mcq > 0 && <p className="mt-1 text-xs" data-testid="text-excel-keys">Answer keys read for {summary.keys} of {summary.mcq} multiple-choice question{summary.mcq === 1 ? "" : "s"}. Check every answer before publishing.</p>}
          {summary.flagged > 0 && <p className="mt-1 text-xs font-semibold text-[hsl(var(--p-gold-ink))]">{summary.flagged} question{summary.flagged === 1 ? " has a note" : "s have notes"} below. Read {summary.flagged === 1 ? "it" : "them"} before saving.</p>}
          {summary.general.map((g) => <p key={g} className="mt-1 text-xs font-semibold" data-testid="text-excel-note">{g}</p>)}
        </div>
      )}
    </section>
  );
}
