import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMyAssignments, getListMyAssignmentsQueryKey, useSubmitAssignment, uploadAssignmentImage,
  type StudentAssignment,
} from "@workspace/api-client-react";
import { CalendarClock, Camera, NotebookPen, Send, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Skeleton, StatusPill } from "./ui";
import { errorMessage, formatDateTime } from "./lib";
import { imageUrl, preparePhoto } from "./photos";

const MAX_PHOTOS = 5;

/** Where an assignment stands for the student; drives the pill and the sort order. */
export function assignmentState(a: StudentAssignment, now = Date.now()): "marked" | "submitted" | "overdue" | "due" {
  if (a.submission?.markedAt) return "marked";
  if (a.submission) return "submitted";
  return new Date(a.dueAt).getTime() < now ? "overdue" : "due";
}

function SubmitForm({ a, onDone }: { a: StudentAssignment; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const submit = useSubmitAssignment();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(a.submission?.text ?? "");
  const [photos, setPhotos] = useState<string[]>(a.submission?.imageIds ?? []);
  const [uploading, setUploading] = useState(false);

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, MAX_PHOTOS - photos.length)) {
        const { imageId } = await uploadAssignmentImage(await preparePhoto(file, 1600));
        setPhotos((p) => [...p, imageId]);
      }
    } catch (e) { toast({ variant: "destructive", title: "Photo not added", description: errorMessage(e) }); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const send = async () => {
    try {
      const saved = await submit.mutateAsync({ id: a.id, data: { text: text.trim(), imageIds: photos } });
      queryClient.setQueryData<StudentAssignment[]>(getListMyAssignmentsQueryKey(), (list) => list?.map((x) => (x.id === saved.id ? saved : x)));
      toast({ title: a.submission ? "Work updated" : "Work handed in", description: saved.submission?.late ? "Handed in after the due time." : "Your teacher can now see it." });
      onDone();
    } catch (e) { toast({ variant: "destructive", title: "Not handed in", description: errorMessage(e) }); }
  };

  return (
    <div className="mt-4 space-y-3 border-t border-[hsl(var(--p-line))] pt-4">
      <label className="block text-sm font-semibold" htmlFor={`answer-${a.id}`}>Your answer</label>
      <textarea id={`answer-${a.id}`} className="portal-input min-h-32" maxLength={10000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your answer, or add photos of your written work." data-testid={`input-answer-${a.id}`} />
      <div className="flex flex-wrap gap-2">
        {photos.map((id) => (
          <div key={id} className="relative">
            <img src={imageUrl(id)} alt="Your work" className="h-20 w-20 rounded-xl object-cover" />
            <button type="button" className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-[hsl(var(--p-red))] text-white" aria-label="Remove photo" onClick={() => setPhotos((p) => p.filter((x) => x !== id))}><X size={13} /></button>
          </div>
        ))}
        {photos.length < MAX_PHOTOS && (
          <button type="button" className="grid h-20 w-20 place-items-center rounded-xl border border-dashed border-[hsl(var(--p-line))] text-xs text-[hsl(var(--p-ink)/0.6)]" disabled={uploading} onClick={() => fileRef.current?.click()} data-testid={`button-add-photo-${a.id}`}>
            <span className="flex flex-col items-center gap-1"><Camera size={18} />{uploading ? "Adding..." : "Add photo"}</span>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void addPhotos(e.target.files)} />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="portal-btn-ghost" onClick={onDone}>Cancel</button>
        <button type="button" className="portal-btn" disabled={submit.isPending || uploading || (!text.trim() && !photos.length)} onClick={() => void send()} data-testid={`button-hand-in-${a.id}`}>
          <Send size={15} /> {submit.isPending ? "Sending..." : a.submission ? "Update my work" : "Hand in"}
        </button>
      </div>
    </div>
  );
}

function AssignmentCard({ a }: { a: StudentAssignment }) {
  const [open, setOpen] = useState(false);
  const state = assignmentState(a);
  const sub = a.submission;
  return (
    <article className="portal-card p-5" data-testid={`card-assignment-${a.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--p-ink)/0.55)]">{a.subject}</span>
        {state === "marked" ? <StatusPill tone="green">Marked</StatusPill> : state === "submitted" ? <StatusPill tone="ink">Handed in</StatusPill> : state === "overdue" ? <StatusPill tone="red">Overdue</StatusPill> : <StatusPill tone="gold">To do</StatusPill>}
        {sub?.late && <StatusPill tone="muted">Late</StatusPill>}
      </div>
      <h3 className="mt-1 font-serif text-xl font-semibold">{a.title}</h3>
      <p className="mt-1 inline-flex items-center gap-1 text-sm text-[hsl(var(--p-ink)/0.62)]"><CalendarClock size={14} /> Due {formatDateTime(a.dueAt)} / {a.maxScore} {a.maxScore === 1 ? "mark" : "marks"}</p>
      {a.instructions && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[hsl(var(--p-ink)/0.78)]">{a.instructions}</p>}
      {state === "marked" && sub && (
        <div className="mt-4 rounded-xl bg-[hsl(var(--p-emerald-soft))] p-4" data-testid={`feedback-${a.id}`}>
          <p className="font-serif text-2xl font-bold text-[hsl(var(--p-emerald))]">{sub.score ?? "-"}<span className="text-base text-[hsl(var(--p-ink)/0.45)]"> / {a.maxScore}</span></p>
          {sub.feedback && <p className="mt-1 whitespace-pre-wrap text-sm">{sub.feedback}</p>}
        </div>
      )}
      {sub && !open && (
        <div className="mt-3 text-sm text-[hsl(var(--p-ink)/0.7)]">
          <p className="text-xs">Handed in {formatDateTime(sub.submittedAt)}</p>
          {sub.text && <p className="mt-1 line-clamp-3 whitespace-pre-wrap">{sub.text}</p>}
          {sub.imageIds.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{sub.imageIds.map((id) => <a key={id} href={imageUrl(id)} target="_blank" rel="noreferrer"><img src={imageUrl(id)} alt="Your work" className="h-16 w-16 rounded-lg object-cover" /></a>)}</div>}
        </div>
      )}
      {open ? <SubmitForm a={a} onDone={() => setOpen(false)} /> : state !== "marked" && (
        <button type="button" className={sub ? "portal-btn-ghost mt-4" : "portal-btn mt-4"} onClick={() => setOpen(true)} data-testid={`button-open-submit-${a.id}`}>
          <NotebookPen size={15} /> {sub ? "Change my work" : "Do this assignment"}
        </button>
      )}
    </article>
  );
}

const ORDER = { due: 0, overdue: 1, submitted: 2, marked: 3 } as const;

/** Homework set for the student's class, with hand-in and the teacher's feedback. */
export function StudentAssignments() {
  const q = useListMyAssignments({ query: { queryKey: getListMyAssignmentsQueryKey() } });
  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-36" /><Skeleton className="h-36" /></div>;
  if (q.isError || !q.data) return <div><ErrorPanel title="Assignments could not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div>;
  if (!q.data.length) return <div><EmptyState icon={<NotebookPen size={22} />} title="No assignments yet" body="Homework from your teachers appears here with its due date." /></div>;
  const now = Date.now();
  const list = [...q.data].sort((x, y) => ORDER[assignmentState(x, now)] - ORDER[assignmentState(y, now)] || x.dueAt.localeCompare(y.dueAt));
  return <div className="space-y-3">{list.map((a) => <AssignmentCard key={a.id} a={a} />)}</div>;
}
