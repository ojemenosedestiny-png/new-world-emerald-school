import { useRef, useState } from "react";
import { useImportPortalPdf, type PortalManagement, type PortalManagementMaterialsItem, type PortalManagementNoticesItem } from "@workspace/api-client-react";
import { BookOpen, Eye, EyeOff, FileText, Megaphone, Pencil, Plus, Upload, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, Field, StatusPill } from "../ui";
import { errorMessage, fileUrl } from "../lib";
import { ClassSelect } from "./ClassSelect";
import { className, useCommand } from "./useCommand";

const MAX_PDF = 15 * 1024 * 1024;

export function MaterialsPanel({ data }: { data: PortalManagement }) {
  const cmd = useCommand();
  const { toast } = useToast();
  const upload = useImportPortalPdf();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<PortalManagementMaterialsItem | null>(null);

  const onFile = (f: File | undefined) => {
    if (!f || !form) return;
    if (f.type !== "application/pdf") { toast({ variant: "destructive", title: "PDF files only" }); return; }
    if (f.size > MAX_PDF) { toast({ variant: "destructive", title: "File too large", description: "The limit is 15 MB." }); return; }
    if (!form.classId) { toast({ variant: "destructive", title: "Choose a class first" }); return; }
    upload.mutate({ data: f, params: { classId: form.classId } }, {
      onSuccess: (r) => { setForm((p) => p && { ...p, fileId: r.fileId }); toast({ title: "PDF attached" }); },
      onError: (e) => toast({ variant: "destructive", title: "Upload failed", description: errorMessage(e) }),
    });
  };
  const save = async () => {
    if (!form) return;
    if (await cmd.run({ action: "saveMaterial", material: { ...form, title: form.title.trim(), subject: form.subject.trim() } }, form.id ? "Revision note updated" : "Revision note saved")) setForm(null);
  };
  const toggle = (m: PortalManagementMaterialsItem) => cmd.run({ action: "saveMaterial", material: { ...m, published: !m.published } }, m.published ? "Hidden from students" : "Published to students");

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button className="portal-btn" disabled={!data.classes.length} onClick={() => setForm({ title: "", subject: "", classId: data.classes[0]?.id ?? 0, body: "", fileId: null, published: false })} data-testid="button-add-material"><Plus size={15} /> New revision note</button></div>
      {data.materials.length === 0 ? <EmptyState icon={<BookOpen size={22} />} title="No revision material" body="Share class notes, worked examples or a PDF worksheet. Drafts stay hidden until you publish." /> : (
        <div className="grid gap-3 md:grid-cols-2">{data.materials.map((m) => (
          <div key={m.id} className="portal-card p-5" data-testid={"card-material-" + m.id}>
            <div className="flex flex-wrap items-center gap-2"><StatusPill tone={m.published ? "green" : "muted"}>{m.published ? "Published" : "Draft"}</StatusPill><span className="text-xs text-[hsl(var(--p-ink)/0.55)]">{className(data.classes, m.classId)} / {m.subject}</span></div>
            <p className="mt-2 font-serif text-lg font-semibold">{m.title}</p>
            <p className="mt-1 line-clamp-2 text-sm text-[hsl(var(--p-ink)/0.65)]">{m.body}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="portal-btn-ghost" onClick={() => setForm({ ...m })} data-testid={"button-edit-material-" + m.id}><Pencil size={13} /> Edit</button>
              <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => toggle(m)} data-testid={"button-toggle-material-" + m.id}>{m.published ? <><EyeOff size={13} /> Unpublish</> : <><Eye size={13} /> Publish</>}</button>
              {m.fileId && <a className="portal-btn-ghost" href={fileUrl(m.fileId)} target="_blank" rel="noreferrer"><FileText size={13} /> PDF</a>}
            </div>
          </div>))}
        </div>
      )}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="portal !min-h-0 max-h-[92dvh] max-w-xl overflow-y-auto rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">{form?.id ? "Edit revision note" : "New revision note"}</DialogTitle></DialogHeader>
          {form && <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" htmlFor="m-title"><input id="m-title" className="portal-input" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-material-title" /></Field>
              <Field label="Subject" htmlFor="m-subject"><input id="m-subject" className="portal-input" maxLength={100} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} data-testid="input-material-subject" /></Field>
            </div>
            <Field label="Class" htmlFor="m-class"><ClassSelect id="m-class" classes={data.classes} value={form.classId} disabled={!!form.fileId} onChange={(v) => setForm({ ...form, classId: v })} /></Field>
            <Field label="Notes" htmlFor="m-body"><textarea id="m-body" className="portal-input min-h-[180px]" maxLength={30000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} data-testid="input-material-body" /></Field>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
              <button type="button" className="portal-btn-ghost" disabled={upload.isPending} onClick={() => fileRef.current?.click()} data-testid="button-upload-material-pdf"><Upload size={13} /> {upload.isPending ? "Uploading..." : form.fileId ? "Replace PDF" : "Attach PDF (optional)"}</button>
              {form.fileId && <><a className="portal-btn-ghost" href={fileUrl(form.fileId)} target="_blank" rel="noreferrer"><FileText size={13} /> View</a><button type="button" className="portal-btn-ghost" onClick={() => setForm({ ...form, fileId: null })} data-testid="button-remove-material-pdf"><X size={13} /> Remove</button></>}
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} data-testid="checkbox-material-published" /> Published to students</label>
          </div>}
          <DialogFooter><button className="portal-btn" onClick={save} disabled={cmd.pending || upload.isPending || !form?.title.trim() || !form?.subject.trim() || !form?.classId} data-testid="button-save-material">{cmd.pending ? "Saving..." : "Save"}</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function NoticesPanel({ data }: { data: PortalManagement }) {
  const cmd = useCommand();
  const [form, setForm] = useState<PortalManagementNoticesItem | null>(null);
  const save = async () => {
    if (!form) return;
    if (await cmd.run({ action: "saveNotice", notice: { ...form, title: form.title.trim(), body: form.body.trim() } }, form.id ? "Announcement updated" : "Announcement saved")) setForm(null);
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button className="portal-btn" disabled={!data.classes.length} onClick={() => setForm({ title: "", body: "", classId: data.classes[0]?.id ?? 0, published: false })} data-testid="button-add-notice"><Plus size={15} /> New announcement</button></div>
      {data.notices.length === 0 ? <EmptyState icon={<Megaphone size={22} />} title="No announcements" body="Post reminders and class news. Each announcement reaches one class." /> : (
        <div className="space-y-3">{data.notices.map((n) => (
          <div key={n.id} className="portal-card flex flex-col gap-3 p-5 sm:flex-row sm:items-start" data-testid={"card-notice-" + n.id}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><StatusPill tone={n.published ? "green" : "muted"}>{n.published ? "Published" : "Draft"}</StatusPill><span className="text-xs text-[hsl(var(--p-ink)/0.55)]">{className(data.classes, n.classId)}</span></div>
              <p className="mt-2 font-serif text-lg font-semibold">{n.title}</p>
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-[hsl(var(--p-ink)/0.65)]">{n.body}</p>
            </div>
            <div className="flex gap-2">
              <button className="portal-btn-ghost" onClick={() => setForm({ ...n })} data-testid={"button-edit-notice-" + n.id}><Pencil size={13} /> Edit</button>
              <button className="portal-btn-ghost" disabled={cmd.pending} onClick={() => cmd.run({ action: "saveNotice", notice: { ...n, published: !n.published } }, n.published ? "Announcement hidden" : "Announcement published")} data-testid={"button-toggle-notice-" + n.id}>{n.published ? "Unpublish" : "Publish"}</button>
            </div>
          </div>))}
        </div>
      )}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="portal !min-h-0 max-w-lg rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">{form?.id ? "Edit announcement" : "New announcement"}</DialogTitle><DialogDescription>Visible only to students in the selected class.</DialogDescription></DialogHeader>
          {form && <div className="space-y-4">
            <Field label="Title" htmlFor="n-title"><input id="n-title" className="portal-input" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-notice-title" /></Field>
            <Field label="Class" htmlFor="n-class"><ClassSelect id="n-class" classes={data.classes} value={form.classId} onChange={(v) => setForm({ ...form, classId: v })} /></Field>
            <Field label="Message" htmlFor="n-body"><textarea id="n-body" className="portal-input min-h-[140px]" maxLength={5000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} data-testid="input-notice-body" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} data-testid="checkbox-notice-published" /> Published</label>
          </div>}
          <DialogFooter><button className="portal-btn" onClick={save} disabled={cmd.pending || !form?.title.trim() || !form?.body.trim() || !form?.classId} data-testid="button-save-notice">{cmd.pending ? "Saving..." : "Save"}</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
