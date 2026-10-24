import { useEffect, useState } from "react";
import { useListPortalAlbums, getListPortalAlbumsQueryKey, type PortalAlbum } from "@workspace/api-client-react";
import { ArrowLeft, ChevronLeft, ChevronRight, Images, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorPanel, Skeleton } from "./ui";
import { errorMessage } from "./lib";
import { imageUrl } from "./photos";

function Viewer({ album, index, onIndex, onClose }: { album: PortalAlbum; index: number | null; onIndex: (i: number) => void; onClose: () => void }) {
  const photo = index === null ? null : album.photos[index];
  const count = album.photos.length;
  useEffect(() => {
    if (index === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") onIndex((index + 1) % count);
      if (e.key === "ArrowLeft") onIndex((index - 1 + count) % count);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [index, count, onIndex]);
  return (
    <Dialog open={index !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="!min-h-0 max-w-[min(96vw,1100px)] border-0 bg-black p-0 text-white [&>button]:hidden" data-testid="photo-viewer">
        <DialogTitle className="sr-only">{album.title}, photo {(index ?? 0) + 1} of {count}</DialogTitle>
        {photo && <div className="relative">
          <img src={imageUrl(photo.imageId)} alt={photo.caption || `${album.title}, photo ${index! + 1}`} className="max-h-[80vh] w-full object-contain" />
          <div className="flex items-center gap-3 px-4 py-3">
            <p className="min-w-0 flex-1 truncate text-sm">{photo.caption || album.title}</p>
            <span className="text-xs text-white/60">{index! + 1} / {count}</span>
          </div>
          {count > 1 && <>
            <button type="button" className="absolute left-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 hover:bg-black/70" onClick={() => onIndex((index! - 1 + count) % count)} aria-label="Previous photo" data-testid="button-photo-prev"><ChevronLeft size={22} /></button>
            <button type="button" className="absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 hover:bg-black/70" onClick={() => onIndex((index! + 1) % count)} aria-label="Next photo" data-testid="button-photo-next"><ChevronRight size={22} /></button>
          </>}
          <button type="button" className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full bg-black/50 hover:bg-black/70" onClick={onClose} aria-label="Close" data-testid="button-photo-close"><X size={20} /></button>
        </div>}
      </DialogContent>
    </Dialog>
  );
}

/** School photo albums: whole-school albums and the student's own class. */
export function StudentGallery() {
  const albums = useListPortalAlbums({ query: { queryKey: getListPortalAlbumsQueryKey() } });
  const [openId, setOpenId] = useState<number | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const list = (albums.data ?? []).filter((a) => a.photos.length > 0);
  const album = list.find((a) => a.id === openId);
  const date = (iso: string) => new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

  if (albums.isError) return <div className="px-4 lg:px-0"><ErrorPanel title="The gallery could not load" message={errorMessage(albums.error)} onRetry={() => albums.refetch()} /></div>;
  if (albums.isLoading) return <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 lg:px-0"><Skeleton className="aspect-square" /><Skeleton className="aspect-square" /><Skeleton className="aspect-square" /></div>;
  if (album) return (
    <div className="space-y-4 px-4 lg:px-0">
      <button type="button" className="portal-btn-ghost" onClick={() => setOpenId(null)} data-testid="button-back-albums"><ArrowLeft size={15} /> All albums</button>
      <div>
        <h2 className="font-serif text-2xl font-semibold" data-testid="text-album-title">{album.title}</h2>
        <p className="text-sm text-[hsl(var(--p-ink)/0.6)]">{album.photos.length} {album.photos.length === 1 ? "photo" : "photos"} / {album.className ?? "Whole school"} / {date(album.createdAt)}</p>
        {album.description && <p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm text-[hsl(var(--p-ink)/0.75)]">{album.description}</p>}
      </div>
      <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5" data-testid="grid-photos">
        {album.photos.map((p, i) => (
          <li key={p.id}>
            <button type="button" className="block aspect-square w-full overflow-hidden rounded-lg bg-[hsl(var(--p-paper-2))]" onClick={() => setIndex(i)} aria-label={p.caption ? `Open photo: ${p.caption}` : `Open photo ${i + 1}`} data-testid={"photo-" + p.id}>
              <img src={imageUrl(p.imageId)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform hover:scale-105" />
            </button>
          </li>
        ))}
      </ul>
      <Viewer album={album} index={index} onIndex={setIndex} onClose={() => setIndex(null)} />
    </div>
  );
  return (
    <div className="px-4 lg:px-0">
      {list.length === 0 ? <EmptyState icon={<Images size={22} />} title="No albums yet" body="Photos from school events appear here once the school office publishes them." /> : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" data-testid="list-albums">
          {list.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => { setOpenId(a.id); setIndex(null); }} className="portal-card block w-full overflow-hidden text-left transition-transform hover:-translate-y-0.5" data-testid={"album-" + a.id}>
                <span className="relative block aspect-[4/3] bg-[hsl(var(--p-paper-2))]">
                  <img src={imageUrl(a.photos[0].imageId)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white"><Images size={12} aria-hidden="true" /> {a.photos.length}</span>
                </span>
                <span className="block p-3">
                  <span className="block truncate font-semibold">{a.title}</span>
                  <span className="block truncate text-xs text-[hsl(var(--p-ink)/0.6)]">{a.className ?? "Whole school"} / {date(a.createdAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
