import { useEffect, useState } from "react";
import type { PortalManagement, PortalManagementExamsItem } from "@workspace/api-client-react";
import { CalendarPlus, Download, PlayCircle, RotateCcw, Timer } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { StatusPill } from "../ui";
import { formatDateTime, formatTime } from "../lib";
import { MakeupDialog } from "./MakeupDialog";
import { className, useCommand } from "./useCommand";
import { PASS_PERCENT, downloadCsv, examRoster, examStudentList, examStats, resultsCsv, statusLabel, type RosterRow } from "./results";

const EXTRA_MINUTES = [5, 10, 15, 30];
const TONE = { not_started: "muted", writing: "gold", submitted: "ink", marked: "green" } as const;

function minutesLeft(deadline: string, now: number) {
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 60_000));
}

export function ExamResults({ data, exam, isAdmin, onClose }: { data: PortalManagement; exam: PortalManagementExamsItem; isAdmin: boolean; onClose: () => void }) {
  const cmd = useCommand();
  const [now, setNow] = useState(() => Date.now());
  const [reset, setReset] = useState<RosterRow | null>(null);
  const [makeupFor, setMakeupFor] = useState<number[] | null>(null);
  const [reopen, setReopen] = useState<RosterRow | null>(null);
  const [reopenMinutes, setReopenMinutes] = useState(15);
  const makeups = (data.makeups ?? []).filter((m) => m.examId === exam.id);
  const idOf = (code: string) => examStudentList(data).find((s) => s.studentId === code)?.id as number | undefined;
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(t); }, []);
  const rows = examRoster(data, exam, now);
  const stats = examStats(rows);
  const counts = { writing: 0, submitted: 0, marked: 0, not_started: 0 };
  for (const r of rows) counts[r.status]++;
  const extend = (attemptId: number, minutes: number) => cmd.run({ action: "extendAttempt", attemptControl: { attemptId, minutes } }, `Added ${minutes} minutes`);
  const exportCsv = () => downloadCsv(`${exam.title} - ${className(data.classes, exam.classId)} results.csv`.replace(/[\\/:*?"<>|]+/g, "-"), resultsCsv(rows));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-4xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">{exam.title}</DialogTitle>
          <DialogDescription>{className(data.classes, exam.classId)} / {exam.subject} / live progress and results</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="results-counts">
          {(["writing", "submitted", "marked", "not_started"] as const).map((k) => (
            <div key={k} className="rounded-2xl border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface)/0.8)] p-3">
              <p className="text-xs text-[hsl(var(--p-ink)/0.55)]">{statusLabel(k)}</p>
              <p className="font-serif text-2xl font-semibold">{counts[k]}</p>
            </div>
          ))}
        </div>

        {stats && (
          <div className="rounded-2xl bg-[hsl(var(--p-emerald-soft))] p-4 text-sm" data-testid="results-stats">
            <p className="font-semibold">Class performance ({stats.marked} marked)</p>
            <p className="mt-1">Average {stats.average}% / Highest {stats.highest}% / Lowest {stats.lowest}% / {stats.passRate}% scored {PASS_PERCENT}% or more</p>
            {!exam.resultsReleased && <p className="mt-1 text-xs text-[hsl(var(--p-ink)/0.6)]">Students cannot see scores until you release results.</p>}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {exam.published && !exam.resultsReleased && counts.not_started > 0 && <button className="portal-btn-ghost" onClick={() => setMakeupFor([])} data-testid="button-open-makeup"><CalendarPlus size={13} /> Make-up exam ({counts.not_started} missed)</button>}
          <button className="portal-btn-ghost" onClick={exportCsv} disabled={!rows.length} data-testid="button-export-results"><Download size={13} /> Export CSV</button>
        </div>

        {rows.length === 0 ? <p className="text-sm text-[hsl(var(--p-ink)/0.6)]">No active students are enrolled in this class yet.</p> : (
          <div className="portal-card divide-y divide-[hsl(var(--p-line))] overflow-hidden">{rows.map((r) => {
            const a = r.attempt;
            return (
              <div key={r.studentId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center" data-testid={"row-result-" + r.studentId}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{r.name} <span className="font-mono text-xs text-[hsl(var(--p-ink)/0.5)]">{r.studentId}</span></p>
                  {r.status === "writing" && a && <p className="text-xs text-[hsl(var(--p-ink)/0.55)]">{minutesLeft(a.deadline, now)} min left / ends {formatTime(a.deadline)} / last saved {formatTime(a.savedAt)}</p>}
                  {(() => { const m = r.status === "not_started" ? makeups.find((x) => x.studentId === idOf(r.studentId)) : undefined; return m ? <p className="text-xs font-semibold text-[hsl(var(--p-gold-ink))]" data-testid={"text-row-makeup-" + r.studentId}>Make-up: {formatDateTime(m.startsAt)} to {formatDateTime(m.endsAt)}</p> : null; })()}
                </div>
                {r.status === "not_started" && exam.published && !exam.resultsReleased && idOf(r.studentId) !== undefined && (
                  <button className="portal-btn-ghost !px-2 !py-1 text-xs" disabled={cmd.pending} onClick={() => setMakeupFor([idOf(r.studentId)!])} data-testid={"button-makeup-" + r.studentId}><CalendarPlus size={12} /> Make-up</button>
                )}
                {r.status === "marked" ? <StatusPill tone="green">{r.score} / {r.totalMarks} ({r.percent}%)</StatusPill> : <StatusPill tone={TONE[r.status]}>{statusLabel(r.status)}</StatusPill>}
                {r.status === "writing" && a && !exam.resultsReleased && (
                  <div className="flex flex-wrap gap-1" aria-label={"Give " + r.name + " extra time"}>
                    {EXTRA_MINUTES.map((m) => <button key={m} className="portal-btn-ghost !px-2 !py-1 text-xs" disabled={cmd.pending} onClick={() => void extend(a.id, m)} data-testid={`button-extend-${a.id}-${m}`}><Timer size={12} /> +{m}</button>)}
                  </div>
                )}
                {a && !exam.resultsReleased && (r.status === "submitted" || r.status === "marked") && (
                  <button className="portal-btn-ghost !px-2 !py-1 text-xs" disabled={cmd.pending} onClick={() => { setReopenMinutes(15); setReopen(r); }} data-testid={"button-reopen-" + a.id}><PlayCircle size={12} /> Reopen</button>
                )}
                {isAdmin && a && !exam.resultsReleased && (
                  <button className="portal-btn-ghost !px-2 !py-1 text-xs" disabled={cmd.pending} onClick={() => setReset(r)} data-testid={"button-reset-" + a.id}><RotateCcw size={12} /> Reset</button>
                )}
              </div>
            );
          })}</div>
        )}
        {exam.resultsReleased && <p className="text-xs text-[hsl(var(--p-ink)/0.5)]">Results are released. Withhold them to give extra time or reset an attempt.</p>}

        {makeupFor && <MakeupDialog data={data} exam={exam} preselect={makeupFor} onClose={() => setMakeupFor(null)} />}
        <AlertDialog open={!!reopen} onOpenChange={(o) => !o && setReopen(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-serif text-2xl">Let {reopen?.name} carry on?</AlertDialogTitle>
              <AlertDialogDescription>Use this when their exam closed early, for example the internet or the computer failed. They continue from where they stopped with every answer kept, and get the extra time you choose. Any marks already given for this script are cleared and worked out again when they submit.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Extra time">
              {[10, 15, 20, 30, 45].map((m) => <button key={m} type="button" role="radio" aria-checked={reopenMinutes === m} onClick={() => setReopenMinutes(m)} className={"rounded-full border px-3 py-1 text-sm font-semibold " + (reopenMinutes === m ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald))] text-white" : "border-[hsl(var(--p-line))]")} data-testid={"reopen-minutes-" + m}>{m} min</button>)}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction data-testid="button-confirm-reopen" onClick={() => { if (reopen?.attempt) void cmd.run({ action: "reopenAttempt", attemptControl: { attemptId: reopen.attempt.id, minutes: reopenMinutes } }, `${reopen.name} can carry on for ${reopenMinutes} minutes`); setReopen(null); }}>Reopen for {reopenMinutes} minutes</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog open={!!reset} onOpenChange={(o) => !o && setReset(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-serif text-2xl">Reset {reset?.name}'s attempt?</AlertDialogTitle>
              <AlertDialogDescription>Their answers and marks for this exam are deleted permanently. They can start again only while the exam is open.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction data-testid="button-confirm-reset" onClick={() => { if (reset?.attempt) void cmd.run({ action: "resetAttempt", attemptControl: { attemptId: reset.attempt.id } }, "Attempt reset"); setReset(null); }}>Reset attempt</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
