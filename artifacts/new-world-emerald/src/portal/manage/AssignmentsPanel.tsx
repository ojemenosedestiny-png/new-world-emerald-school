import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListStaffAssignments, getListStaffAssignmentsQueryKey, useCreateAssignment, useUpdateAssignment, useDeleteAssignment,
  useListAssignmentSubmissions, getListAssignmentSubmissionsQueryKey, useMarkSubmission,
  type AssignmentInput, type PortalManagement, type StaffAssignment, type SubmissionRow,
} from "@workspace/api-client-react";
import { ArrowLeft, CalendarClock, ClipboardCheck, NotebookPen, Pencil, Plus, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Field, Skeleton, StatusPill } from "../ui";
import { errorMessage } from "../lib";
import { imageUrl } from "../photos";
import { ClassSelect } from "./ClassSelect";
import { fromLocalInput, toLocalInput } from "./EventsPanel";

type Form = AssignmentInput & { id?: number };
const when = (iso: string) => new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function MarkRow({ row, maxScore, assignmentId }: { row: SubmissionRow; maxScore: number; assignmentId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mark = useMarkSubmission();
  const s = row.submission;
  const [score, setScore] = useState(s?.score?.toString() ?? "");
  const [feedback, setFeedback] = useState(s?.feedback ?? "");
  const value = Number(score);
  const valid = score.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= maxScore;
  const save = async () => {
    if (!s) return;
    try {
      await mark.mutateAsync({ id: s.id, data: { score: value, feedback } });
      toast({ title: `Marked ${row.name}` });
      await queryClient.invalidateQueries({ queryKey: getListAssignmentSubmissionsQueryKey(assignmentId) });
      await queryClient.invalidateQueries({ queryKey: getListStaffAssignmentsQueryKey() });
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); }
  };
  return (
    <li className="p-4" data-testid={`submission-row-${row.studentId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">{row.name}</p>
        <span className="font-mono text-xs text-[hsl(var(--p-ink)/0.55)]">{row.studentCode}</span>
        {!s ? <StatusPill tone="muted">Not submitted</StatusPill> : s.markedAt ? <StatusPill tone="green">Marked {s.score}/{maxScore}</StatusPill> : <StatusPill tone="gold">Submitted</StatusPill>}
        {s?.late && <StatusPill tone="red">Late</StatusPill>}
        {s && <span className="text-xs text-[hsl(var(--p-ink)/0.55)]">{when(s.submittedAt)}</span>}
      </div>
      {s && (
        <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_16rem]">
          <div>
            {s.text && <p className="whitespace-pre-wrap rounded-xl bg-[hsl(var(--p-paper-2)/0.6)] p-3 text-sm">{s.text}</p>}
            {s.imageIds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {s.imageIds.map((id, i) => (
                  <a key={id} href={imageUrl(id)} target="_blank" rel="noreferrer" aria-label={`Open photo ${i + 1} from ${row.name}`}>
                    <img src={imageUrl(id)} alt="" loading="lazy" className="h-20 w-20 rounded-lg border border-[hsl(var(--p-line))] object-cover" />
                  </a>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold">Score
              <input inputMode="decimal" className="portal-input !w-24 !py-1.5" value={score} onChange={(e) => setScore(e.target.value)} data-testid={`input-score-${row.studentId}`} />
              <span className="text-[hsl(var(--p-ink)/0.6)]">/ {maxScore}</span>
            </label>
            <textarea className="portal-input min-h-[70px] text-sm" placeholder="Feedback for the student" maxLength={2000} value={feedback} onChange={(e) => setFeedback(e.target.value)} data-testid={`input-feedback-${row.studentId}`} />
            <button className="portal-btn w-full justify-center" disabled={!valid || mark.isPending} onClick={() => void save()} data-testid={`button-mark-${row.studentId}`}>{mark.isPending ? "Saving..." : s.markedAt ? "Update mark" : "Save mark"}</button>
          </div>
        </div>
      )}
    </li>
  );
}

function Submissions({ assignment, onBack }: { assignment: StaffAssignment; onBack: () => void }) {
  const rows = useListAssignmentSubmissions(assignment.id, { query: { queryKey: getListAssignmentSubmissionsQueryKey(assignment.id) } });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="portal-btn-ghost" onClick={onBack} data-testid="button-back-assignments"><ArrowLeft size={15} /> Assignments</button>
        <div className="min-w-0 flex-1"><p className="truncate font-serif text-xl font-semibold">{assignment.title}</p><p className="text-xs text-[hsl(var(--p-ink)/0.6)]">{assignment.className} · {assignment.subject} · due {when(assignment.dueAt)}</p></div>
      </div>
      {rows.isLoading ? <Skeleton className="h-48" /> : rows.isError || !rows.data ? <ErrorPanel title="Submissions did not load" message={errorMessage(rows.error)} onRetry={() => rows.refetch()} />
        : <ul className="portal-card divide-y divide-[hsl(var(--p-line))] overflow-hidden" data-testid="list-submissions">{rows.data.map((r) => <MarkRow key={r.studentId} row={r} maxScore={assignment.maxScore} assignmentId={assignment.id} />)}</ul>}
    </div>
  );
}

/** Set, publish and mark class assignments (administrators and class teachers). */
export function AssignmentsPanel({ data }: { data: PortalManagement }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const list = useListStaffAssignments({ query: { queryKey: getListStaffAssignmentsQueryKey() } });
  const create = useCreateAssignment();
  const update = useUpdateAssignment();
  const remove = useDeleteAssignment();
  const [form, setForm] = useState<Form | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<StaffAssignment | null>(null);
  const pending = create.isPending || update.isPending || remove.isPending;
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListStaffAssignmentsQueryKey() });
  const blank = (): Form => {
    const due = new Date(Date.now() + 7 * 86_400_000); due.setHours(16, 0, 0, 0);
    return { classId: data.classes[0]?.id ?? 0, subject: "", title: "", instructions: "", dueAt: due.toISOString(), maxScore: 10, published: true };
  };
  const save = async () => {
    if (!form) return;
    const { id, ...body } = form;
    try {
      if (id) await update.mutateAsync({ id, data: body }); else await create.mutateAsync({ data: body });
      toast({ title: id ? "Assignment updated" : body.published ? "Assignment published" : "Draft saved" });
      setForm(null);
      await refresh();
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); }
  };
  const confirmDelete = async (a: StaffAssignment) => {
    try { await remove.mutateAsync({ id: a.id }); toast({ title: "Assignment deleted" }); await refresh(); }
    catch (e) { toast({ variant: "destructive", title: "Not deleted", description: errorMessage(e) }); }
  };

  if (list.isError) return <ErrorPanel title="Assignments did not load" message={errorMessage(list.error)} onRetry={() => list.refetch()} />;
  const open = list.data?.find((a) => a.id === openId);
  if (open) return <Submissions assignment={open} onBack={() => setOpenId(null)} />;
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-[hsl(var(--p-ink)/0.65)]">Students see published assignments in their portal, submit an answer or photos of their work, and get your score and feedback.</p>
        <button className="portal-btn shrink-0" disabled={!data.classes.length} onClick={() => setForm(blank())} data-testid="button-add-assignment"><Plus size={15} /> New assignment</button>
      </div>
      {list.isLoading ? <Skeleton className="h-40" /> : (list.data ?? []).length === 0
        ? <EmptyState icon={<NotebookPen size={22} />} title="No assignments yet" body="Set homework or class work for a class. Students are told in their portal." />
        : (
          <div className="space-y-3">{list.data!.map((a) => {
            const overdue = new Date(a.dueAt).getTime() < Date.now();
            return (
              <div key={a.id} className="portal-card flex flex-col gap-3 p-5 sm:flex-row sm:items-start" data-testid={`card-assignment-${a.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><StatusPill tone={a.published ? "green" : "muted"}>{a.published ? "Published" : "Draft"}</StatusPill><span className="text-xs text-[hsl(var(--p-ink)/0.6)]">{a.className} · {a.subject}</span></div>
                  <p className="mt-1.5 font-serif text-lg font-semibold">{a.title}</p>
                  <p className={"mt-0.5 flex items-center gap-1 text-xs " + (overdue ? "text-[hsl(var(--p-red))]" : "text-[hsl(var(--p-ink)/0.6)]")}><CalendarClock size={12} /> Due {when(a.dueAt)} · out of {a.maxScore}</p>
                  <p className="mt-1 text-xs text-[hsl(var(--p-ink)/0.6)]" data-testid={`text-assignment-counts-${a.id}`}>{a.submitted} of {a.students} submitted · {a.marked} marked</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="portal-btn" onClick={() => setOpenId(a.id)} data-testid={`button-open-submissions-${a.id}`}><ClipboardCheck size={14} /> Mark</button>
                  <button className="portal-btn-ghost" onClick={() => setForm({ id: a.id, classId: a.classId, subject: a.subject, title: a.title, instructions: a.instructions, dueAt: a.dueAt, maxScore: a.maxScore, published: a.published })} data-testid={`button-edit-assignment-${a.id}`}><Pencil size={13} /> Edit</button>
                  <button className="portal-btn-ghost" disabled={pending} onClick={() => setDeleting(a)} data-testid={`button-delete-assignment-${a.id}`}><Trash2 size={13} /> Delete</button>
                </div>
              </div>
            );
          })}</div>
        )}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="portal !min-h-0 max-h-[92vh] max-w-lg overflow-y-auto rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">{form?.id ? "Edit assignment" : "New assignment"}</DialogTitle><DialogDescription>Published assignments appear in the class's student portal.</DialogDescription></DialogHeader>
          {form && <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Class" htmlFor="as-class"><ClassSelect id="as-class" classes={data.classes} value={form.classId} onChange={(v) => setForm({ ...form, classId: v })} /></Field>
              <Field label="Subject" htmlFor="as-subject"><input id="as-subject" className="portal-input" maxLength={80} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} data-testid="input-assignment-subject" /></Field>
            </div>
            <Field label="Title" htmlFor="as-title"><input id="as-title" className="portal-input" maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-assignment-title" /></Field>
            <Field label="Instructions" htmlFor="as-instructions"><textarea id="as-instructions" className="portal-input min-h-[120px]" maxLength={5000} value={form.instructions ?? ""} onChange={(e) => setForm({ ...form, instructions: e.target.value })} data-testid="input-assignment-instructions" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Due" htmlFor="as-due"><input id="as-due" type="datetime-local" className="portal-input" value={toLocalInput(form.dueAt, false)} onChange={(e) => setForm({ ...form, dueAt: fromLocalInput(e.target.value, false) ?? form.dueAt })} data-testid="input-assignment-due" /></Field>
              <Field label="Marked out of" htmlFor="as-max"><input id="as-max" type="number" min={1} max={1000} className="portal-input" value={form.maxScore} onChange={(e) => setForm({ ...form, maxScore: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) })} data-testid="input-assignment-max" /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} data-testid="checkbox-assignment-published" /> Published (students can see it)</label>
          </div>}
          <DialogFooter><button className="portal-btn" onClick={() => void save()} disabled={pending || !form?.title.trim() || !form?.subject.trim() || !form?.classId} data-testid="button-save-assignment">{pending ? "Saving..." : "Save assignment"}</button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle className="font-serif text-2xl">Delete "{deleting?.title}"?</AlertDialogTitle><AlertDialogDescription>The assignment and all {deleting?.submitted ?? 0} submissions, including photos and marks, are deleted permanently.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-delete-assignment" onClick={() => { if (deleting) void confirmDelete(deleting); setDeleting(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
