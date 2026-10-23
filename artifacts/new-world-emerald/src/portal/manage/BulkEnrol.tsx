import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEnrolStudent, getGetPortalManagementQueryKey, type PortalManagement } from "@workspace/api-client-react";
import { CheckCircle2, Download, Printer, Upload, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Field } from "../ui";
import { errorMessage } from "../lib";
import { ClassSelect } from "./ClassSelect";
import { className } from "./useCommand";
import { downloadCsv } from "./results";
import { MAX_BULK_STUDENTS, parseEnrolList } from "./enrol";
import { printActivationSlips, type ActivationSlip } from "./accounts";

type Failure = { line: number; name: string; error: string };
type Done = ActivationSlip & { emailed: boolean };

function linksCsv(rows: Done[]) {
  const cell = (v: string) => { let t = v; if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  return [["Student ID", "Name", "Class", "Activation link", "Expires", "Emailed"], ...rows.map((r) => [r.studentId, r.name, r.className, r.url, r.expiresAt, r.emailed ? "yes" : "no"])]
    .map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function BulkEnrol({ data, onClose }: { data: PortalManagement; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const enrol = useEnrolStudent();
  const [classId, setClassId] = useState<number>(data.classes[0]?.id ?? 0);
  const [text, setText] = useState("");
  const [send, setSend] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [issued, setIssued] = useState<Done[]>([]);
  const [failed, setFailed] = useState<Failure[]>([]);
  const rows = useMemo(() => parseEnrolList(text, data.students.map((s) => s.studentId)), [text, data.students]);
  const valid = rows.filter((r) => !r.error);
  const invalid = rows.length - valid.length;
  const running = progress !== null && progress.done < progress.total;
  const finished = progress !== null && progress.done === progress.total;
  const cls = className(data.classes, classId);
  const emailedCount = issued.filter((r) => r.emailed).length;

  const readFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1024 * 1024) { toast({ variant: "destructive", title: "File too large", description: "Use a CSV under 1 MB." }); return; }
    file.text().then(setText, () => toast({ variant: "destructive", title: "Could not read that file" }));
  };

  const run = async () => {
    if (!valid.length || valid.length > MAX_BULK_STUDENTS) return;
    const ok: Done[] = [];
    const bad: Failure[] = [];
    setProgress({ done: 0, total: valid.length });
    // One at a time keeps ID allocation, hashing and email sending predictable, and failures exact.
    for (const [i, row] of valid.entries()) {
      try {
        const r = await enrol.mutateAsync({ data: { name: row.name, classId, guardianEmail: row.guardianEmail || null, studentId: row.studentId || null, send } });
        ok.push({ name: r.student.name, studentId: r.student.studentId, className: r.student.className, url: r.url, expiresAt: r.expiresAt, emailed: r.emailed });
      } catch (e) {
        bad.push({ line: row.line, name: row.name, error: errorMessage(e) });
      }
      setProgress({ done: i + 1, total: valid.length });
    }
    setIssued(ok);
    setFailed(bad);
    await queryClient.invalidateQueries({ queryKey: getGetPortalManagementQueryKey() });
    toast({ title: `${ok.length} ${ok.length === 1 ? "student" : "students"} enrolled`, description: bad.length ? `${bad.length} could not be enrolled.` : undefined, variant: bad.length && !ok.length ? "destructive" : undefined });
  };

  const print = () => { if (!printActivationSlips(issued)) toast({ variant: "destructive", title: "Pop-up blocked", description: "Allow pop-ups for this site, or download the CSV instead." }); };
  const download = () => downloadCsv(`${cls} activation links.csv`.replace(/[\\/:*?"<>|]+/g, "-"), linksCsv(issued));

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !running) onClose(); }}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">{finished ? "Enrolment complete" : "Enrol a class list"}</DialogTitle>
          <DialogDescription>{finished ? "Student IDs were created automatically. Families activate their accounts with the links." : "Paste one student per line as Full name, Parent email, or upload a CSV. Add a third column only for students who already have an ID."}</DialogDescription>
        </DialogHeader>

        {!finished ? (
          <div className="space-y-4">
            <Field label="Class" htmlFor="bulk-class"><ClassSelect id="bulk-class" classes={data.classes} value={classId} disabled={running} onChange={setClassId} /></Field>
            <Field label="Students" htmlFor="bulk-list" hint="Copying columns from Excel or Google Sheets also works. A header row (e.g. Name, Parent email, Student ID) sets the column order.">
              <textarea id="bulk-list" className="portal-input min-h-[160px] font-mono text-sm" value={text} disabled={running} onChange={(e) => setText(e.target.value)} placeholder={"Full name, Parent email\nAdaeze Okafor, okafor.family@example.com\nTunde Bello, tbello@example.com"} data-testid="input-bulk-list" />
            </Field>
            <div className="flex flex-wrap items-center gap-4">
              <label className="portal-btn-ghost w-fit cursor-pointer">
                <Upload size={13} /> Upload CSV
                <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" disabled={running} onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-bulk-file" />
              </label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={send} disabled={running} onChange={(e) => setSend(e.target.checked)} data-testid="checkbox-bulk-send" /> Email activation links to parents</label>
            </div>
            {rows.length > 0 && (
              <div className="rounded-2xl border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface)/0.8)]">
                <p className="border-b border-[hsl(var(--p-line))] px-4 py-2 text-sm" data-testid="text-bulk-summary">
                  <b>{valid.length}</b> ready{invalid > 0 && <> / <span className="text-[hsl(var(--p-red))]"><b>{invalid}</b> need fixing</span></>}
                  {valid.length > MAX_BULK_STUDENTS && <span className="text-[hsl(var(--p-red))]"> / limit is {MAX_BULK_STUDENTS} per import</span>}
                </p>
                <div className="max-h-56 divide-y divide-[hsl(var(--p-line))] overflow-y-auto text-sm">
                  {rows.map((r) => (
                    <div key={r.line} className="flex items-center gap-3 px-4 py-1.5" data-testid={"bulk-row-" + r.line}>
                      {r.error ? <XCircle size={14} className="shrink-0 text-[hsl(var(--p-red))]" /> : <CheckCircle2 size={14} className="shrink-0 text-[hsl(var(--p-emerald))]" />}
                      <span className="min-w-0 flex-1 truncate">{r.name || "-"}</span>
                      <span className="hidden w-48 shrink-0 truncate text-xs text-[hsl(var(--p-ink)/0.6)] sm:block">{r.guardianEmail || "no email"}</span>
                      <span className="w-32 shrink-0 truncate font-mono text-xs">{r.studentId || "auto ID"}</span>
                      {r.error && <span className="shrink-0 text-xs text-[hsl(var(--p-red))]">Line {r.line}: {r.error}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {invalid > 0 && valid.length > 0 && <p className="text-xs text-[hsl(var(--p-ink)/0.6)]">Lines that need fixing are skipped. You can import them later.</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl bg-[hsl(var(--p-emerald-soft))] p-4"><p className="text-xs">Enrolled in {cls}</p><p className="font-serif text-3xl font-semibold" data-testid="text-bulk-enrolled">{issued.length}</p></div>
              <div className="rounded-2xl bg-[hsl(var(--p-surface)/0.8)] p-4 ring-1 ring-[hsl(var(--p-line))]"><p className="text-xs">Links emailed</p><p className="font-serif text-3xl font-semibold" data-testid="text-bulk-emailed">{emailedCount}</p></div>
              <div className="rounded-2xl bg-[hsl(var(--p-surface)/0.8)] p-4 ring-1 ring-[hsl(var(--p-line))]"><p className="text-xs">Not enrolled</p><p className="font-serif text-3xl font-semibold">{failed.length}</p></div>
            </div>
            {issued.length > emailedCount && <p className="rounded-xl bg-[hsl(var(--p-gold-soft))] p-3 text-sm">{issued.length - emailedCount} {issued.length - emailedCount === 1 ? "family has" : "families have"} not been emailed. Print their activation slips or share the links from the CSV.</p>}
            {issued.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button className="portal-btn" onClick={print} data-testid="button-print-slips"><Printer size={15} /> Print activation slips</button>
                <button className="portal-btn-ghost" onClick={download} data-testid="button-download-logins"><Download size={14} /> Download links (CSV)</button>
              </div>
            )}
            {failed.length > 0 && (
              <div className="rounded-2xl border border-[hsl(var(--p-red)/0.25)] bg-[hsl(var(--p-red)/0.05)] p-3 text-sm">
                {failed.map((f) => <p key={f.line}>Line {f.line} {f.name}: {f.error}</p>)}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="items-center gap-3">
          {running && <span className="text-sm" role="status" data-testid="text-bulk-progress">Enrolling {progress.done} of {progress.total}...</span>}
          {!finished
            ? <button className="portal-btn" onClick={() => void run()} disabled={running || !classId || !valid.length || valid.length > MAX_BULK_STUDENTS} data-testid="button-run-bulk">{running ? "Enrolling..." : `Enrol ${valid.length || ""} ${valid.length === 1 ? "student" : "students"}`}</button>
            : <button className="portal-btn-ghost" onClick={onClose} data-testid="button-close-bulk">Done</button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
