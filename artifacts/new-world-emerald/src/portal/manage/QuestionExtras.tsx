import { useRef, useState } from "react";
import { uploadPortalDiagram } from "@workspace/api-client-react";
import { ImagePlus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { diagramUrl, errorMessage } from "../lib";

const MAX_SIDE = 1600;

/** Phone photos and scans are shrunk in the browser so a diagram stays well under the 3 MB limit. */
export async function preparePicture(file: File): Promise<Blob> {
  const fits = ["image/png", "image/jpeg", "image/webp"].includes(file.type) && file.size <= 1.5 * 1024 * 1024;
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("This picture could not be opened. Use a PNG or JPEG picture."); }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (fits && scale === 1) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The picture could not be prepared."))), type, 0.88));
}

/** The diagram picture for one question: shown for checking, attachable, replaceable and removable. */
export function DiagramField({ fileId, classId, index, onChange }: { fileId?: string | null; classId: number; index: number; onChange: (fileId: string | null) => void }) {
  const { toast } = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!classId) { toast({ variant: "destructive", title: "Choose a class first" }); return; }
    setBusy(true);
    try {
      const picture = await preparePicture(file);
      const r = await uploadPortalDiagram(picture, { classId }, { headers: { "Content-Type": picture.type } });
      onChange(r.fileId);
    } catch (error) {
      toast({ variant: "destructive", title: "Diagram not attached", description: errorMessage(error) });
    } finally { setBusy(false); }
  };
  return (
    <div className="mt-3" data-testid={"diagram-field-" + index}>
      {fileId && <img src={diagramUrl(fileId)} alt={`Diagram for question ${index + 1}`} className="mb-2 max-h-72 max-w-full rounded-xl border border-[hsl(var(--p-line))] bg-white p-2" data-testid={"img-diagram-" + index} />}
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="portal-btn-ghost" disabled={busy} onClick={() => ref.current?.click()} data-testid={"button-diagram-" + index}>
          <ImagePlus size={13} /> {busy ? "Attaching..." : fileId ? "Replace diagram" : "Attach diagram"}
        </button>
        {fileId && <button type="button" className="portal-btn-ghost text-[hsl(var(--p-red))]" onClick={() => onChange(null)} data-testid={"button-remove-diagram-" + index}><Trash2 size={12} /> Remove diagram</button>}
      </div>
    </div>
  );
}

/** A passage or set of instructions shared by a run of questions, edited once for all of them. */
export function PassageEditor({ text, from, to, count, onText, onRange, onRemove }: {
  text: string; from: number; to: number; count: number;
  onText: (text: string) => void; onRange: (from: number, to: number) => void; onRemove: () => void;
}) {
  const id = "passage-" + from;
  const clamp = (n: number) => Math.min(count, Math.max(1, Math.floor(n) || 1));
  return (
    <div className="rounded-2xl border border-[hsl(var(--p-emerald)/0.35)] bg-[hsl(var(--p-emerald-soft)/0.35)] p-4" data-testid={"editor-passage-" + from}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor={id} className="font-semibold">Shared passage</label>
        <span className="text-[hsl(var(--p-ink)/0.6)]">shown above questions</span>
        <input type="number" aria-label="First question" min={1} max={count} className="portal-input !w-16 !py-1" value={from} onChange={(e) => onRange(clamp(Number(e.target.value)), Math.max(clamp(Number(e.target.value)), to))} data-testid={"input-passage-from-" + from} />
        <span>to</span>
        <input type="number" aria-label="Last question" min={from} max={count} className="portal-input !w-16 !py-1" value={to} onChange={(e) => onRange(from, Math.max(from, clamp(Number(e.target.value))))} data-testid={"input-passage-to-" + from} />
        <button type="button" className="portal-btn-ghost ml-auto !px-2 text-[hsl(var(--p-red))]" onClick={onRemove} aria-label="Remove passage" data-testid={"button-remove-passage-" + from}><Trash2 size={13} /></button>
      </div>
      <textarea id={id} className="portal-input min-h-[120px] text-sm leading-relaxed" maxLength={20000} placeholder="Passage or instructions students read before these questions" value={text} onChange={(e) => onText(e.target.value)} data-testid={"input-passage-" + from} />
    </div>
  );
}
