import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  customFetch, useListMyTimetables, getListMyTimetablesQueryKey, useListTimetables, getListTimetablesQueryKey, useManageTimetables,
  type Timetable, type TimetableInput,
} from "@workspace/api-client-react";
import { CalendarRange, Eye, EyeOff, FileText, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Field, Skeleton, StatusPill } from "./ui";
import { errorMessage, fileUrl } from "./lib";

const MAX_BYTES = 15 * 1024 * 1024;
const TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
const updated = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
export const timetableAudience = (t: Pick<Timetable, "classNames">) => (t.classNames.length ? t.classNames.join(", ") : "Whole school");

/** Upload a timetable file (PDF or picture). With a class it belongs to that class; without one it is for the whole school. */
export async function uploadDocument(file: File, classId?: number) {
  return customFetch<{ fileId: string; fileType: "pdf" | "image" }>(`/api/portal/documents${classId ? `?classId=${classId}` : ""}`, {
    method: "POST", body: file, headers: { "Content-Type": file.type },
  });
}

/** A timetable as students and parents see it: a picture shown in full, or a PDF to open. */
function TimetableCard({ t, children }: { t: Timetable; children?: React.ReactNode }) {
  const url = fileUrl(t.fileId);
  return (
    <article className="portal-card overflow-hidden !p-0" data-testid={`card-timetable-${t.id}`}>
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={t.kind === "exam" ? "gold" : "ink"}>{t.kind === "exam" ? "Exam timetable" : "Class timetable"}</StatusPill>
          {!t.published && <StatusPill tone="muted">Hidden</StatusPill>}
          <span className={"text-xs " + MUTED}>{timetableAudience(t)} · updated {updated(t.updatedAt)}</span>
        </div>
        <h3 className="mt-2 font-serif text-xl font-semibold">{t.title}</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="portal-btn" href={url} target="_blank" rel="noreferrer" data-testid={`link-timetable-${t.id}`}><FileText size={14} /> {t.fileType === "pdf" ? "Open the PDF" : "Open full size"}</a>
          {children}
        </div>
      </div>
      {t.fileType === "image" && (
        <a href={url} target="_blank" rel="noreferrer" className="block border-t border-[hsl(var(--p-line))] bg-[hsl(var(--p-paper-2)/0.5)]">
          <img src={url} alt={t.title} loading="lazy" className="mx-auto max-h-[28rem] w-full object-contain" />
        </a>
      )}
    </article>
  );
}

/** Published timetables, exam timetables first. Used by the student portal and each child's page for parents. */
export function TimetableList({ items, who = "your class" }: { items: Timetable[]; who?: string }) {
  if (!items.length) return <EmptyState icon={<CalendarRange size={22} />} title="No timetables yet" body={`Exam and class timetables for ${who} appear here when the school posts them.`} />;
  return <div className="grid gap-4 lg:grid-cols-2" data-testid="list-timetables">{items.map((t) => <TimetableCard key={t.id} t={t} />)}</div>;
}

export function StudentTimetables() {
  const q = useListMyTimetables({ query: { queryKey: getListMyTimetablesQueryKey() } });
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError || !q.data) return <ErrorPanel title="Timetables could not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  return <TimetableList items={q.data} />;
}

type Form = TimetableInput & { fileType?: "pdf" | "image" };

/** Post exam and class timetables: the office and the exam officer for the whole school or any class; teachers for their classes. */
export function TimetablesPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const q = useListTimetables({ query: { queryKey: getListTimetablesQueryKey() } });
  const manage = useManageTimetables();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<Timetable | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListTimetablesQueryKey() });

  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError || !q.data) return <ErrorPanel title="Timetables did not load" message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const w = q.data;
  const blank = (): Form => ({ title: "", kind: "exam", classIds: w.canWholeSchool ? [] : w.classes.slice(0, 1).map((c) => c.id), fileId: "", published: true });

  const onFile = async (f: File | undefined) => {
    if (!f || !form) return;
    if (!TYPES.includes(f.type)) { toast({ variant: "destructive", title: "PDF or picture only", description: "Upload a PDF, or a PNG, JPEG or WebP picture." }); return; }
    if (f.size > MAX_BYTES) { toast({ variant: "destructive", title: "File too large", description: "The limit is 15 MB." }); return; }
    if (!w.canWholeSchool && !form.classIds.length) { toast({ variant: "destructive", title: "Choose a class first" }); return; }
    setUploading(true);
    try {
      const r = await uploadDocument(f, w.canWholeSchool ? undefined : form.classIds[0]);
      setForm((p) => p && { ...p, fileId: r.fileId, fileType: r.fileType });
      toast({ title: r.fileType === "pdf" ? "PDF attached" : "Picture attached" });
    } catch (e) { toast({ variant: "destructive", title: "Upload failed", description: errorMessage(e) }); }
    finally { setUploading(false); }
  };
  const run = async (data: Parameters<typeof manage.mutateAsync>[0]["data"], done?: () => void) => {
    try { const r = await manage.mutateAsync({ data }); toast({ title: r.message }); done?.(); await refresh(); }
    catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); }
  };
  const save = () => {
    if (!form) return;
    const { fileType: _ignored, ...timetable } = form;
    void run({ action: "save", timetable: { ...timetable, title: timetable.title.trim() } }, () => setForm(null));
  };
  const toggleClass = (id: number) => form && setForm({ ...form, classIds: form.classIds.includes(id) ? form.classIds.filter((x) => x !== id) : [...form.classIds, id] });
  const edit = (t: Timetable) => setForm({ id: t.id, title: t.title, kind: t.kind, classIds: t.classIds, fileId: t.fileId, published: t.published, fileType: t.fileType });
  // A teacher's file belongs to the first chosen class, so changing classes after uploading needs a fresh upload.
  const classesLocked = !w.canWholeSchool && !!form?.fileId;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-[hsl(var(--p-ink)/0.65)]">
          Post the exam timetable or a class timetable as a PDF or a clear photo. Students see it under <b>Timetables</b> in their portal, and parents see it on each child's page.
          {w.canWholeSchool ? " Leave every class unticked to post it for the whole school." : " You can post for your own classes."}
        </p>
        <button className="portal-btn shrink-0" disabled={!w.canWholeSchool && !w.classes.length} onClick={() => setForm(blank())} data-testid="button-add-timetable"><Plus size={15} /> Post a timetable</button>
      </div>
      {!w.timetables.length ? <EmptyState icon={<CalendarRange size={22} />} title="No timetables posted" body="Post the term's exam timetable here so every student and parent can open it." /> : (
        <div className="grid gap-4 lg:grid-cols-2">{w.timetables.map((t) => (
          <TimetableCard key={t.id} t={t}>
            <button className="portal-btn-ghost" onClick={() => edit(t)} data-testid={`button-edit-timetable-${t.id}`}><Pencil size={13} /> Edit</button>
            <button className="portal-btn-ghost" disabled={manage.isPending} onClick={() => void run({ action: "save", timetable: { id: t.id, title: t.title, kind: t.kind, classIds: t.classIds, fileId: t.fileId, published: !t.published } })} data-testid={`button-toggle-timetable-${t.id}`}>{t.published ? <><EyeOff size={13} /> Hide</> : <><Eye size={13} /> Show</>}</button>
            <button className="portal-btn-ghost" disabled={manage.isPending} onClick={() => setDeleting(t)} data-testid={`button-delete-timetable-${t.id}`}><Trash2 size={13} /> Delete</button>
          </TimetableCard>
        ))}</div>
      )}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="portal !min-h-0 max-h-[92dvh] max-w-xl overflow-y-auto rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">{form?.id ? "Edit timetable" : "Post a timetable"}</DialogTitle><DialogDescription>A PDF, or a PNG, JPEG or WebP picture, up to 15 MB.</DialogDescription></DialogHeader>
          {form && <div className="space-y-4">
            <div role="radiogroup" aria-label="Kind" className="grid grid-cols-2 gap-2">
              {(["exam", "class"] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={form.kind === k} onClick={() => setForm({ ...form, kind: k })} data-testid={`radio-timetable-${k}`}
                  className={"rounded-xl border p-3 text-left text-sm " + (form.kind === k ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald-soft))]" : "border-[hsl(var(--p-line))]")}>
                  <b className="block">{k === "exam" ? "Exam timetable" : "Class timetable"}</b><span className={MUTED}>{k === "exam" ? "Exam dates, times and papers" : "The weekly lesson timetable"}</span>
                </button>
              ))}
            </div>
            <Field label="Title" htmlFor="tt-title"><input id="tt-title" className="portal-input" maxLength={150} placeholder={form.kind === "exam" ? "Autumn Term exam timetable" : "Year 7 Amber timetable"} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-timetable-title" /></Field>
            <fieldset>
              <legend className="text-sm font-semibold">Who sees it</legend>
              <p className={"text-xs " + MUTED}>{w.canWholeSchool ? (form.classIds.length ? `${form.classIds.length} ${form.classIds.length === 1 ? "class" : "classes"} chosen` : "Whole school: every student and parent") : classesLocked ? "Remove the file to change classes." : "Your classes"}</p>
              <div className="mt-2 flex max-h-48 flex-wrap gap-2 overflow-y-auto" data-testid="timetable-classes">
                {w.canWholeSchool && <button type="button" aria-pressed={!form.classIds.length} onClick={() => setForm({ ...form, classIds: [] })} className={"rounded-full border px-3 py-1.5 text-sm " + (!form.classIds.length ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald))] text-white" : "border-[hsl(var(--p-line))]")} data-testid="button-timetable-whole-school">Whole school</button>}
                {w.classes.map((c) => {
                  const on = form.classIds.includes(c.id);
                  return <button key={c.id} type="button" aria-pressed={on} disabled={classesLocked} onClick={() => toggleClass(c.id)} className={"rounded-full border px-3 py-1.5 text-sm disabled:opacity-60 " + (on ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald-soft))] font-semibold" : "border-[hsl(var(--p-line))]")} data-testid={`button-timetable-class-${c.id}`}>{c.name}</button>;
                })}
              </div>
            </fieldset>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept={TYPES.join(",")} className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-timetable-file" />
              <button type="button" className="portal-btn-ghost" disabled={uploading} onClick={() => fileRef.current?.click()} data-testid="button-upload-timetable"><Upload size={13} /> {uploading ? "Uploading..." : form.fileId ? "Replace file" : "Upload PDF or picture"}</button>
              {form.fileId && <><a className="portal-btn-ghost" href={fileUrl(form.fileId)} target="_blank" rel="noreferrer"><FileText size={13} /> View</a><button type="button" className="portal-btn-ghost" onClick={() => setForm({ ...form, fileId: "", fileType: undefined })}><X size={13} /> Remove</button></>}
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} data-testid="checkbox-timetable-published" /> Show it to students and parents now</label>
          </div>}
          <DialogFooter><button className="portal-btn" onClick={save} disabled={manage.isPending || uploading || !form?.title.trim() || !form?.fileId || (!w.canWholeSchool && !form.classIds.length)} data-testid="button-save-timetable">{manage.isPending ? "Saving..." : form?.published ? "Post timetable" : "Save hidden"}</button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle className="font-serif text-2xl">Delete "{deleting?.title}"?</AlertDialogTitle><AlertDialogDescription>Students and parents will no longer see it.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-delete-timetable" onClick={() => { if (deleting) void run({ action: "delete", id: deleting.id }); setDeleting(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
