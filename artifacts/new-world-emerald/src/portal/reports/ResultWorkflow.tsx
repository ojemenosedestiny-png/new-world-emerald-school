import { useState } from "react";
import type { ReportWorkspace, ReportTerm, ReportWorkflowStatus } from "@workspace/api-client-react";
import { Check, CheckCircle2, EyeOff, PenLine, Send, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { termLabel } from "./reportCard";
import { useReportCommand } from "./useReportCommand";

const STEPS: { key: ReportWorkflowStatus; label: string; short: string }[] = [
  { key: "draft", label: "Draft", short: "Draft" }, { key: "review", label: "Teacher review", short: "Review" },
  { key: "approved", label: "Principal approval", short: "Approval" }, { key: "published", label: "Published", short: "Published" },
];
const SUMMARY: Record<ReportWorkflowStatus, string> = {
  draft: "Teachers enter scores and remarks. When everything is in, the class teacher reviews the results, signs and sends them for approval.",
  review: "The class teacher has reviewed and signed. Waiting for the principal or school office to approve.",
  approved: "Approved and signed by the principal. Publish to let students view and download their results.",
  published: "Students in this class can view and download their results. Scores and remarks are locked.",
};

/** Result sheets are editable only in draft (the office may still correct them while they wait for approval). */
export function resultsLocked(ws: ReportWorkspace) {
  const status = ws.workflow.status;
  return status === "approved" || status === "published" || (status === "review" && !ws.canAdmin);
}

type Action = "submit" | "withdraw" | "approve" | "return" | "publish" | "unpublish";

/** Where this class's results are, and the next step for the signed-in staff member. */
export function WorkflowBar({ ws, term, className, missing, onOpenSettings }: { ws: ReportWorkspace; term: ReportTerm; className: string; missing: number; onOpenSettings: () => void }) {
  const cmd = useReportCommand();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const w = ws.workflow;
  const at = STEPS.findIndex((s) => s.key === w.status);
  const run = async (action: Action) => {
    const ok = await cmd.run({ action: "workflow", workflow: { termId: term.id, classId: ws.classId!, action, ...(action === "return" && note.trim() ? { note: note.trim() } : {}) } }, {
      submit: "Sent for approval", withdraw: "Taken back to draft", approve: "Results approved", return: "Returned to the class teacher", publish: "Results published", unpublish: "Results unpublished",
    }[action]);
    if (ok) { setConfirm(null); setNote(""); }
  };
  const setMode = (mode: "automatic" | "manual") => cmd.run({ action: "setMode", mode: { termId: term.id, classId: ws.classId!, mode } }, mode === "manual" ? "Manual results on" : "Automatic results on");
  const needsSignature = !ws.canAdmin && !ws.mySignature;

  const copy: Record<Action, { title: string; body: string; cta: string }> = {
    submit: { title: "Review, sign and send for approval?", body: `Your signature is added to every ${className} result for ${termLabel(term)}.${missing ? ` ${missing} students are still missing some subject scores.` : ""} Scores and remarks lock while the principal reviews them.`, cta: "Sign and send" },
    withdraw: { title: "Take the results back?", body: "They return to draft so you can make changes. You will need to send them again.", cta: "Take back" },
    approve: { title: "Approve these results?", body: `The principal's signature is added to ${className}'s results. You can publish them next.`, cta: "Approve" },
    return: { title: "Return to the class teacher?", body: "The results go back to draft with your note, so the teacher can correct them.", cta: "Return" },
    publish: { title: "Publish to students?", body: `Every student in ${className} will be able to view and download their ${termLabel(term)} result.`, cta: "Publish" },
    unpublish: { title: "Unpublish these results?", body: "Students will no longer see them. They stay approved, so you can publish again.", cta: "Unpublish" },
  };
  const buttons: { action: Action; label: string; icon: typeof Send; primary?: boolean }[] = [];
  if (w.status === "draft") buttons.push({ action: "submit", label: "Review and sign", icon: PenLine, primary: true });
  if (w.status === "review") {
    buttons.push({ action: "withdraw", label: "Take back", icon: Undo2 });
    if (ws.canAdmin) buttons.push({ action: "return", label: "Return to teacher", icon: Undo2 }, { action: "approve", label: "Approve", icon: CheckCircle2, primary: true });
  }
  if (w.status === "approved" && ws.canAdmin) buttons.push({ action: "return", label: "Return to draft", icon: Undo2 }, { action: "publish", label: "Publish to students", icon: Send, primary: true });
  if (w.status === "published" && ws.canAdmin) buttons.push({ action: "unpublish", label: "Unpublish", icon: EyeOff });

  return (
    <div className={"portal-card space-y-4 p-4 " + (w.status === "published" ? "border-l-4 border-l-[hsl(var(--p-emerald))]" : "")} data-testid="bar-workflow">
      <ol className="grid grid-cols-4 gap-1" aria-label="Result stages">
        {STEPS.map((s, i) => (
          <li key={s.key} className="min-w-0" aria-current={i === at ? "step" : undefined} data-testid={"workflow-step-" + s.key}>
            <div className={"h-1.5 rounded-full " + (i <= at ? "bg-[hsl(var(--p-emerald))]" : "bg-[hsl(var(--p-line))]")} />
            <p className={"mt-1.5 flex items-center gap-1 truncate text-[11px] font-semibold sm:text-xs " + (i === at ? "text-[hsl(var(--p-emerald))]" : i < at ? "" : "text-[hsl(var(--p-ink)/0.45)]")}>
              {i < at && <Check size={12} aria-hidden="true" />}<span className="sm:hidden">{s.short}</span><span className="hidden sm:inline">{s.label}</span>
            </p>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1 text-sm">
          <p className="text-[hsl(var(--p-ink)/0.75)]" data-testid="text-workflow-summary">{SUMMARY[w.status]}</p>
          {w.status === "draft" && w.returnNote && <p className="mt-1.5 rounded-lg bg-[hsl(var(--p-gold-soft)/0.7)] px-3 py-1.5 text-xs font-semibold" data-testid="text-return-note">Returned: {w.returnNote}</p>}
          {w.teacherName && w.status !== "draft" && <p className="mt-1 text-xs text-[hsl(var(--p-ink)/0.6)]">Signed by {w.teacherName}{w.submittedAt ? `, ${new Date(w.submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}{w.approvedBy && (w.status === "approved" || w.status === "published") ? ` · Approved by ${w.approvedBy}` : ""}</p>}
          {w.status === "draft" && !ws.subjects.length && <p className="mt-1 text-xs font-semibold text-[hsl(var(--p-gold-ink))]" data-testid="text-no-subjects">No subjects yet: add the class's subjects before entering scores.</p>}
          {w.status === "draft" && ws.subjects.length > 0 && !missing && ws.students.length > 0 && <p className="mt-1 text-xs font-semibold text-[hsl(var(--p-emerald))]">All students have scores for every subject.</p>}
          {w.status === "draft" && missing > 0 && <p className="mt-1 text-xs text-[hsl(var(--p-ink)/0.6)]">{missing} of {ws.students.length} students are missing one or more subject scores.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {w.status === "draft" && (
            <div className="inline-flex rounded-xl border border-[hsl(var(--p-line))] p-0.5 text-xs" role="group" aria-label="How results are prepared">
              {(["automatic", "manual"] as const).map((m) => (
                <button key={m} type="button" aria-pressed={w.mode === m} disabled={cmd.pending} onClick={() => w.mode !== m && void setMode(m)} title={m === "automatic" ? "Totals, grades and positions are calculated from CA and exam" : "Teachers may type totals and grades"}
                  className={"rounded-lg px-2.5 py-1.5 font-semibold " + (w.mode === m ? "bg-[hsl(var(--p-ink))] text-[hsl(var(--p-paper))]" : "")} data-testid={"mode-" + m}>{m === "automatic" ? "Automatic" : "Manual"}</button>
              ))}
            </div>
          )}
          {buttons.map((b) => (
            <button key={b.action} className={b.primary ? "portal-btn" : "portal-btn-ghost"} disabled={cmd.pending || (b.action === "submit" && !ws.ranked)} onClick={() => (b.action === "submit" && needsSignature ? onOpenSettings() : setConfirm(b.action))} data-testid={"button-workflow-" + b.action}>
              <b.icon size={14} /> {b.action === "submit" && needsSignature ? "Add your signature first" : b.label}
            </button>
          ))}
        </div>
      </div>

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="portal !min-h-0 max-w-md rounded-2xl">
          {confirm && (<>
            <DialogHeader><DialogTitle className="font-serif text-2xl">{copy[confirm].title}</DialogTitle><DialogDescription>{copy[confirm].body}</DialogDescription></DialogHeader>
            {confirm === "submit" && ws.mySignature && <img src={ws.mySignature} alt="Your signature" className="mx-auto max-h-16 rounded-lg border border-[hsl(var(--p-line))] bg-white p-2" />}
            {confirm === "approve" && !ws.principalSignature && <p className="rounded-lg bg-[hsl(var(--p-gold-soft)/0.7)] px-3 py-2 text-sm">No principal's signature is saved yet. Add it in the Settings tab so it prints on the results.</p>}
            {confirm === "return" && <textarea className="portal-input min-h-[80px]" maxLength={500} placeholder="What should the teacher correct?" value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-return-note" />}
            <DialogFooter className="gap-2">
              <button className="portal-btn-ghost" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="portal-btn" disabled={cmd.pending} onClick={() => void run(confirm)} data-testid="button-confirm-workflow">{cmd.pending ? "Working..." : copy[confirm].cta}</button>
            </DialogFooter>
          </>)}
        </DialogContent>
      </Dialog>
    </div>
  );
}
