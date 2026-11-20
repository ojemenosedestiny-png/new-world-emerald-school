import { useState } from "react";
import { useRecordExamAccess, type PortalManagement, type PortalExam } from "@workspace/api-client-react";
import { BarChart3, CalendarClock, ClipboardList, Clock3, Copy, Eye, EyeOff, FileText, Folder, FolderOpen, Library, Lock, Pencil, Plus, Send, Sparkles, Trash2, Undo2, Users } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { EmptyState, StatusPill } from "../ui";
import { examFolders, examTimeline, fileUrl, formatDateTime, type ExamGroupKey } from "../lib";
import { ExamEditor, blankExam } from "./ExamEditor";
import { ExamResults } from "./ExamResults";
import { className, useCommand } from "./useCommand";

const clock = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit" }).format(d); };
const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();
const GROUP_TONE: Record<ExamGroupKey, string> = {
  open: "bg-[hsl(var(--p-emerald))] text-white",
  upcoming: "bg-[hsl(var(--p-gold-soft))] text-[hsl(var(--p-gold-ink))]",
  finished: "bg-[hsl(var(--p-ink)/0.08)] text-[hsl(var(--p-ink)/0.7)]",
};

/** The exam's day and time, set like a calendar leaf. */
function DateLeaf({ startsAt, endsAt, tone }: { startsAt: string; endsAt: string; tone: ExamGroupKey }) {
  const d = new Date(startsAt);
  const ok = !Number.isNaN(d.getTime());
  const fmt = (o: Intl.DateTimeFormatOptions) => (ok ? new Intl.DateTimeFormat("en-NG", o).format(d) : "");
  return (
    <div className={"flex w-full shrink-0 items-center gap-3 rounded-xl border p-3 sm:w-28 sm:flex-col sm:gap-0 sm:p-0 sm:pb-2 sm:text-center " + (tone === "open" ? "border-[hsl(var(--p-emerald)/0.35)]" : "border-[hsl(var(--p-line))]")} aria-hidden="true">
      <span className={"rounded-lg px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] sm:w-full sm:rounded-none sm:rounded-t-xl sm:py-1 " + GROUP_TONE[tone]}>{fmt({ month: "short" })}</span>
      <span className="font-serif text-3xl font-semibold leading-none sm:mt-2">{fmt({ day: "numeric" })}</span>
      <span className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--p-ink)/0.6)]">{fmt({ weekday: "short" })}</span>
      <span className="ml-auto text-xs font-semibold tabular-nums sm:ml-0 sm:mt-1.5">{clock(startsAt)}</span>
      {sameDay(startsAt, endsAt) && <span className="text-[11px] tabular-nums text-[hsl(var(--p-ink)/0.55)]">to {clock(endsAt)}</span>}
    </div>
  );
}

type Pending = { id: number; published: boolean; resultsReleased: boolean; label: string; body: string } | null;

/** A fresh draft copy: unpublished, results withheld, rescheduled to the default future window. */
export function duplicateExam(e: PortalExam): PortalExam {
  const { id: _id, ...rest } = e;
  const window = blankExam(e.classId);
  return {
    ...rest, title: (e.title + " (copy)").slice(0, 200), published: false, resultsReleased: false,
    startsAt: window.startsAt, endsAt: window.endsAt,
    questions: e.questions.map((q) => ({ ...q, options: [...q.options] })),
  };
}

/** `canClear`: the school owner may also delete exams students have taken (test exams), with their attempts and scores. */
export function ExamsPanel({ data, isAdmin = false, canClear = false }: { data: PortalManagement; isAdmin?: boolean; canClear?: boolean }) {
  const cmd = useCommand();
  // Teachers may set exams for any class; the exams they set elsewhere show here too.
  const examClasses = data.examClasses?.length ? data.examClasses : data.classes;
  const [editing, setEditing] = useState<PortalExam | null>(null);
  const [confirm, setConfirm] = useState<Pending>(null);
  const [resultsFor, setResultsFor] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<{ id: number; title: string; attempts: number } | null>(null);
  const [typed, setTyped] = useState("");
  const resultsExam = data.exams.find((e) => e.id === resultsFor);
  // With an exam officer, staff send exams to be published; opening, copying or downloading questions is recorded for them.
  const officer = !!data.examOfficer;
  const access = useRecordExamAccess();
  const record = (id: number, kind: "open" | "copy" | "pdf") => { access.mutate({ examId: id, data: { kind } }); };
  // Filed by year (Year 1, JSS 1, SS 2...), each folder holding every arm; inside, in date and time order.
  const folders = examFolders(data.exams, (id) => className(examClasses, id));
  const [folderKey, setFolderKey] = useState("all");
  const folder = folders.find((f) => f.key === folderKey) ?? null;
  const timeline = examTimeline(folder ? folder.exams : data.exams);
  const openNow = folders.reduce((n, f) => n + f.open, 0);
  const tile = (active: boolean) => "group flex min-h-[112px] flex-col rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--p-emerald))] "
    + (active ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald))] text-[hsl(var(--p-paper))] shadow-md" : "border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface))] hover:border-[hsl(var(--p-emerald)/0.5)] hover:shadow-sm");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        {isAdmin && <button className="portal-btn-ghost" disabled={cmd.pending || !data.classes.length} onClick={() => void cmd.run({ action: "addPracticeExams" }, "Practice CBT")} title="Adds a published 15-minute practice test, open for 7 days, to every class" data-testid="button-add-practice-exams"><Sparkles size={15} /> Add practice CBT to every class</button>}
        <button className="portal-btn" disabled={!examClasses.length} onClick={() => setEditing(blankExam(data.classes[0]?.id ?? examClasses[0]?.id ?? 0))} data-testid="button-add-exam"><Plus size={15} /> New exam</button></div>
      {data.exams.length > 0 && (
        <nav aria-label="Exam folders by year" className="rounded-3xl border border-[hsl(var(--p-line))] bg-[hsl(var(--p-paper-2)/0.5)] p-4 sm:p-5" data-testid="exam-folders">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-serif text-xl font-semibold">Exam folders</h3>
            <p className="text-xs text-[hsl(var(--p-ink)/0.6)]">One folder for each year. Every arm (A, B, C) is filed in its year.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            <button type="button" aria-pressed={!folder} className={tile(!folder)} onClick={() => setFolderKey("all")} data-testid="folder-all">
              <Library size={20} aria-hidden className={!folder ? "" : "text-[hsl(var(--p-emerald))]"} />
              <span className="mt-2 font-serif text-lg font-semibold leading-tight">All exams</span>
              <span className={"mt-auto pt-1 text-xs " + (!folder ? "text-[hsl(var(--p-paper)/0.8)]" : "text-[hsl(var(--p-ink)/0.6)]")}>{data.exams.length} {data.exams.length === 1 ? "exam" : "exams"}{openNow ? ` · ${openNow} open now` : ""}</span>
            </button>
            {folders.map((f) => {
              const active = folder?.key === f.key;
              const Icon = active ? FolderOpen : Folder;
              return (
                <button key={f.key} type="button" aria-pressed={active} className={tile(active)} onClick={() => setFolderKey(f.key)} data-testid={"folder-" + f.key}>
                  <span className="flex items-start justify-between gap-2">
                    <Icon size={20} aria-hidden className={active ? "" : "text-[hsl(var(--p-gold))]"} />
                    {f.open > 0 && <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide " + (active ? "bg-[hsl(var(--p-paper)/0.2)]" : "bg-[hsl(var(--p-emerald-soft))] text-[hsl(var(--p-emerald))]")}>{f.open} open</span>}
                  </span>
                  <span className="mt-2 font-serif text-lg font-semibold leading-tight">{f.label}</span>
                  <span className={"line-clamp-1 text-[11px] " + (active ? "text-[hsl(var(--p-paper)/0.75)]" : "text-[hsl(var(--p-ink)/0.5)]")} title={f.arms.join(", ")}>{f.arms.join(" · ")}</span>
                  <span className={"mt-auto pt-1 text-xs " + (active ? "text-[hsl(var(--p-paper)/0.85)]" : "text-[hsl(var(--p-ink)/0.6)]")}>{f.exams.length} {f.exams.length === 1 ? "exam" : "exams"}{f.upcoming ? ` · ${f.upcoming} coming up` : ""}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
      {folder && (
        <div className="flex flex-wrap items-center gap-3" data-testid="exam-folder-heading">
          <FolderOpen size={22} className="text-[hsl(var(--p-gold))]" aria-hidden />
          <h3 className="font-serif text-2xl font-semibold">{folder.label} exams</h3>
          <span className="text-sm text-[hsl(var(--p-ink)/0.6)]">{folder.arms.join(", ")}</span>
          <button type="button" className="portal-btn-ghost ml-auto !py-1 text-xs" onClick={() => setFolderKey("all")}>Show all exams</button>
        </div>
      )}
      {data.exams.length === 0 ? <EmptyState icon={<ClipboardList size={22} />} title="No exams yet" body="Build an exam on screen, or upload a PDF paper and add answer slots. Students see it only after you publish." /> : (
        <div className="space-y-8">{timeline.map((group) => (
          <section key={group.key} aria-labelledby={"exams-" + group.key} data-testid={"exam-group-" + group.key}>
            <div className="mb-3 flex items-center gap-3">
              <h3 id={"exams-" + group.key} className="font-serif text-2xl font-semibold">{group.label}</h3>
              <span className={"rounded-full px-2.5 py-0.5 text-xs font-bold " + GROUP_TONE[group.key]}>{group.count}</span>
              <span className="h-px flex-1 bg-[hsl(var(--p-line))]" />
            </div>
            <div className="space-y-5">{group.days.map((day) => (
              <div key={day.day || "none"}>
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-[hsl(var(--p-ink)/0.55)]" data-testid="exam-day-heading">{day.heading}</p>
                <div className="space-y-3">{day.exams.map((e) => {
                  const tone = group.key;
                  const attempts = data.attempts.filter((a) => a.examId === e.id);
                  const started = attempts.length > 0;
                  const submitted = attempts.filter((a) => a.status !== "in_progress");
                  const unmarked = submitted.filter((a) => a.status === "submitted").length;
                  const id = e.id as number;
                  return (
                    <article key={id} className={"portal-card p-4 transition-shadow hover:shadow-md sm:p-5 " + (tone === "open" ? "ring-1 ring-[hsl(var(--p-emerald)/0.35)]" : "")} data-testid={"card-exam-" + id}>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                        <DateLeaf startsAt={e.startsAt} endsAt={e.endsAt} tone={tone} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusPill tone={e.published ? "green" : e.reviewStatus === "submitted" ? "gold" : e.reviewStatus === "returned" ? "red" : "muted"}>{e.published ? "Published" : e.reviewStatus === "submitted" ? "Waiting for the exam officer" : e.reviewStatus === "returned" ? "Returned by the exam officer" : "Draft"}</StatusPill>
                            {e.resultsReleased && <StatusPill tone="ink">Results released</StatusPill>}
                            {started && <StatusPill tone="gold"><Lock size={10} /> Content frozen</StatusPill>}
                            <span className="text-xs text-[hsl(var(--p-ink)/0.55)]">{className(examClasses, e.classId)} / {e.subject} / {e.mode === "pdf" ? "PDF paper" : "Interactive"}</span>
                          </div>
                          <h3 className="mt-2 font-serif text-xl font-semibold">{e.title}</h3>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[hsl(var(--p-ink)/0.65)]">
                            <span className="inline-flex items-center gap-1.5"><CalendarClock size={14} className="text-[hsl(var(--p-emerald))]" /> {formatDateTime(e.startsAt)} to {sameDay(e.startsAt, e.endsAt) ? clock(e.endsAt) : formatDateTime(e.endsAt)}</span>
                            <span className="inline-flex items-center gap-1.5"><Clock3 size={14} className="text-[hsl(var(--p-emerald))]" /> {e.durationMinutes} min / {e.questions.length} {e.questions.length === 1 ? "question" : "questions"}</span>
                            <span className="inline-flex items-center gap-1.5"><Users size={14} className="text-[hsl(var(--p-emerald))]" /> {attempts.length} started / {submitted.length} submitted / {unmarked} awaiting marking</span>
                          </div>
                          {!e.published && e.reviewStatus === "returned" && e.reviewNote && <p className="mt-2 rounded-lg bg-[hsl(var(--p-red)/0.07)] px-3 py-2 text-sm" data-testid={"text-review-note-" + id}><b>Exam officer:</b> {e.reviewNote}</p>}
                        </div>
                        <div className="flex flex-wrap gap-2 md:justify-end">
                          <button className="portal-btn-ghost" onClick={() => setResultsFor(id)} data-testid={"button-results-exam-" + id}><BarChart3 size={13} /> Results</button>
                          <button className="portal-btn-ghost" onClick={() => { record(id, "copy"); setEditing(duplicateExam(e)); }} data-testid={"button-duplicate-exam-" + id}><Copy size={13} /> Duplicate</button>
                          {!started && <button className="portal-btn-ghost" onClick={() => { record(id, "open"); setEditing({ ...e, questions: e.questions.map((q) => ({ ...q, options: [...q.options] })) }); }} data-testid={"button-edit-exam-" + id}><Pencil size={13} /> Edit</button>}
                          {e.fileId && <a className="portal-btn-ghost" href={fileUrl(e.fileId)} target="_blank" rel="noreferrer" onClick={() => record(id, "pdf")}><FileText size={13} /> Paper</a>}
                          {started && (e.published
                            ? <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => setConfirm({ id, published: false, resultsReleased: e.resultsReleased, label: "Hide this exam?", body: "Students will no longer see it on their dashboard. Existing attempts are kept." })} data-testid={"button-hide-exam-" + id}><EyeOff size={13} /> Hide</button>
                            : <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => setConfirm({ id, published: true, resultsReleased: e.resultsReleased, label: officer && e.reviewStatus !== "approved" ? "Send to the exam officer?" : "Publish this exam again?", body: officer && e.reviewStatus !== "approved" ? "The exam officer publishes it to students." : "Students in the class will see it again." })} data-testid={"button-publish-exam-" + id}><Eye size={13} /> {officer && e.reviewStatus !== "approved" ? "Send to exam officer" : "Publish"}</button>)}
                          {!started && e.published && <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => setConfirm({ id, published: false, resultsReleased: false, label: "Unpublish this exam?", body: "It returns to draft and students will no longer see it." })} data-testid={"button-unpublish-exam-" + id}><EyeOff size={13} /> Unpublish</button>}
                          {!started && !e.published && e.reviewStatus !== "submitted" && <button className="portal-btn-ghost" onClick={() => { record(id, "open"); setEditing({ ...e, published: true }); }} data-testid={"button-review-publish-" + id}><Eye size={13} /> {officer ? "Review and send to exam officer" : "Review and publish"}</button>}
                          {submitted.length > 0 && (e.resultsReleased
                            ? <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => setConfirm({ id, published: e.published, resultsReleased: false, label: "Withhold results?", body: "Students will see their result as pending again." })} data-testid={"button-withhold-" + id}><Undo2 size={13} /> Withhold results</button>
                            : <button className="portal-btn-gold portal-btn !py-1.5 text-[13px]" disabled={cmd.pending || unmarked > 0} title={unmarked ? "Mark every submitted attempt first" : undefined} onClick={() => setConfirm({ id, published: e.published, resultsReleased: true, label: "Release results?", body: "Every student who submitted will see their score and feedback." })} data-testid={"button-release-" + id}><Send size={13} /> Release results</button>)}
                          {(!started || canClear) && <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => { setTyped(""); setDeleting({ id, title: e.title, attempts: attempts.length }); }} data-testid={"button-delete-exam-" + id}><Trash2 size={13} /> Delete</button>}
                        </div>
                      </div>
                      {started && <p className="mt-3 text-xs text-[hsl(var(--p-ink)/0.5)]">A student has started this exam, so questions and settings can no longer change. Use publish and results controls only.</p>}
                    </article>
                  );
                })}</div>
              </div>
            ))}</div>
          </section>
        ))}</div>
      )}
      {editing && <ExamEditor data={data} initial={editing} onClose={() => setEditing(null)} />}
      {resultsExam && <ExamResults data={data} exam={resultsExam} isAdmin={isAdmin} onClose={() => setResultsFor(null)} />}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle className="font-serif text-2xl">Delete "{deleting?.title}"?</AlertDialogTitle><AlertDialogDescription>
            {deleting?.attempts
              ? <>{deleting.attempts} {deleting.attempts === 1 ? "student has" : "students have"} taken this exam. Their answers and scores for it are deleted too, and cannot be brought back. Use this to clear test exams.</>
              : "The exam and its questions are removed permanently. Only exams no student has started can be deleted."}
          </AlertDialogDescription></AlertDialogHeader>
          {!!deleting?.attempts && <label className="block text-sm">Type <b>DELETE</b> to confirm
            <input className="portal-input mt-1" value={typed} onChange={(ev) => setTyped(ev.target.value)} autoComplete="off" data-testid="input-confirm-delete-exam" /></label>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-delete-exam" disabled={!!deleting?.attempts && typed.trim().toUpperCase() !== "DELETE"}
              onClick={() => { if (deleting) void cmd.run({ action: "deleteExam", target: { id: deleting.id }, ...(deleting.attempts ? { withAttempts: true } : {}) }, deleting.attempts ? "Exam and its attempts deleted" : "Exam deleted"); setDeleting(null); }}>Delete exam</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
