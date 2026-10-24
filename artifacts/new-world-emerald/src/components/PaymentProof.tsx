import { useRef, useState } from "react";
import { attachPaymentProof, uploadPaymentProof, type BankAccount } from "@workspace/api-client-react";
import { Check, CheckCircle2, Copy, ImagePlus, Landmark, Loader2, Upload, X } from "lucide-react";
import { preparePhoto } from "@/portal/photos";

/** Shrinks the screenshot in the browser, stores it privately, and returns its id for the order or report. */
export async function uploadProof(file: File): Promise<string> {
  const blob = await preparePhoto(file, 1600);
  const { proofId } = await uploadPaymentProof(blob);
  return proofId;
}

/** The school's bank accounts, each with a one-tap copy of the account number. */
export function BankAccountsPanel({ accounts }: { accounts: BankAccount[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (!accounts.length) return null;
  const copy = async (number: string) => {
    try { await navigator.clipboard.writeText(number); setCopied(number); setTimeout(() => setCopied(null), 2000); } catch { /* clipboard blocked: the number is still visible */ }
  };
  return (
    <section className="mb-10" aria-labelledby="bank-accounts-title" data-testid="panel-bank-accounts">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Pay by bank transfer</p>
      <h2 id="bank-accounts-title" className="mt-2 font-serif text-2xl font-bold">School bank account{accounts.length > 1 ? "s" : ""}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Transfer to the account below, then send your order or payment report with a screenshot of the transfer.</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {accounts.map((account) => (
          <div key={account.accountNumber + account.label} className="rounded-2xl border border-primary/20 bg-card p-5 shadow-sm" data-testid={`card-bank-${account.accountNumber}`}>
            <div className="flex items-center gap-2 text-primary"><Landmark size={18} aria-hidden="true" /><span className="text-xs font-bold uppercase tracking-wider">{account.label || "School account"}</span></div>
            <p className="mt-3 text-sm text-muted-foreground">{account.bankName}</p>
            <p className="font-semibold">{account.accountName}</p>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-4 py-3">
              <span className="font-mono text-xl font-bold tracking-wider" data-testid="text-account-number">{account.accountNumber}</span>
              <button type="button" onClick={() => void copy(account.accountNumber)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/30 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/5" aria-label={`Copy account number ${account.accountNumber}`}>
                {copied === account.accountNumber ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Optional but encouraged screenshot of the transfer, chosen before sending the form. */
export function ProofPicker({ file, onFile, testId, required = false }: { file: File | null; onFile: (file: File | null) => void; testId: string; required?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-xl border border-dashed border-primary/30 bg-primary/[0.03] p-4">
      <p className="text-sm font-semibold">Payment screenshot <span className="text-xs font-normal text-muted-foreground">{required ? "(required)" : "(recommended)"}</span></p>
      <p className="mt-0.5 text-xs text-muted-foreground">A screenshot of the transfer helps the School Office confirm your payment faster.</p>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.target.value = ""; }} data-testid={testId} />
      {file ? (
        <div className="mt-3 flex items-center gap-2 text-sm"><CheckCircle2 size={16} className="shrink-0 text-primary" /><span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button type="button" onClick={() => onFile(null)} className="rounded-md p-1 text-muted-foreground hover:text-foreground" aria-label="Remove screenshot"><X size={15} /></button></div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold hover:border-primary"><ImagePlus size={16} /> Add screenshot</button>
      )}
    </div>
  );
}

/** For people who sent the order or report first and paid afterwards. */
export function AttachProofForm() {
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reference.trim() || !email.trim() || !file) { setResult({ ok: false, text: "Enter your reference and email, and add the screenshot." }); return; }
    setBusy(true); setResult(null);
    try {
      const proofId = await uploadProof(file);
      const done = await attachPaymentProof({ reference: reference.trim(), email: email.trim(), proofId });
      setResult({ ok: true, text: done.message });
      setReference(""); setFile(null);
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : "The screenshot could not be added. Please try again." });
    } finally { setBusy(false); }
  };
  return (
    <section className="mb-10 rounded-2xl border border-border bg-card p-5" data-testid="panel-attach-proof">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left" data-testid="button-open-attach-proof">
        <span><span className="block font-semibold">Already paid? Add your payment screenshot</span><span className="block text-xs text-muted-foreground">Use the reference from your order or payment report.</span></span>
        <Upload size={18} className="shrink-0 text-primary" />
      </button>
      {open && (
        <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-2" data-testid="form-attach-proof">
          <label className="text-sm font-semibold">Order or report reference<input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="NWE-ORD-…" className="mt-1.5 w-full rounded-xl border border-border bg-background px-4 py-3 font-mono text-sm" data-testid="input-attach-reference" /></label>
          <label className="text-sm font-semibold">Email used on the order<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm" data-testid="input-attach-email" /></label>
          <div className="md:col-span-2"><ProofPicker file={file} onFile={setFile} testId="input-attach-proof" required /></div>
          {result && <p className={"text-sm md:col-span-2 " + (result.ok ? "text-primary" : "text-destructive")} role="status" data-testid="text-attach-result">{result.text}</p>}
          <button type="submit" disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60 md:col-span-2" data-testid="button-attach-proof">
            {busy ? <><Loader2 size={16} className="animate-spin" /> Sending…</> : "Send screenshot"}
          </button>
        </form>
      )}
    </section>
  );
}
