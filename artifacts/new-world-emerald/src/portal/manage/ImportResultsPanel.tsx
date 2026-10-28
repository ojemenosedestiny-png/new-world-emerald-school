import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  previewResultImport, commitResultImport, useListResultImports, getListResultImportsQueryKey,
  type ResultImportPreview, type ResultImportRecord, type ResultImportRow,
} from "@workspace/api-client-react";
import { CheckCircle2, Download, FileUp, History, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ErrorPanel, Field, Skeleton } from "../ui";
import { errorMessage } from "../lib";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const TONE = { ok: "bg-[hsl(var(--p-emerald-soft))] text-[hsl(var(--p-emerald))]", warning: "bg-[hsl(var(--p-gold-soft))] text-[hsl(var(--p-gold-ink))]", error: "bg-[hsl(var(--p-red)/0.1)] text-[hsl(var(--p-red))]" };
const LABEL = { ok: "Ready", warning: "Check", error: "Not imported" };
const score = (r: ResultImportRow) => (r.total ?? (r.ca !== null || r.exam !== null ? (r.ca ?? 0) + (r.exam ?? 0) : "-"));

function RowsTable({ rows, testId }: { rows: ResultImportRow[]; testId: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm" data-testid={testId}>
        <thead><tr className="border-b border-[hsl(var(--p-line))] text-left text-xs uppercase tracking-wide text-[hsl(var(--p-ink)/0.6)]">
          <th className="p-2">Line</th><th className="p-2">Student</th><th className="p-2">Class · term</th><th className="p-2">Subject</th><th className="p-2 text-right">Score</th><th className="p-2">Status</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.line} className="border-b border-[hsl(var(--p-line))] align-top last:border-0" data-testid={"import-row-" + r.line}>
              <td className="p-2 tabular-nums text-[hsl(var(--p-ink)/0.6)]">{r.line}</td>
              <td className="p-2"><span className="block font-semibold">{r.studentName || "-"}</span><span className="font-mono text-xs text-[hsl(var(--p-ink)/0.55)]">{r.studentId}</span></td>
              <td className="p-2">{r.className}<span className="block text-xs text-[hsl(var(--p-ink)/0.6)]">{r.term}, {r.session}</span></td>
              <td className="p-2">{r.subject}</td>
              <td className="p-2 text-right tabular-nums">{score(r)}{r.grade ? <span className="ml-1 font-bold">{r.grade}</span> : null}</td>
              <td className="p-2"><span className={"rounded-full px-2 py-0.5 text-xs font-bold " + TONE[r.status]}>{LABEL[r.status]}</span>
                {r.messages.map((m) => <span key={m} className="mt-1 block text-xs text-[hsl(var(--p-ink)/0.75)]">{m}</span>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** School office: bring old results from the previous portal in, with a check before anything is saved. */
export function ImportResultsPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const history = useListResultImports({ query: { queryKey: getListResultImportsQueryKey() } });
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [maxima, setMaxima] = useState({ caMax: 40, examMax: 60 });
  const [publish, setPublish] = useState(true);
  const [preview, setPreview] = useState<ResultImportPreview | null>(null);
  const [done, setDone] = useState<ResultImportRecord | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);

  const check = async (f = file, m = maxima) => {
    if (!f) return;
    setBusy("preview"); setDone(null);
    try { setPreview(await previewResultImport(f.text, m)); }
    catch (e) { setPreview(null); toast({ variant: "destructive", title: "Could not check the file", description: errorMessage(e) }); }
    finally { setBusy(null); }
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { toast({ variant: "destructive", title: "File too large", description: "Split it into files under 10 MB, for example one per session." }); return; }
    const next = { name: f.name, text: await f.text() };
    setFile(next);
    void check(next);
  };
  const commit = async () => {
    if (!file || !preview) return;
    setBusy("commit");
    try {
      const r = await commitResultImport(file.text, { ...maxima, publish, fileName: file.name });
      setDone(r); setPreview(null); setFile(null);
      void qc.invalidateQueries({ queryKey: getListResultImportsQueryKey() });
      toast({ title: "Old results imported", description: `${r.imported} rows saved.` });
    } catch (e) { toast({ variant: "destructive", title: "Import failed", description: errorMessage(e) }); }
    finally { setBusy(null); }
  };
  const importable = preview ? preview.ok + preview.warnings : 0;

  return (
    <div className="space-y-5">
      <section className="portal-card p-5">
        <h3 className="font-serif text-xl font-semibold">1. Prepare the file</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[hsl(var(--p-ink)/0.75)]">
          <li>One row for each student, subject and term. Download the template to see the columns; the old portal's own headings such as "Admission No" also work.</li>
          <li>Students must already be enrolled with the same student ID, and each class must exist (create old class names in Classes if needed).</li>
          <li>Missing terms and subjects are created for you. Old totals and grades are kept exactly as they were.</li>
          <li>From Excel: File, Save As, <b>CSV UTF-8</b>. For very large histories, use one file per session.</li>
        </ul>
        <a className="portal-btn-ghost mt-4 w-fit" href={BASE + "/api/portal/results-import/template"} download data-testid="link-import-template"><Download size={14} /> Download template</a>
      </section>

      <section className="portal-card space-y-4 p-5">
        <h3 className="font-serif text-xl font-semibold">2. Upload and check</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="CA out of (new terms)" htmlFor="imp-ca"><input id="imp-ca" type="number" min={0} max={100} className="portal-input" value={maxima.caMax} onChange={(e) => setMaxima({ ...maxima, caMax: Number(e.target.value) })} onBlur={() => void check()} /></Field>
          <Field label="Exam out of (new terms)" htmlFor="imp-exam"><input id="imp-exam" type="number" min={0} max={100} className="portal-input" value={maxima.examMax} onChange={(e) => setMaxima({ ...maxima, examMax: Number(e.target.value) })} onBlur={() => void check()} /></Field>
          <div className="flex items-end">
            <label className="portal-btn w-full cursor-pointer justify-center"><Upload size={14} /> {busy === "preview" ? "Checking..." : file ? "Choose another file" : "Choose CSV file"}
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-import-file" />
            </label>
          </div>
        </div>
        {file && <p className="text-sm text-[hsl(var(--p-ink)/0.65)]"><FileUp size={13} className="mr-1 inline" />{file.name}</p>}

        {preview && (preview.missingColumns.length ? (
          <p className="rounded-xl bg-[hsl(var(--p-red)/0.08)] p-3 text-sm font-semibold text-[hsl(var(--p-red))]" data-testid="text-import-missing">The file is missing these columns: {preview.missingColumns.join(", ")}. Use the template headings.</p>
        ) : (
          <div className="space-y-4" data-testid="panel-import-preview">
            <div className="grid grid-cols-2 divide-[hsl(var(--p-line))] rounded-xl border border-[hsl(var(--p-line))] sm:grid-cols-5 sm:divide-x">
              {[["Rows", preview.total, ""], ["Ready", preview.ok, "text-[hsl(var(--p-emerald))]"], ["To check", preview.warnings, "text-[hsl(var(--p-gold-ink))]"], ["Not imported", preview.errors, "text-[hsl(var(--p-red))]"], ["Students", preview.students, ""]].map(([k, v, tone]) => (
                <div key={k as string} className="p-3"><p className="text-xs text-[hsl(var(--p-ink)/0.6)]">{k}</p><p className={"font-serif text-2xl font-semibold tabular-nums " + ((v as number) ? tone : "")} data-testid={"import-count-" + String(k).toLowerCase().replace(/\s/g, "-")}>{v as number}</p></div>
              ))}
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs font-semibold text-[hsl(var(--p-ink)/0.6)]">Terms</dt><dd>{preview.terms.join("; ") || "-"}</dd></div>
              <div><dt className="text-xs font-semibold text-[hsl(var(--p-ink)/0.6)]">Classes</dt><dd>{preview.classes.join(", ") || "-"}</dd></div>
              {preview.newTerms.length > 0 && <div><dt className="text-xs font-semibold text-[hsl(var(--p-ink)/0.6)]">New terms to create</dt><dd>{preview.newTerms.join("; ")}</dd></div>}
              {preview.newSubjects.length > 0 && <div><dt className="text-xs font-semibold text-[hsl(var(--p-ink)/0.6)]">New subjects to add</dt><dd>{preview.newSubjects.join("; ")}</dd></div>}
            </dl>
            {preview.problems.length > 0 && (<div><h4 className="mb-1 text-sm font-semibold">Rows to look at{preview.errors + preview.warnings > preview.problems.length ? ` (first ${preview.problems.length})` : ""}</h4><RowsTable rows={preview.problems} testId="table-import-problems" /></div>)}
            {preview.sample.length > 0 && (<details><summary className="cursor-pointer text-sm font-semibold">Sample of ready rows</summary><RowsTable rows={preview.sample} testId="table-import-sample" /></details>)}
          </div>
        ))}
      </section>

      {preview && !preview.missingColumns.length && (
        <section className="portal-card space-y-3 p-5">
          <h3 className="font-serif text-xl font-semibold">3. Import</h3>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={publish} onChange={(e) => setPublish(e.target.checked)} data-testid="checkbox-import-publish" />
            <span>Publish these results to students now<span className="block text-xs text-[hsl(var(--p-ink)/0.6)]">Old results are usually final. Untick to check them in Report cards first and publish from there.</span></span></label>
          <button className="portal-btn" disabled={!importable || busy !== null} onClick={() => void commit()} data-testid="button-import-commit">
            <CheckCircle2 size={15} /> {busy === "commit" ? "Importing..." : `Import ${importable} ${importable === 1 ? "row" : "rows"}`}{preview.errors ? `, skip ${preview.errors}` : ""}
          </button>
        </section>
      )}
      {done && <p className="rounded-xl bg-[hsl(var(--p-emerald-soft)/0.7)] p-4 text-sm font-semibold" data-testid="text-import-done">Imported {done.imported} of {done.rows} rows{done.skipped ? ` (${done.skipped} skipped)` : ""}{done.published ? `, published for ${done.published} class ${done.published === 1 ? "term" : "terms"}` : ""}.</p>}

      <section className="portal-card p-5">
        <h3 className="flex items-center gap-2 font-serif text-xl font-semibold"><History size={18} /> Import history</h3>
        {history.isLoading ? <Skeleton className="mt-3 h-20" /> : history.isError ? <ErrorPanel title="History did not load" message={errorMessage(history.error)} onRetry={() => history.refetch()} />
          : !history.data?.length ? <p className="mt-2 text-sm text-[hsl(var(--p-ink)/0.6)]">No imports yet.</p> : (
            <ul className="mt-3 divide-y divide-[hsl(var(--p-line))]" data-testid="list-import-history">
              {history.data.map((h) => (
                <li key={h.id} className="py-3 text-sm">
                  <p className="font-semibold">{h.fileName || "Upload"} · {h.imported} of {h.rows} rows{h.skipped ? `, ${h.skipped} skipped` : ""}</p>
                  <p className="text-xs text-[hsl(var(--p-ink)/0.6)]">{new Date(h.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} · {h.importedBy}{h.published ? ` · published ${h.published}` : " · not published"}</p>
                  <p className="text-xs text-[hsl(var(--p-ink)/0.6)]">{h.terms.join("; ")}{h.classes.length ? ` · ${h.classes.join(", ")}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}
