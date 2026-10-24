import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPortalAlbums, getListPortalAlbumsQueryKey, useCreatePortalAlbum, useUpdatePortalAlbum, useDeletePortalAlbum,
  useAddPortalAlbumPhoto, useUpdatePortalAlbumPhoto, useDeletePortalAlbumPhoto,
  useListPhotoReviews, getListPhotoReviewsQueryKey, useDecidePhotoReview,
  type PortalAlbum, type PortalAlbumInput, type PortalManagement,
} from "@workspace/api-client-react";
import { ArrowLeft, Check, ImagePlus, Images, Pencil, Plus, Trash2, UserCheck, X } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Field, Skeleton, StatusPill } from "../ui";
import { errorMessage } from "../lib";
import { imageUrl, preparePhoto } from "../photos";

type Form = PortalAlbumInput & { id?: number };

function AlbumPhotos({ album, onBack }: { album: PortalAlbum; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const add = useAddPortalAlbumPhoto();
  const caption = useUpdatePortalAlbumPhoto();
  const remove = useDeletePortalAlbumPhoto();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [captions, setCaptions] = useState<Record<number, string>>({});
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListPortalAlbumsQueryKey() });

  const upload = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (input.current) input.current.value = "";
    if (!list.length) return;
    setProgress({ done: 0, total: list.length });
    let failed = 0;
    for (const [i, file] of list.entries()) {
      try { await add.mutateAsync({ id: album.id, data: await preparePhoto(file, 1600) }); }
      catch (e) {
        failed++;
        toast({ variant: "destructive", title: `${file.name} not uploaded`, description: errorMessage(e) });
        if (/not set up/.test(errorMessage(e))) break;
      }
      setProgress({ done: i + 1, total: list.length });
      if (i % 4 === 3) void refresh();
    }
    setProgress(null);
    await refresh();
    if (failed < list.length) toast({ title: `${list.length - failed} ${list.length - failed === 1 ? "photo" : "photos"} added` });
  };
  const saveCaption = async (id: number) => {
    const text = captions[id];
    if (text === undefined) return;
    try { await caption.mutateAsync({ id, data: { caption: text } }); await refresh(); setCaptions(({ [id]: _, ...rest }) => rest); }
    catch (e) { toast({ variant: "destructive", title: "Caption not saved", description: errorMessage(e) }); }
  };
  const del = async (id: number) => {
    try { await remove.mutateAsync({ id }); await refresh(); }
    catch (e) { toast({ variant: "destructive", title: "Photo not removed", description: errorMessage(e) }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="portal-btn-ghost" onClick={onBack} data-testid="button-back-gallery"><ArrowLeft size={15} /> Albums</button>
        <div className="min-w-0 flex-1"><p className="truncate font-serif text-xl font-semibold">{album.title}</p><p className="text-xs text-[hsl(var(--p-ink)/0.6)]">{album.photos.length} photos / {album.className ?? "Whole school"} / {album.published ? "Published" : "Draft"}</p></div>
        <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void upload(e.target.files)} data-testid="input-album-photos" />
        <button type="button" className="portal-btn" disabled={!!progress} onClick={() => input.current?.click()} data-testid="button-add-photos"><ImagePlus size={15} /> {progress ? `Uploading ${progress.done} of ${progress.total}...` : "Add photos"}</button>
      </div>
      {progress && <div className="h-2 overflow-hidden rounded-full bg-[hsl(var(--p-paper-2))]" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}><div className="h-full bg-[hsl(var(--p-emerald))] transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>}
      {album.photos.length === 0 ? <EmptyState icon={<Images size={22} />} title="No photos yet" body="Add photos from your phone or computer. They are resized automatically and stay private to the school." /> : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {album.photos.map((p) => (
            <li key={p.id} className="portal-card overflow-hidden" data-testid={"admin-photo-" + p.id}>
              <img src={imageUrl(p.imageId)} alt={p.caption || ""} loading="lazy" className="aspect-square w-full object-cover" />
              <div className="flex items-center gap-1 p-2">
                <input className="portal-input !py-1.5 text-xs" placeholder="Add a caption" maxLength={200} aria-label="Caption"
                  value={captions[p.id] ?? p.caption} onChange={(e) => setCaptions({ ...captions, [p.id]: e.target.value })}
                  onBlur={() => void saveCaption(p.id)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} data-testid={"input-caption-" + p.id} />
                <button type="button" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[hsl(var(--p-red))] hover:bg-[hsl(var(--p-red)/0.1)]" onClick={() => void del(p.id)} aria-label="Remove photo" data-testid={"button-remove-photo-" + p.id}><Trash2 size={14} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Photo albums for the student gallery (administrators). */
export function GalleryPanel({ data }: { data: PortalManagement }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const albums = useListPortalAlbums({ query: { queryKey: getListPortalAlbumsQueryKey() } });
  const create = useCreatePortalAlbum();
  const update = useUpdatePortalAlbum();
  const remove = useDeletePortalAlbum();
  const [form, setForm] = useState<Form | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<PortalAlbum | null>(null);
  const pending = create.isPending || update.isPending || remove.isPending;
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListPortalAlbumsQueryKey() });

  const save = async () => {
    if (!form) return;
    const { id, ...body } = form;
    try {
      const saved = id ? await update.mutateAsync({ id, data: body }) : await create.mutateAsync({ data: body });
      toast({ title: id ? "Album updated" : "Album created", description: id ? undefined : "Now add photos to it." });
      setForm(null);
      await refresh();
      if (!id) setOpenId(saved.id);
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); }
  };
  const confirmDelete = async (a: PortalAlbum) => {
    try { await remove.mutateAsync({ id: a.id }); toast({ title: "Album deleted" }); await refresh(); }
    catch (e) { toast({ variant: "destructive", title: "Not deleted", description: errorMessage(e) }); }
  };

  if (albums.isError) return <ErrorPanel title="The gallery did not load" message={errorMessage(albums.error)} onRetry={() => albums.refetch()} />;
  const open = albums.data?.find((a) => a.id === openId);
  if (open) return <AlbumPhotos album={open} onBack={() => setOpenId(null)} />;
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-[hsl(var(--p-ink)/0.65)]">Share photos from school events. Albums can be for the whole school or one class, and photos are only visible to signed-in students.</p>
        <button className="portal-btn shrink-0" onClick={() => setForm({ title: "", description: "", classId: null, published: true })} data-testid="button-add-album"><Plus size={15} /> New album</button>
      </div>
      {albums.isLoading ? <Skeleton className="h-40" /> : (albums.data ?? []).length === 0
        ? <EmptyState icon={<Images size={22} />} title="No albums yet" body="Create an album, for example Inter-house Sports 2026, then add photos." />
        : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {albums.data!.map((a) => (
              <li key={a.id} className="portal-card overflow-hidden" data-testid={"card-album-" + a.id}>
                <button type="button" className="block w-full text-left" onClick={() => setOpenId(a.id)} data-testid={"button-open-album-" + a.id}>
                  <span className="grid aspect-[16/9] place-items-center bg-[hsl(var(--p-paper-2))] text-[hsl(var(--p-ink)/0.35)]">
                    {a.photos[0] ? <img src={imageUrl(a.photos[0].imageId)} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Images size={30} />}
                  </span>
                </button>
                <div className="p-4">
                  <div className="flex items-center gap-2"><StatusPill tone={a.published ? "green" : "muted"}>{a.published ? "Published" : "Draft"}</StatusPill><span className="text-xs text-[hsl(var(--p-ink)/0.55)]">{a.photos.length} photos / {a.className ?? "Whole school"}</span></div>
                  <p className="mt-2 truncate font-serif text-lg font-semibold">{a.title}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="portal-btn-ghost" onClick={() => setOpenId(a.id)}><ImagePlus size={13} /> Photos</button>
                    <button className="portal-btn-ghost" onClick={() => setForm({ id: a.id, title: a.title, description: a.description, classId: a.classId, published: a.published })} data-testid={"button-edit-album-" + a.id}><Pencil size={13} /> Edit</button>
                    <button className="portal-btn-ghost" disabled={pending} onClick={() => setDeleting(a)} data-testid={"button-delete-album-" + a.id}><Trash2 size={13} /> Delete</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="portal !min-h-0 max-w-lg rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">{form?.id ? "Edit album" : "New album"}</DialogTitle><DialogDescription>Published albums appear in the student gallery.</DialogDescription></DialogHeader>
          {form && <div className="space-y-4">
            <Field label="Title" htmlFor="al-title"><input id="al-title" className="portal-input" maxLength={150} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-album-title" /></Field>
            <Field label="Who can see it" htmlFor="al-class">
              <select id="al-class" className="portal-input" value={form.classId ?? ""} onChange={(e) => setForm({ ...form, classId: e.target.value ? Number(e.target.value) : null })} data-testid="select-album-class">
                <option value="">Whole school</option>
                {data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Description (optional)" htmlFor="al-desc"><textarea id="al-desc" className="portal-input min-h-[90px]" maxLength={2000} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-album-description" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} data-testid="checkbox-album-published" /> Published</label>
          </div>}
          <DialogFooter><button className="portal-btn" onClick={() => void save()} disabled={pending || !form?.title.trim()} data-testid="button-save-album">{pending ? "Saving..." : "Save album"}</button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle className="font-serif text-2xl">Delete "{deleting?.title}"?</AlertDialogTitle><AlertDialogDescription>The album and all {deleting?.photos.length ?? 0} photos in it are deleted permanently.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-delete-album" onClick={() => { if (deleting) void confirmDelete(deleting); setDeleting(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Student profile photos waiting for a teacher or the office to approve. */
export function PhotoReviewsPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const reviews = useListPhotoReviews({ query: { queryKey: getListPhotoReviewsQueryKey() } });
  const decide = useDecidePhotoReview();
  const act = async (id: number, approve: boolean) => {
    try {
      await decide.mutateAsync({ id, data: { approve } });
      toast({ title: approve ? "Photo approved" : "Photo declined" });
      await queryClient.invalidateQueries({ queryKey: getListPhotoReviewsQueryKey() });
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); }
  };
  if (reviews.isError) return <ErrorPanel title="Photo approvals did not load" message={errorMessage(reviews.error)} onRetry={() => reviews.refetch()} />;
  return (
    <div className="space-y-4">
      <p className="max-w-xl text-sm text-[hsl(var(--p-ink)/0.65)]">Approve clear, appropriate photos of the student's face. Declined photos are deleted and the student can try again.</p>
      {reviews.isLoading ? <Skeleton className="h-40" /> : (reviews.data ?? []).length === 0
        ? <EmptyState icon={<UserCheck size={22} />} title="Nothing to approve" body="New student photos appear here." />
        : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {reviews.data!.map((r) => (
              <li key={r.id} className="portal-card p-4" data-testid={"review-" + r.id}>
                <div className="flex gap-4">
                  <img src={imageUrl(r.pendingPhotoId)} alt={`New photo for ${r.name}`} className="h-28 w-28 shrink-0 rounded-2xl object-cover" />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{r.name}</p>
                    <p className="truncate font-mono text-xs text-[hsl(var(--p-ink)/0.6)]">{r.studentId}</p>
                    <p className="truncate text-xs text-[hsl(var(--p-ink)/0.6)]">{r.className}</p>
                    {r.photoId && <p className="mt-2 flex items-center gap-2 text-xs text-[hsl(var(--p-ink)/0.6)]"><img src={imageUrl(r.photoId)} alt="" className="h-7 w-7 rounded-full object-cover" /> Replaces current photo</p>}
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <button className="portal-btn flex-1 justify-center" disabled={decide.isPending} onClick={() => void act(r.id, true)} data-testid={"button-approve-" + r.id}><Check size={15} /> Approve</button>
                  <button className="portal-btn-ghost flex-1 justify-center" disabled={decide.isPending} onClick={() => void act(r.id, false)} data-testid={"button-decline-" + r.id}><X size={15} /> Decline</button>
                </div>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
