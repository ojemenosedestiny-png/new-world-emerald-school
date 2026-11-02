import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetParentPayments, getGetParentPaymentsQueryKey, useAdjustParentWallet, type ParentPayment } from "@workspace/api-client-react";
import { AlertTriangle, CreditCard, Search, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Skeleton, StatusPill } from "../ui";
import { errorMessage } from "../lib";
import { ngn, paymentState, when } from "../parents/receipt";
import { parseNaira } from "../parents/summary";
import { ReceiptDialog } from "../parents/ParentViews";

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";

/** The office's view of online fee payments: every receipt, totals, and parents' wallet balances. */
export function ParentPaymentsPanel() {
  const q = useGetParentPayments({ query: { queryKey: getGetParentPaymentsQueryKey(), refetchInterval: 60_000 } });
  const [open, setOpen] = useState<ParentPayment | null>(null);
  const [search, setSearch] = useState("");
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const payments = q.data?.payments ?? [];
  const shown = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return payments;
    return payments.filter((p) => p.reference.toLowerCase().includes(t) || p.parentEmail.includes(t) || p.allocations.some((a) => a.studentName.toLowerCase().includes(t) || a.studentCode.toLowerCase().includes(t)));
  }, [payments, search]);

  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError || !q.data) return <ErrorPanel title="Payments did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const paid = payments.filter((p) => p.status === "success");
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const received = paid.reduce((n, p) => n + p.cardKobo, 0);
  const thisMonth = paid.filter((p) => new Date(p.paidAt ?? p.createdAt) >= monthStart).reduce((n, p) => n + p.cardKobo, 0);
  const walletTotal = d.wallets.reduce((n, w) => n + w.balanceKobo, 0);

  return (
    <div className="space-y-5">
      {!d.paystackReady && (
        <div className="flex gap-3 rounded-xl bg-[hsl(var(--p-gold-soft))] p-4 text-sm text-[hsl(var(--p-gold-ink))]" role="status">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>Online payment is switched off: add the school&apos;s Paystack secret key as <b>PAYSTACK_SECRET_KEY</b> in the Render settings. Parents can still see their children&apos;s fees and pay from their wallet.</p>
        </div>
      )}
      {d.studentsWithoutParentEmail > 0 && (
        <div className="flex gap-3 rounded-xl border border-[hsl(var(--p-line))] p-4 text-sm" role="status" data-testid="text-missing-parent-email">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[hsl(var(--p-gold-ink))]" aria-hidden="true" />
          <p><b>{d.studentsWithoutParentEmail}</b> active {d.studentsWithoutParentEmail === 1 ? "student has" : "students have"} no parent email, so their parents cannot see them in the parent portal. Add it under <b>Students</b> → Edit.</p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {[["Received online", received, "All successful Paystack payments"], ["This month", thisMonth, monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" })], ["Held in parents' wallets", walletTotal, `${d.wallets.length} ${d.wallets.length === 1 ? "parent" : "parents"} in credit`]].map(([label, kobo, note]) => (
          <div key={label as string} className="portal-card p-4">
            <p className={"text-xs font-semibold uppercase tracking-wider " + MUTED}>{label}</p>
            <p className="mt-1 font-serif text-2xl font-semibold tabular-nums">{ngn(kobo as number)}</p>
            <p className={"text-xs " + MUTED}>{note}</p>
          </div>
        ))}
      </div>

      <section aria-labelledby="pp-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="pp-title" className="font-serif text-xl font-semibold">Payments and receipts</h2>
          <label className="relative w-full sm:w-72">
            <span className="sr-only">Search payments</span>
            <Search size={15} className={"absolute left-3 top-1/2 -translate-y-1/2 " + MUTED} aria-hidden="true" />
            <input className="portal-input !pl-9" placeholder="Student, parent email or receipt no." value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-payments" />
          </label>
        </div>
        {!shown.length ? <EmptyState icon={<CreditCard size={22} />} title={payments.length ? "No matching payments" : "No online payments yet"} body="Payments parents make in the parent portal appear here with their receipts." /> : (
          <div className="portal-card overflow-x-auto !p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead className={"text-left text-xs uppercase tracking-wider " + MUTED}>
                <tr><th className="px-4 py-3">Date</th><th className="px-3 py-3">Children</th><th className="px-3 py-3">Parent</th><th className="px-3 py-3 text-right">Paystack</th><th className="px-3 py-3 text-right">Wallet</th><th className="px-3 py-3">Status</th><th className="px-4 py-3"><span className="sr-only">Receipt</span></th></tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const st = paymentState(p);
                  return (
                    <tr key={p.reference} className="border-t border-[hsl(var(--p-line))]" data-testid={`row-office-payment-${p.reference}`}>
                      <td className="px-4 py-2.5 align-top"><span className="block whitespace-nowrap">{when(p.paidAt ?? p.createdAt)}</span><span className={"font-mono text-[11px] " + MUTED}>{p.reference}</span></td>
                      <td className="px-3 py-2.5 align-top">{[...new Set(p.allocations.map((a) => `${a.studentName} (${a.studentCode})`))].join(", ") || <span className={MUTED}>Not applied</span>}</td>
                      <td className="max-w-[200px] break-all px-3 py-2.5 align-top">{p.parentEmail}</td>
                      <td className="px-3 py-2.5 text-right align-top tabular-nums">{ngn(p.cardKobo)}</td>
                      <td className="px-3 py-2.5 text-right align-top tabular-nums">{p.walletUsedKobo ? `−${ngn(p.walletUsedKobo)}` : p.walletCreditKobo ? `+${ngn(p.walletCreditKobo)}` : "—"}</td>
                      <td className="px-3 py-2.5 align-top"><StatusPill tone={st.tone}>{st.label}</StatusPill></td>
                      <td className="px-4 py-2.5 text-right align-top"><button type="button" className="portal-btn-ghost !min-h-[34px] !px-3 text-xs" onClick={() => setOpen(p)}>Receipt</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="wallets-title" className="space-y-3">
        <h2 id="wallets-title" className="font-serif text-xl font-semibold">Parents&apos; wallets</h2>
        <p className={"text-sm " + MUTED}>Overpayments are kept here and used automatically for the parent&apos;s next payment. If the school refunds a balance in cash or by transfer, record it so the wallet stays correct.</p>
        {d.wallets.length ? (
          <ul className="portal-card divide-y divide-[hsl(var(--p-line))] !p-0">
            {d.wallets.map((w) => (
              <li key={w.email} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <Wallet size={16} className={MUTED} aria-hidden="true" />
                <span className="min-w-0 flex-1 break-all">{w.email}</span>
                <span className="font-semibold tabular-nums">{ngn(w.balanceKobo)}</span>
                <button type="button" className="portal-btn-ghost !min-h-[34px] !px-3 text-xs" onClick={() => setAdjusting(w.email)} data-testid={`button-adjust-${w.email}`}>Record refund or adjustment</button>
              </li>
            ))}
          </ul>
        ) : <p className={"text-sm " + MUTED}>No parent has a wallet balance.</p>}
      </section>

      <ReceiptDialog payment={open} onClose={() => setOpen(null)} />
      {adjusting && <AdjustWallet email={adjusting} onClose={() => setAdjusting(null)} />}
    </div>
  );
}

function AdjustWallet({ email, onClose }: { email: string; onClose: () => void }) {
  const adjust = useAdjustParentWallet();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const kobo = parseNaira(amount);
  const save = async () => {
    if (!kobo) return;
    try {
      const r = await adjust.mutateAsync({ data: { email, amountKobo: direction === "out" ? -kobo : kobo, note } });
      toast({ title: "Wallet updated", description: r.message });
      await queryClient.invalidateQueries({ queryKey: getGetParentPaymentsQueryKey() });
      onClose();
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-w-md rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">Change wallet balance</DialogTitle><DialogDescription className="break-all">{email}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <fieldset className="flex gap-2"><legend className="sr-only">Direction</legend>
            <label className="flex flex-1 items-center gap-2 rounded-lg border border-[hsl(var(--p-line))] p-2.5 text-sm"><input type="radio" checked={direction === "out"} onChange={() => setDirection("out")} /> Money refunded (take out)</label>
            <label className="flex flex-1 items-center gap-2 rounded-lg border border-[hsl(var(--p-line))] p-2.5 text-sm"><input type="radio" checked={direction === "in"} onChange={() => setDirection("in")} /> Add credit</label>
          </fieldset>
          <label className="block text-sm font-semibold">Amount (₦)<input className="portal-input mt-1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-adjust-amount" /></label>
          <label className="block text-sm font-semibold">Reason<input className="portal-input mt-1" maxLength={300} placeholder="For example: refunded by bank transfer on 3 Nov" value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-adjust-note" /></label>
        </div>
        <DialogFooter className="gap-2">
          <button type="button" className="portal-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="portal-btn" disabled={!kobo || note.trim().length < 3 || adjust.isPending} onClick={() => void save()} data-testid="button-save-adjust">{adjust.isPending ? "Saving..." : "Save"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
