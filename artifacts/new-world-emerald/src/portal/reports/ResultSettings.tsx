import { useEffect, useState } from "react";
import type { GradeBand, ReportWorkspace } from "@workspace/api-client-react";
import { ImagePlus, Plus, Save, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Field } from "../ui";
import { useReportCommand } from "./useReportCommand";

/** Turns a signature photo or scan into a small image (at most 600 x 200 px, white background) for report cards. */
export async function signatureFromFile(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error("This picture could not be opened. Use a PNG or JPEG picture."); }
  const scale = Math.min(1, 600 / bitmap.width, 200 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let url = canvas.toDataURL("image/png");
  if (url.length > 190_000) url = canvas.toDataURL("image/jpeg", 0.85);
  if (url.length > 190_000) throw new Error("The signature picture is too large. Crop it to just the signature.");
  return url;
}

function SignatureField({ label, value, onChange, testId }: { label: string; value: string | null; onChange: (v: string | null) => void; testId: string }) {
  const { toast } = useToast();
  return (
    <div>
      <p className="portal-label mb-1.5">{label}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid h-20 w-56 place-items-center rounded-xl border border-dashed border-[hsl(var(--p-line))] bg-white">
          {value ? <img src={value} alt={label} className="max-h-16 max-w-[13rem] object-contain" data-testid={testId + "-preview"} /> : <span className="text-xs text-[hsl(var(--p-ink)/0.5)]">No signature yet</span>}
        </div>
        <label className="portal-btn-ghost cursor-pointer"><ImagePlus size={14} /> {value ? "Replace" : "Upload signature"}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" data-testid={testId + "-input"}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) signatureFromFile(f).then(onChange, (err: Error) => toast({ variant: "destructive", title: "Signature not added", description: err.message })); }} />
        </label>
        {value && <button type="button" className="portal-btn-ghost text-[hsl(var(--p-red))]" onClick={() => onChange(null)}><Trash2 size={13} /> Remove</button>}
      </div>
      <p className="mt-1.5 text-xs text-[hsl(var(--p-ink)/0.6)]">Sign on white paper in dark ink, take a clear photo, and crop it to the signature.</p>
    </div>
  );
}

/** Office: grading scale and the principal's signature. Teachers: their own signature for the results they sign. */
export function ResultSettings({ ws }: { ws: ReportWorkspace }) {
  const cmd = useReportCommand();
  const [scale, setScale] = useState<GradeBand[]>(ws.gradingScale);
  const [principalName, setPrincipalName] = useState(ws.principalName);
  const [principalSignature, setPrincipalSignature] = useState<string | null>(ws.principalSignature);
  const [mine, setMine] = useState<string | null>(ws.mySignature);
  useEffect(() => { setScale(ws.gradingScale); setPrincipalName(ws.principalName); setPrincipalSignature(ws.principalSignature); setMine(ws.mySignature); }, [ws.gradingScale, ws.principalName, ws.principalSignature, ws.mySignature]);

  if (!ws.canAdmin) {
    return (
      <div className="portal-card space-y-4 p-5" data-testid="panel-my-signature">
        <div><h3 className="font-serif text-xl font-semibold">My signature</h3><p className="text-sm text-[hsl(var(--p-ink)/0.65)]">Added to the results you review and send for approval as class teacher.</p></div>
        <SignatureField label="Signature" value={mine} onChange={setMine} testId="my-signature" />
        <button className="portal-btn" disabled={cmd.pending || mine === ws.mySignature} onClick={() => void cmd.run({ action: "saveSignature", signature: { image: mine } }, "Signature saved")} data-testid="button-save-my-signature"><Save size={14} /> Save signature</button>
      </div>
    );
  }

  const set = (i: number, patch: Partial<GradeBand>) => setScale((s) => s.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const ordered = scale.every((b, i) => i === 0 || b.min < scale[i - 1].min) && scale[scale.length - 1]?.min === 0;
  const save = () => cmd.run({ action: "saveSettings", settings: { gradingScale: scale.map((b) => ({ ...b, grade: b.grade.trim(), remark: b.remark.trim() })), principalName: principalName.trim(), principalSignature } }, "Result settings saved");
  return (
    <div className="space-y-5">
      <div className="portal-card p-5" data-testid="panel-grading-scale">
        <h3 className="font-serif text-xl font-semibold">Grading scale</h3>
        <p className="text-sm text-[hsl(var(--p-ink)/0.65)]">Used for every subject grade, overall grade and the key printed on results. List grades from the highest down; the last one starts at 0.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-[hsl(var(--p-ink)/0.6)]"><tr><th className="pb-2">From (%)</th><th className="pb-2">To</th><th className="pb-2">Grade</th><th className="pb-2">Remark</th><th /></tr></thead>
            <tbody>
              {scale.map((b, i) => (
                <tr key={i} data-testid={"scale-row-" + i}>
                  <td className="py-1 pr-2"><input type="number" min={0} max={100} className="portal-input !w-20 !py-1.5" value={b.min} onChange={(e) => set(i, { min: Math.floor(Number(e.target.value)) })} aria-label={`Minimum for grade ${b.grade || i + 1}`} data-testid={"scale-min-" + i} /></td>
                  <td className="py-1 pr-2 tabular-nums text-[hsl(var(--p-ink)/0.6)]">{i === 0 ? 100 : Math.max(b.min, scale[i - 1].min - 1)}</td>
                  <td className="py-1 pr-2"><input className="portal-input !w-20 !py-1.5 uppercase" maxLength={4} value={b.grade} onChange={(e) => set(i, { grade: e.target.value.toUpperCase() })} aria-label="Grade" data-testid={"scale-grade-" + i} /></td>
                  <td className="py-1 pr-2"><input className="portal-input !py-1.5" maxLength={40} value={b.remark} onChange={(e) => set(i, { remark: e.target.value })} aria-label="Remark" /></td>
                  <td className="py-1"><button type="button" className="portal-btn-ghost !px-2 text-[hsl(var(--p-red))]" disabled={scale.length <= 2} onClick={() => setScale((s) => s.filter((_, j) => j !== i))} aria-label="Remove grade"><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="portal-btn-ghost mt-2" disabled={scale.length >= 12} onClick={() => setScale((s) => [...s.slice(0, -1), { min: Math.max(1, Math.floor(((s[s.length - 2]?.min ?? 40) + 0) / 2)), grade: "", remark: "" }, s[s.length - 1]])} data-testid="button-add-grade"><Plus size={13} /> Add grade</button>
        {!ordered && <p className="mt-2 text-xs font-semibold text-[hsl(var(--p-red))]">Minimums must go down from top to bottom, and the last grade must start at 0.</p>}
      </div>

      <div className="portal-card space-y-4 p-5" data-testid="panel-principal">
        <div><h3 className="font-serif text-xl font-semibold">Principal</h3><p className="text-sm text-[hsl(var(--p-ink)/0.65)]">The name and signature printed on approved results.</p></div>
        <Field label="Principal's name" htmlFor="principal-name"><input id="principal-name" className="portal-input" maxLength={120} value={principalName} onChange={(e) => setPrincipalName(e.target.value)} placeholder="e.g. Mrs A. Okafor" data-testid="input-principal-name" /></Field>
        <SignatureField label="Principal's signature" value={principalSignature} onChange={setPrincipalSignature} testId="principal-signature" />
      </div>
      <button className="portal-btn" disabled={cmd.pending || !ordered || scale.some((b) => !b.grade.trim())} onClick={() => void save()} data-testid="button-save-result-settings"><Save size={14} /> {cmd.pending ? "Saving..." : "Save result settings"}</button>
    </div>
  );
}
