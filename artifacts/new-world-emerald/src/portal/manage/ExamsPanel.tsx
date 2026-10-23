import { useState } from "react";
import type { PortalManagement, PortalExam } from "@workspace/api-client-react";
import { ClipboardList, Eye, EyeOff, FileText, Lock, Pencil, Plus, Send, Undo2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { EmptyState, StatusPill } from "../ui";
import { fileUrl, formatDateTime } from "../lib";
import { ExamEditor, blankExam } from "./ExamEditor";
import { className, useCommand } from "./useCommand";

type Pending = { id: number; published: boolean; resultsReleased: boolean; label: string; body: string } | null;

export function ExamsPanel({ data }: { data: PortalManagement }) {
  const cmd = useCommand();
  const [editing, setEditing] = useState<PortalExam | null>(null);
  const [confirm, setConfirm] = useState<Pending>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button className="portal-btn" disabled={!data.classes.length} onClick={() => setEditing(blankExam(data.classes[0]?.id ?? 0))} data-testid="button-add-exam"><Plus size={15} /> New exam</button></div>
      {data.exams.length === 0 ? <EmptyState icon={<ClipboardList size={22} />} title="No exams yet" body="Build an exam on screen, or upload a PDF paper and add answer slots. Students see it only after you publish." /> : (
        <div className="space-y-3">{data.exams.map((e) => {
          const attempts = data.attempts.filter((a) => a.examId === e.id);
          const started = attempts.length > 0;
          const submitted = attempts.filter((a) => a.status !== "in_progress");
          const unmarked = submitted.filter((a) => a.status === "submitted").length;
          const id = e.id as number;
          return (
            <article key={id} className="portal-card p-5" data-testid={"card-exam-" + id}>
              <div className="flex flex-col gap-4 md:flex-row md:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={e.published ? "green" : "muted"}>{e.published ? "Published" : "Draft"}</StatusPill>
                    {e.resultsReleased && <StatusPill tone="ink">Results released</StatusPill>}
                    {started && <StatusPill tone="gold"><Lock size={10} /> Content frozen</StatusPill>}
                    <span className="text-xs text-[hsl(var(--p-ink)/0.55)]">{className(data.classes, e.classId)} / {e.subject} / {e.mode === "pdf" ? "PDF paper" : "Interactive"}</span>
                  </div>
                  <h3 className="mt-2 font-serif text-xl font-semibold">{e.title}</h3>
                  <p className="mt-1 text-sm text-[hsl(var(--p-ink)/0.6)]">{formatDateTime(e.startsAt)} to {formatDateTime(e.endsAt)} / {e.durationMinutes} min / {e.questions.length} questions</p>
                  <p className="mt-1 text-sm text-[hsl(var(--p-ink)/0.6)]">{attempts.length} started / {submitted.length} submitted / {unmarked} awaiting marking</p>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  {!started && <button className="portal-btn-ghost" onClick={() => setEditing({ ...e, questions: e.questions.map((q) => ({ ...q, options: [...q.options] })) })} data-testid={"button-edit-exam-" + id}><Pencil size={13} /> Edit</button>}
                  {e.fileId && <a className="portal-btn-ghost" href={fileUrl(e.fileId)} target="_blank" rel="noreferrer"><FileText size={13} /> Paper</a>}
                  {started && (e.published
                    ? <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => setConfirm({ id, published: false, resultsReleased: e.resultsReleased, label: "Hide this exam?", body: "Students will no longer see it on their dashboard. Existing attempts are kept." })} data-testid={"button-hide-exam-" + id}><EyeOff size={13} /> Hide</button>
                    : <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => setConfirm({ id, published: true, resultsReleased: e.resultsReleased, label: "Publish this exam again?", body: "Students in the class will see it again." })} data-testid={"button-publish-exam-" + id}><Eye size={13} /> Publish</button>)}
                  {!started && e.published && <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => setConfirm({ id, published: false, resultsReleased: false, label: "Unpublish this exam?", body: "It returns to draft and students will no longer see it." })} data-testid={"button-unpublish-exam-" + id}><EyeOff size={13} /> Unpublish</button>}
                  {!started && !e.published && <button className="portal-btn-ghost" onClick={() => setEditing({ ...e, published: true })} data-testid={"button-review-publish-" + id}><Eye size={13} /> Review and publish</button>}
                  {submitted.length > 0 && (e.resultsReleased
                    ? <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => setConfirm({ id, published: e.published, resultsReleased: false, label: "Withhold results?", body: "Students will see their result as pending again." })} data-testid={"button-withhold-" + id}><Undo2 size={13} /> Withhold results</button>
                    : <button className="portal-btn-gold portal-btn !py-1.5 text-[13px]" disabled={cmd.pending || unmarked > 0} title={unmarked ? "Mark every submitted attempt first" : undefined} onClick={() => setConfirm({ id, published: e.published, resultsReleased: true, label: "Release results?", body: "Every student who submitted will see their score and feedback." })} data-testid={"button-release-" + id}><Send size={13} /> Release results</button>)}
                </div>
              </div>
              {started && <p className="mt-3 text-xs text-[hsl(var(--p-ink)/0.5)]">A student has started this exam, so questions and settings can no longer change. Use publish and results controls only.</p>}
            </article>
          );
        })}</div>
      )}
      {editing && <ExamEditor data={data} initial={editing} onClose={() => setEditing(null)} />}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle className="font-serif text-2xl">{confirm?.label}</AlertDialogTitle><AlertDialogDescription>{confirm?.body}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-status" onClick={() => { if (confirm) void cmd.run({ action: "examStatus", examStatus: { id: confirm.id, published: confirm.published, resultsReleased: confirm.resultsReleased } }, "Exam status updated"); setConfirm(null); }}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
