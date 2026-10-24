import { useState } from "react";
import { useGetMediaStorageStatus, getGetMediaStorageStatusQueryKey, useTestMediaStorage, type MediaStorageTest } from "@workspace/api-client-react";
import { CheckCircle2, CloudUpload, Loader2, XCircle } from "lucide-react";

const LABELS = { cloudinary: "Cloudinary", bucket: "Cloud bucket", none: "Not connected" } as const;

/** Shows which media storage holds uploads and proves it works with a one-click test. */
export function MediaStorageCard() {
  const status = useGetMediaStorageStatus({ query: { queryKey: getGetMediaStorageStatusQueryKey(), retry: false } });
  const test = useTestMediaStorage();
  const [result, setResult] = useState<MediaStorageTest | null>(null);
  const s = status.data;
  const run = async () => {
    setResult(null);
    try { setResult(await test.mutateAsync()); }
    catch { setResult({ ok: false, detail: "The test could not run. Check your connection and try again." }); }
  };
  return (
    <section className="portal-card p-5" data-testid="card-media-storage">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-xl font-semibold">Media storage</h2>
          <p className="mt-0.5 text-sm text-[hsl(var(--p-ink)/0.6)]">Where photos, videos and PDFs are kept.</p>
        </div>
        <CloudUpload className="text-[hsl(var(--p-emerald))]" size={21} />
      </div>
      {status.isLoading ? <p className="text-sm text-[hsl(var(--p-ink)/0.6)]">Checking…</p> : status.isError || !s ? (
        <p className="text-sm text-[hsl(var(--p-ink)/0.6)]">Status unavailable.</p>
      ) : (
        <div className="flex items-center gap-2 rounded-xl bg-[hsl(var(--p-paper-2)/0.6)] px-3 py-2.5 text-sm" data-testid="text-media-provider">
          <span className={"h-2.5 w-2.5 rounded-full " + (s.ready ? "bg-[hsl(var(--p-emerald))]" : "bg-[hsl(var(--p-gold))]")} aria-hidden="true" />
          <span className="font-semibold">{LABELS[s.provider]}</span>
          {s.cloudName && <span className="truncate text-[hsl(var(--p-ink)/0.6)]">· {s.cloudName}</span>}
        </div>
      )}
      {s && !s.ready && <p className="mt-2 text-xs text-[hsl(var(--p-ink)/0.6)]">Add <code>CLOUDINARY_URL</code> in Render to switch uploads on.</p>}
      {result && (
        <p className={"mt-3 flex gap-2 text-sm " + (result.ok ? "text-[hsl(var(--p-emerald))]" : "text-[hsl(var(--p-red))]")} role="status" data-testid="text-media-test">
          {result.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />} {result.detail}
        </p>
      )}
      <button type="button" className="portal-btn-ghost mt-4 w-full justify-center" disabled={test.isPending || !s} onClick={() => void run()} data-testid="button-test-media">
        {test.isPending ? <><Loader2 size={15} className="animate-spin" /> Testing…</> : "Test connection"}
      </button>
    </section>
  );
}
