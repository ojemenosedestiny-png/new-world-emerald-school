import { useState } from "react";
import { useSendTestEmail, type EmailTestResult } from "@workspace/api-client-react";
import { CheckCircle2, Loader2, Mail, XCircle } from "lucide-react";

/** Sends a test email to the signed-in administrator and shows Resend's exact answer. */
export function EmailCard() {
  const test = useSendTestEmail();
  const [result, setResult] = useState<EmailTestResult | null>(null);
  const run = async () => {
    setResult(null);
    try { setResult(await test.mutateAsync()); }
    catch { setResult({ ok: false, detail: "The test could not run. Check your connection and try again.", from: null, to: null }); }
  };
  return (
    <section className="portal-card p-5" data-testid="card-email">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-xl font-semibold">Email</h2>
          <p className="mt-0.5 text-sm text-[hsl(var(--p-ink)/0.6)]">Activation links, password resets and sign-in codes, sent through Resend.</p>
        </div>
        <Mail className="text-[hsl(var(--p-emerald))]" size={21} />
      </div>
      {result && (
        <p className={"flex gap-2 text-sm " + (result.ok ? "text-[hsl(var(--p-emerald))]" : "text-[hsl(var(--p-red))]")} role="status" data-testid="text-email-test">
          {result.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />} <span className="min-w-0 break-words">{result.detail}</span>
        </p>
      )}
      <button type="button" className="portal-btn-ghost mt-4 w-full justify-center" disabled={test.isPending} onClick={() => void run()} data-testid="button-test-email">
        {test.isPending ? <><Loader2 size={15} className="animate-spin" /> Sending…</> : "Send test email to me"}
      </button>
    </section>
  );
}
