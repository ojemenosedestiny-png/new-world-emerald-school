import { ChildProfile } from "../profile/StudentProfile";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useStartParentPayment, getGetParentOverviewQueryKey,
  type ParentOverview, type ParentPayment, type ParentChild,
} from "@workspace/api-client-react";
import { ArrowRight, Check, Copy, CreditCard, IdCard, LineChart, Loader2, Lock, Printer, Receipt, ShieldCheck, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, StatusPill } from "../ui";
import { errorMessage } from "../lib";
import { channelLabel, ngn, paymentState, printReceipt, when } from "./receipt";
import { paymentSummary, parseNaira } from "./summary";

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
const keyOf = (studentId: number, itemKey: string) => `${studentId}:${itemKey}`;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-full bg-[hsl(var(--p-emerald-soft))] font-semibold text-[hsl(var(--p-emerald))]" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials(name)}
    </span>
  );
}

function CopyId({ id }: { id: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md px-1.5 font-mono text-xs font-semibold hover:bg-[hsl(var(--p-paper-2))]"
      onClick={() => void navigator.clipboard?.writeText(id).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); }, () => undefined)}
      aria-label={`Copy student ID ${id}`} data-testid={`button-copy-${id}`}>
      {id} {done ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
    </button>
  );
}

/** Paid so far against the total, as a bar with the figures in words for screen readers. */
function Progress({ paid, total }: { paid: number; total: number }) {
  const pct = total > 0 ? Math.round((paid / total) * 100) : 100;
  return (
    <div>
      <div className="h-2 overflow-hidden rounded-full bg-[hsl(var(--p-paper-2))]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${pct}% of fees paid`}>
        <div className="h-full rounded-full bg-[hsl(var(--p-emerald))]" style={{ width: `${pct}%` }} />
      </div>
      <p className={"mt-1.5 text-xs " + MUTED}>{ngn(paid)} paid of {ngn(total)}</p>
    </div>
  );
}

/** The parent's headline: what is owed across all children, and the wallet. */
function BalanceHero({ data }: { data: ParentOverview }) {
  const owed = data.outstanding.reduce((n, o) => n + o.outstandingKobo, 0);
  return (
    <section className="overflow-hidden rounded-2xl bg-[hsl(var(--p-chrome))] text-[hsl(var(--p-chrome-ink))]" aria-labelledby="balance-title">
      <div className="grid gap-6 p-6 sm:grid-cols-[1fr_auto] sm:items-end sm:p-8">
        <div className="min-w-0">
          <p id="balance-title" className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--p-gold))]">Outstanding school fees</p>
          <p className="mt-2 font-serif text-4xl font-semibold tabular-nums sm:text-5xl" data-testid="text-total-outstanding">{ngn(owed)}</p>
          <p className="mt-2 text-sm opacity-80">{data.children.length === 1 ? "For 1 child" : `For ${data.children.length} children`} registered with {data.email}</p>
        </div>
        <div className="rounded-xl border border-[hsl(var(--p-chrome-ink)/0.18)] px-4 py-3" data-testid="card-wallet-summary">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] opacity-75"><Wallet size={14} aria-hidden="true" /> School wallet</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{ngn(data.wallet.balanceKobo)}</p>
          <p className="text-xs opacity-70">Used automatically when you pay</p>
        </div>
      </div>
    </section>
  );
}

/** Choose fees across children and pay: wallet first, then Paystack. */
export function PayFees({ data, onPaid }: { data: ParentOverview; onPaid: (p: ParentPayment) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const start = useStartParentPayment();
  const all = useMemo(() => data.outstanding.map((o) => keyOf(o.studentId, o.itemKey)), [data.outstanding]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(all));
  const [custom, setCustom] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  // Fees that appear after a refresh start selected; fees paid elsewhere drop out; the parent's own ticks are kept.
  const known = useRef(new Set(all));
  useEffect(() => {
    setSelected((cur) => new Set(all.filter((k) => cur.has(k) || !known.current.has(k))));
    known.current = new Set(all);
  }, [all]);

  const chosen = data.outstanding.filter((o) => selected.has(keyOf(o.studentId, o.itemKey)));
  const selectedKobo = chosen.reduce((n, o) => n + o.outstandingKobo, 0);
  const customKobo = custom === null ? null : parseNaira(custom);
  const s = paymentSummary(selectedKobo, data.wallet.balanceKobo, custom === null ? null : customKobo ?? -1);
  const needsPaystack = s.toPayKobo > 0;
  const blocked = !!s.problem || (needsPaystack && !data.paystackReady) || start.isPending || leaving;

  const toggle = (k: string) => setSelected((cur) => { const next = new Set(cur); if (next.has(k)) next.delete(k); else next.add(k); return next; });
  const pay = async () => {
    try {
      const r = await start.mutateAsync({ data: { items: chosen.map((o) => ({ studentId: o.studentId, itemKey: o.itemKey })), amountKobo: s.toPayKobo } });
      if (r.authorizationUrl) { setLeaving(true); window.location.assign(r.authorizationUrl); return; }
      await queryClient.invalidateQueries({ queryKey: getGetParentOverviewQueryKey() });
      if (r.payment) onPaid(r.payment);
    } catch (e) {
      toast({ variant: "destructive", title: "Payment not started", description: errorMessage(e) });
    }
  };

  if (!data.outstanding.length) {
    return (
      <div className="space-y-5">
        <BalanceHero data={data} />
        <EmptyState icon={<ShieldCheck size={22} />} title="All fees are paid" body="There is nothing to pay right now. New fees will appear here as soon as the school publishes them." />
      </div>
    );
  }

  const byChild = data.children.map((c) => ({ child: c, items: data.outstanding.filter((o) => o.studentId === c.id) })).filter((g) => g.items.length);
  return (
    <div className="space-y-5">
      <BalanceHero data={data} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <section aria-labelledby="choose-title" className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="choose-title" className="font-serif text-2xl font-semibold">Choose what to pay</h2>
              <p className={"text-sm " + MUTED}>Everything owed is selected. Untick anything you want to pay later.</p>
            </div>
            <div className="flex gap-1">
              <button type="button" className="portal-btn-ghost !min-h-[36px] !px-3 text-xs" onClick={() => setSelected(new Set(all))}>Select all</button>
              <button type="button" className="portal-btn-ghost !min-h-[36px] !px-3 text-xs" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          </div>
          {byChild.map(({ child, items }) => (
            <fieldset key={child.id} className="portal-card overflow-hidden !p-0" data-testid={`fees-child-${child.id}`}>
              <legend className="sr-only">Fees for {child.name}</legend>
              <div className="flex items-center gap-3 border-b border-[hsl(var(--p-line))] px-4 py-3">
                <Avatar name={child.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{child.name}</p>
                  <p className={"text-xs " + MUTED}>{child.statement.className} · <span className="font-mono">{child.studentId}</span></p>
                </div>
              </div>
              <ul>
                {items.map((o) => {
                  const k = keyOf(o.studentId, o.itemKey);
                  const full = child.statement.items.find((i) => i.key === o.itemKey);
                  const id = `fee-${k.replace(/[^a-z0-9]/gi, "-")}`;
                  return (
                    <li key={k} className="border-b border-[hsl(var(--p-line))] last:border-b-0">
                      <label htmlFor={id} className="flex min-h-[64px] cursor-pointer items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--p-paper-2)/0.6)]">
                        <input id={id} type="checkbox" className="h-5 w-5 shrink-0 accent-[hsl(var(--p-emerald))]" checked={selected.has(k)} onChange={() => toggle(k)} data-testid={`check-${k}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{o.description}</span>
                          <span className={"block text-xs " + MUTED}>{o.term} · {o.academicYear}{full && full.paidKobo > 0 ? ` · ${ngn(full.paidKobo)} of ${ngn(full.amountKobo)} paid` : ""}</span>
                        </span>
                        <span className="text-right font-semibold tabular-nums">{ngn(o.outstandingKobo)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))}
        </section>

        <aside className="portal-card space-y-4 p-5 sm:p-6 lg:sticky lg:top-20" aria-labelledby="summary-title" id="pay-summary">
          <h2 id="summary-title" className="font-serif text-xl font-semibold">Payment summary</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className={MUTED}>Selected fees ({chosen.length})</dt><dd className="tabular-nums">{ngn(selectedKobo)}</dd></div>
            <div className="flex justify-between gap-3"><dt className={MUTED}>From your school wallet</dt><dd className="tabular-nums">{s.walletUsedKobo ? `− ${ngn(s.walletUsedKobo)}` : ngn(0)}</dd></div>
            <div className="flex items-baseline justify-between gap-3 border-t border-[hsl(var(--p-line))] pt-3"><dt className="font-semibold">To pay now</dt><dd className="font-serif text-3xl font-semibold tabular-nums" data-testid="text-to-pay">{ngn(Math.max(0, s.toPayKobo))}</dd></div>
          </dl>

          {custom === null ? (
            <button type="button" className="text-sm font-semibold text-[hsl(var(--p-emerald))] underline underline-offset-4" onClick={() => setCustom(String(s.exactKobo / 100))} data-testid="button-custom-amount">Pay a different amount</button>
          ) : (
            <div>
              <label htmlFor="custom-amount" className="text-sm font-semibold">Amount to pay now (₦)</label>
              <input id="custom-amount" inputMode="decimal" autoComplete="off" className="portal-input mt-1 text-lg tabular-nums" value={custom} onChange={(e) => setCustom(e.target.value)} aria-describedby="custom-help" data-testid="input-custom-amount" />
              <p id="custom-help" className={"mt-1.5 text-xs leading-relaxed " + MUTED} aria-live="polite">
                {s.extraToWalletKobo > 0 ? `${ngn(s.extraToWalletKobo)} more than needed: it is saved in your school wallet and used next time.`
                  : s.leftOwingKobo > 0 ? `${ngn(s.leftOwingKobo)} will still be owed. Your payment goes to the oldest fees first.`
                  : "This pays the selected fees in full."}
              </p>
              <button type="button" className={"mt-1 text-xs underline " + MUTED} onClick={() => setCustom(null)}>Pay the exact amount instead</button>
            </div>
          )}

          {s.problem && <p className="text-sm font-medium text-[hsl(var(--p-red))]" role="alert">{s.problem}</p>}
          {needsPaystack && !data.paystackReady && (
            <p className="rounded-xl bg-[hsl(var(--p-gold-soft))] p-3 text-sm text-[hsl(var(--p-gold-ink))]">Online card payment is being set up. Meanwhile you can pay by bank transfer on the <Link href="/commerce?section=fees" className="font-semibold underline">School Payments</Link> page.</p>
          )}
          <button type="button" className="portal-btn w-full justify-center !py-3.5 text-base" disabled={blocked} onClick={() => void pay()} data-testid="button-pay">
            {start.isPending || leaving ? <><Loader2 size={18} className="animate-spin" aria-hidden="true" /> {leaving ? "Opening Paystack..." : "Starting..."}</>
              : needsPaystack ? <><Lock size={16} aria-hidden="true" /> Pay {ngn(s.toPayKobo)} securely</>
              : <><Wallet size={16} aria-hidden="true" /> Pay {ngn(s.walletUsedKobo)} from wallet</>}
          </button>
          <p className={"flex gap-2 text-xs leading-relaxed " + MUTED}>
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[hsl(var(--p-emerald))]" aria-hidden="true" />
            Card, bank transfer or USSD through Paystack. Your card details go to Paystack, never to the school. You get a receipt by email and here.
          </p>
        </aside>
      </div>

      {/* Phones: the total and the pay button stay in reach while scrolling the list. */}
      <div className="fixed inset-x-0 bottom-16 z-30 border-t border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface))] px-4 py-2.5 shadow-[0_-8px_24px_rgb(0_0_0/0.08)] lg:hidden">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="min-w-0 flex-1"><p className={"text-[11px] " + MUTED}>To pay now</p><p className="font-semibold tabular-nums">{ngn(Math.max(0, s.toPayKobo))}</p></div>
          <a href="#pay-summary" className="portal-btn !py-2.5">Review & pay <ArrowRight size={15} aria-hidden="true" /></a>
        </div>
      </div>
      <div className="h-16 lg:hidden" aria-hidden="true" />
    </div>
  );
}

/** Each child: name, class, ID, how much is paid, and every fee on their statement. */
export function ChildrenView({ children, onProgress }: { children: ParentChild[]; onProgress?: (id: number) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {children.map((c) => {
        const t = c.statement.totals;
        return (
          <article key={c.id} className="portal-card space-y-4 p-5 sm:p-6" data-testid={`card-child-${c.id}`}>
            <header className="flex items-center gap-3">
              <Avatar name={c.name} size={48} />
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-serif text-xl font-semibold">{c.name}</h2>
                <p className={"text-sm " + MUTED}>{c.statement.className}</p>
              </div>
              <div className="text-right"><p className={"text-[11px] uppercase tracking-wider " + MUTED}>Student ID</p><CopyId id={c.studentId} /></div>
            </header>
            <button type="button" className="portal-btn-ghost w-full justify-center" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)} data-testid={`button-child-profile-${c.id}`}><IdCard size={15} aria-hidden="true" /> {open === c.id ? "Hide profile" : "Full profile: address, phone, parents, health"}</button>
            {open === c.id && <ChildProfile studentId={c.id} />}
            {onProgress && <button type="button" className="portal-btn-ghost w-full justify-center" onClick={() => onProgress(c.id)} data-testid={`button-child-progress-${c.id}`}><LineChart size={15} aria-hidden="true" /> Report cards, results, attendance and homework</button>}
            <Progress paid={t.paidKobo} total={t.totalKobo} />
            <div className="flex items-baseline justify-between rounded-xl bg-[hsl(var(--p-paper-2))] px-4 py-3">
              <span className="text-sm font-semibold">Still owed</span>
              <span className="font-serif text-2xl font-semibold tabular-nums">{ngn(t.outstandingKobo)}</span>
            </div>
            {c.statement.items.length ? (
              <ul className="divide-y divide-[hsl(var(--p-line))] text-sm">
                {c.statement.items.map((i) => (
                  <li key={i.key} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0"><span className="block font-medium">{i.description}</span><span className={"block text-xs " + MUTED}>{i.term} · {i.academicYear}</span></span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="tabular-nums">{ngn(i.amountKobo)}</span>
                      {i.status === "paid" ? <StatusPill tone="green">Paid</StatusPill>
                        : i.status === "pending" ? <StatusPill tone="gold">Transfer being checked</StatusPill>
                        : i.paidKobo > 0 ? <StatusPill tone="gold">{ngn(i.paidKobo)} paid</StatusPill>
                        : <StatusPill tone="red">Due</StatusPill>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className={"text-sm " + MUTED}>No fees have been published for {c.statement.className} yet.</p>}
          </article>
        );
      })}
    </div>
  );
}

/** One payment's receipt, for the parent and the office. */
export function ReceiptBody({ p }: { p: ParentPayment }) {
  const state = paymentState(p);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className={"text-xs " + MUTED}>Receipt number</p><p className="font-mono font-semibold">{p.reference}</p></div>
        <StatusPill tone={state.tone}>{state.label}</StatusPill>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className={MUTED}>Date</dt><dd className="font-medium">{when(p.paidAt ?? p.settledAt ?? p.createdAt)}</dd></div>
        <div><dt className={MUTED}>Method</dt><dd className="font-medium">{channelLabel(p.channel)}</dd></div>
      </dl>
      {p.allocations.length > 0 && (
        <ul className="divide-y divide-[hsl(var(--p-line))] rounded-xl border border-[hsl(var(--p-line))] text-sm">
          {p.allocations.map((a) => (
            <li key={a.studentId + a.itemKey} className="flex justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0"><span className="block font-medium">{a.studentName} <span className={"font-mono text-xs " + MUTED}>{a.studentCode}</span></span><span className={"block text-xs " + MUTED}>{a.description} · {a.term} {a.academicYear}</span></span>
              <span className="shrink-0 font-semibold tabular-nums">{ngn(a.amountKobo)}</span>
            </li>
          ))}
        </ul>
      )}
      <dl className="space-y-1.5 rounded-xl bg-[hsl(var(--p-paper-2))] px-4 py-3 text-sm">
        <div className="flex justify-between"><dt>Paid through Paystack</dt><dd className="tabular-nums">{ngn(p.cardKobo)}</dd></div>
        <div className="flex justify-between"><dt>From the school wallet</dt><dd className="tabular-nums">{ngn(p.walletUsedKobo)}</dd></div>
        <div className="flex justify-between"><dt>Saved to the wallet</dt><dd className="tabular-nums">{ngn(p.walletCreditKobo)}</dd></div>
        <div className="flex justify-between border-t border-[hsl(var(--p-line))] pt-1.5 font-semibold"><dt>Applied to school fees</dt><dd className="tabular-nums">{ngn(p.appliedKobo)}</dd></div>
      </dl>
      {p.status === "failed" && p.gatewayResponse && <p className="text-sm text-[hsl(var(--p-red))]">{p.gatewayResponse}</p>}
      {p.status === "success" && (
        <button type="button" className="portal-btn-ghost w-full justify-center" onClick={() => { if (!printReceipt(p)) window.alert("Allow pop-ups for this site to print the receipt."); }} data-testid="button-print-receipt">
          <Printer size={15} aria-hidden="true" /> Print or save as PDF
        </button>
      )}
    </div>
  );
}

export function ReceiptDialog({ payment, onClose, title }: { payment: ParentPayment | null; onClose: () => void; title?: string }) {
  return (
    <Dialog open={!!payment} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[92dvh] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">{title ?? "Payment receipt"}</DialogTitle>
          <DialogDescription>New World Emerald Private School</DialogDescription>
        </DialogHeader>
        {payment && <ReceiptBody p={payment} />}
      </DialogContent>
    </Dialog>
  );
}

/** Every payment the parent has made or started. */
export function PaymentsView({ payments, onOpen }: { payments: ParentPayment[]; onOpen: (p: ParentPayment) => void }) {
  if (!payments.length) return <EmptyState icon={<Receipt size={22} />} title="No payments yet" body="Your payments and receipts will be listed here." />;
  return (
    <ul className="portal-card divide-y divide-[hsl(var(--p-line))] !p-0">
      {payments.map((p) => {
        const state = paymentState(p);
        const names = [...new Set(p.allocations.map((a) => a.studentName))].join(", ");
        return (
          <li key={p.reference}>
            <button type="button" className="flex min-h-[68px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-[hsl(var(--p-paper-2)/0.6)]" onClick={() => onOpen(p)} data-testid={`row-payment-${p.reference}`}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[hsl(var(--p-paper-2))]" aria-hidden="true">{p.channel === "wallet" ? <Wallet size={17} /> : <CreditCard size={17} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{names || "School fees"}</span>
                <span className={"block text-xs " + MUTED}>{when(p.paidAt ?? p.createdAt)} · <span className="font-mono">{p.reference}</span></span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-semibold tabular-nums">{ngn(p.status === "success" ? p.appliedKobo + p.walletCreditKobo : p.cardKobo)}</span>
                <StatusPill tone={state.tone}>{state.label}</StatusPill>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const ENTRY_LABEL: Record<string, string> = { overpayment: "Overpayment saved", used: "Used for school fees", adjustment: "Adjusted by the school office" };

export function WalletView({ data }: { data: ParentOverview }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
      <section className="rounded-2xl bg-[hsl(var(--p-chrome))] p-6 text-[hsl(var(--p-chrome-ink))]" aria-labelledby="wallet-title">
        <p id="wallet-title" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--p-gold))]"><Wallet size={14} aria-hidden="true" /> School wallet</p>
        <p className="mt-2 font-serif text-4xl font-semibold tabular-nums" data-testid="text-wallet-balance">{ngn(data.wallet.balanceKobo)}</p>
        <p className="mt-3 text-sm leading-relaxed opacity-80">When you pay more than you owe, the extra is kept here. It is used automatically the next time you pay, so you only pay the difference.</p>
      </section>
      <section className="min-w-0" aria-labelledby="history-title">
        <h2 id="history-title" className="mb-3 font-serif text-xl font-semibold">Wallet history</h2>
        {data.wallet.entries.length ? (
          <ul className="portal-card divide-y divide-[hsl(var(--p-line))] !p-0">
            {data.wallet.entries.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0"><span className="block font-medium">{ENTRY_LABEL[e.kind] ?? e.kind}</span><span className={"block text-xs " + MUTED}>{when(e.createdAt)}{e.paymentReference ? ` · ${e.paymentReference}` : ""}{e.kind === "adjustment" && e.note ? ` · ${e.note}` : ""}</span></span>
                <span className="text-right"><span className={"block font-semibold tabular-nums " + (e.amountKobo > 0 ? "text-[hsl(var(--p-emerald))]" : "")}>{e.amountKobo > 0 ? "+" : "−"} {ngn(Math.abs(e.amountKobo))}</span><span className={"block text-xs tabular-nums " + MUTED}>Balance {ngn(e.balanceAfterKobo)}</span></span>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={<Wallet size={22} />} title="Nothing here yet" body="Overpayments and money used from your wallet will be listed here." />}
      </section>
    </div>
  );
}
