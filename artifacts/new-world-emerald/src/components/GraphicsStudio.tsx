import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Download, ImageIcon, Loader2 } from "lucide-react";
import { useListLiveUpdates } from "@workspace/api-client-react";
import { asset } from "@/lib/asset";
import {
  LIMITS, SIZES, TEMPLATE_OPTIONS, buildGraphicSvg, downloadBlob, fetchLogoDataUri, svgToPngBlob,
  type GraphicFields, type SizeId, type TemplateId,
} from "./graphicsTemplates";

const field = "mt-1.5 block w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30";
const labelCls = "block text-xs font-bold uppercase tracking-wider text-muted-foreground";

function formatDate(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "long", year: "numeric" }).format(d);
}

export function GraphicsStudio() {
  const updates = useListLiveUpdates();
  const [template, setTemplate] = useState<TemplateId>("admissions");
  const [size, setSize] = useState<SizeId>("landscape");
  const [fields, setFields] = useState<GraphicFields>({
    title: "Admissions are open",
    description: "Visit the school office to learn about places from Creche to Senior Secondary.",
    detail: "Admissions office",
    cta: "Apply now",
  });
  const [logo, setLogo] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const [busy, setBusy] = useState<"svg" | "png" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchLogoDataUri(asset("/logo.jpg")).then((d) => live && setLogo(d)).catch(() => live && setLogoFailed(true));
    return () => { live = false; };
  }, []);

  const set = (k: keyof GraphicFields, v: string) => setFields((f) => ({ ...f, [k]: v.slice(0, LIMITS[k]) }));
  const svg = useMemo(() => buildGraphicSvg(template, size, fields, logo), [template, size, fields, logo]);
  const previewSrc = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, [svg]);
  const dims = SIZES[size];
  const baseName = `new-world-emerald-${template}-${size}`;

  const fillFrom = (id: string) => {
    const u = updates.data?.find((x) => String(x.id) === id);
    if (!u) return;
    const date = formatDate(u.publishedAt);
    setFields({
      title: u.title.slice(0, LIMITS.title),
      description: u.description.slice(0, LIMITS.description),
      detail: date.slice(0, LIMITS.detail),
      cta: fields.cta,
    });
  };

  const exportSvg = () => {
    setExportError(null);
    try { downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${baseName}.svg`); }
    catch { setExportError("SVG export failed. Try again or use a different browser."); }
  };
  const exportPng = async () => {
    setExportError(null); setBusy("png");
    try { downloadBlob(await svgToPngBlob(svg, dims.w, dims.h), `${baseName}.png`); }
    catch { setExportError("PNG export failed in this browser. You can still download the SVG."); }
    finally { setBusy(null); }
  };

  return (
    <section className="rounded-3xl border border-border bg-card shadow-sm" data-testid="section-graphics-studio" aria-labelledby="graphics-studio-title">
      <div className="flex items-start justify-between gap-4 border-b border-border p-6">
        <div>
          <h2 id="graphics-studio-title" className="font-serif text-2xl font-bold">Graphics studio</h2>
          <p className="mt-1 text-sm text-muted-foreground">Create matching school banners. Files are made in your browser and downloaded to your device; nothing is posted or scheduled. Avoid student names and personal details.</p>
        </div>
        <ImageIcon className="shrink-0 text-primary" size={23} />
      </div>
      <div className="grid gap-6 p-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-4">
          <div className="rounded-xl bg-muted/50 p-3">
            <label className={labelCls} htmlFor="select-graphic-update">Fill from a published update</label>
            {updates.isLoading ? (
              <p data-testid="status-graphics-loading" className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin" size={15} /> Loading updates...</p>
            ) : updates.isError ? (
              <p data-testid="status-graphics-error" role="alert" className="mt-2 flex items-center gap-2 text-sm text-destructive"><AlertCircle size={15} /> Updates could not be loaded.
                <button type="button" onClick={() => void updates.refetch()} data-testid="button-graphics-retry" className="font-bold underline">Retry</button></p>
            ) : !updates.data?.length ? (
              <p data-testid="status-graphics-empty" className="mt-2 text-sm text-muted-foreground">No published updates yet. Type your own text below.</p>
            ) : (
              <select id="select-graphic-update" data-testid="select-graphic-update" defaultValue="" onChange={(e) => fillFrom(e.target.value)} className={field}>
                <option value="" disabled>Choose an update</option>
                {updates.data.map((u) => <option key={u.id} value={u.id}>{u.title.slice(0, 60)}</option>)}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>Template
              <select data-testid="select-graphic-template" value={template} onChange={(e) => setTemplate(e.target.value as TemplateId)} className={field + " normal-case tracking-normal font-medium"}>
                {TEMPLATE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className={labelCls}>Size
              <select data-testid="select-graphic-size" value={size} onChange={(e) => setSize(e.target.value as SizeId)} className={field + " normal-case tracking-normal font-medium"}>
                {(Object.keys(SIZES) as SizeId[]).map((s) => <option key={s} value={s}>{SIZES[s].label}</option>)}
              </select>
            </label>
          </div>
          <label className={labelCls}>Title
            <input data-testid="input-graphic-title" maxLength={LIMITS.title} value={fields.title} onChange={(e) => set("title", e.target.value)} className={field + " normal-case tracking-normal font-medium"} />
          </label>
          <label className={labelCls}>Description
            <textarea data-testid="input-graphic-description" rows={3} maxLength={LIMITS.description} value={fields.description} onChange={(e) => set("description", e.target.value)} className={field + " normal-case tracking-normal font-medium"} />
            <span className="mt-1 block text-[11px] font-medium normal-case tracking-normal">{fields.description.length}/{LIMITS.description}</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>Date or detail
              <input data-testid="input-graphic-detail" maxLength={LIMITS.detail} value={fields.detail} onChange={(e) => set("detail", e.target.value)} className={field + " normal-case tracking-normal font-medium"} />
            </label>
            <label className={labelCls}>Call to action
              <input data-testid="input-graphic-cta" maxLength={LIMITS.cta} value={fields.cta} onChange={(e) => set("cta", e.target.value)} className={field + " normal-case tracking-normal font-medium"} />
            </label>
          </div>
        </div>

        <div>
          <div className="overflow-hidden rounded-2xl border border-border bg-muted/40 p-3">
            <img data-testid="img-graphic-preview" src={previewSrc} alt="Live preview of the school graphic" className="mx-auto h-auto max-h-[520px] w-full object-contain" style={{ aspectRatio: `${dims.w} / ${dims.h}` }} />
          </div>
          {logoFailed && <p data-testid="status-graphics-logo" className="mt-2 text-xs text-muted-foreground">The school logo could not be loaded, so the graphic is shown without it.</p>}
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" data-testid="button-download-svg" onClick={exportSvg} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90"><Download size={16} /> Download SVG</button>
            <button type="button" data-testid="button-download-png" onClick={() => void exportPng()} disabled={busy === "png"} className="inline-flex items-center gap-2 rounded-xl border border-primary px-4 py-3 text-sm font-bold text-primary hover:bg-primary/5 disabled:opacity-60">
              {busy === "png" ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />} Download PNG
            </button>
          </div>
          {exportError && <p role="alert" data-testid="status-export-error" className="mt-3 text-sm text-destructive">{exportError}</p>}
        </div>
      </div>
    </section>
  );
}
