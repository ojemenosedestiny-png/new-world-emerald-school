import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListFeeTransfersQueryKey, getListPaymentAccountsQueryKey, useListFeeTransfers, useListPaymentAccounts, useManagePaymentAccounts, useReviewFeeTransfer,
  type FeeTransfer, type PaymentAccount, type PaymentAccountInput,
} from "@workspace/api-client-react";
import { CheckCircle2, Image as ImageIcon, Landmark, Pencil, Plus, Printer, Search, Trash2, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Field, Skeleton, StatusPill } from "../ui";
import { errorMessage } from "../lib";
import { imageUrl } from "../photos";
import { day, ngn, printTransferReceipt, transferState, PURPOSE_LABEL, type Purpose } from "./transfers";

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
type Filter = "waiting" | "confirmed" | "rejected" | "all";
const waiting = (t: FeeTransfer) => t.status === "reported" || t.status === "payment_requested";

/** Parents' bank transfers: open the screenshot, check the bank account, then confirm (a receipt is issued) or say it did not arrive. */
export function TransfersReview() {
  const q = useListFeeTransfers({ query: { queryKey: getListFeeTransfersQueryKey(), refetchInterval: 60_000 } });
  const review = useReviewFeeTransfer();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>("waiting");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<FeeTransfer | null>(null);
  const [note, setNote] = useState("");
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError || !q.data) return <ErrorPanel title="Payments did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const s = search.trim().toLowerCase();
  const rows = q.data.transfers.filter((t) => (filter === "all" || (filter === "waiting" ? waiting(t) : t.status === filter))
    && (!s || `${t.studentName} ${t.studentIdentifier} ${t.className} ${t.payer} ${t.reference} ${t.receiptNumber ?? ""}`.toLowerCase().includes(s)));
  const confirmedKobo = q.data.transfers.filter((t) => t.status === "confirmed").reduce((n, t) => n + t.amountKobo, 0);
  const act = async (action: "confirm" | "reject") => {
    if (!open) return;
    try {
      const r = await review.mutateAsync({ id: open.id, data: { action, ...(note.trim() ? { note: note.trim() } : {}) } });
      toast({ title: action === "confirm" ? `Confirmed: receipt ${r.receiptNumber}` : "Marked as not received", description: action === "confirm" ? "The parent sees the receipt in the parent portal and gets it by email." : "The parent is told why and can send it again." });
      setOpen(null); setNote("");
      await qc.invalidateQueries({ queryKey: getListFeeTransfersQueryKey() });
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); }
  };
  const tabs: [Filter, string, number][] = [["waiting", "To check", q.data.waiting], ["confirmed", "Confirmed", q.data.transfers.filter((t) => t.status === "confirmed").length], ["rejected", "Not received", q.data.transfers.filter((t) => t.status === "rejected").length], ["all", "All", q.data.transfers.length]];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="portal-card p-4"><p className={"text-xs font-semibold uppercase tracking-wider " + MUTED}>Waiting for you</p><p className={"mt-1 font-serif text-3xl font-semibold tabular-nums " + (q.data.waiting ? "text-[hsl(var(--p-gold-ink))]" : "")} data-testid="text-transfers-waiting">{q.data.waiting}</p></div>
        <div className="portal-card p-4"><p className={"text-xs font-semibold uppercase tracking-wider " + MUTED}>Confirmed (listed)</p><p className="mt-1 font-serif text-3xl font-semibold tabular-nums">{ngn(confirmedKobo)}</p></div>
        <div className="portal-card p-4 text-sm"><p className="font-semibold">How to check</p><p className={MUTED}>Open the screenshot, find the money in the school's bank account, then confirm. The parent gets the receipt at once.</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-full border border-[hsl(var(--p-line))] p-1" role="tablist">
          {tabs.map(([k, label, n]) => <button key={k} type="button" role="tab" aria-selected={filter === k} className={"portal-tab whitespace-nowrap " + (filter === k ? "!bg-[hsl(var(--p-ink))] !text-[hsl(var(--p-paper))]" : "")} onClick={() => setFilter(k)} data-testid={`tab-transfers-${k}`}>{label} <span className="opacity-60">{n}</span></button>)}
        </div>
        <label className="relative ml-auto min-w-[14rem]"><span className="sr-only">Search payments</span><Search size={15} className={"absolute left-3 top-1/2 -translate-y-1/2 " + MUTED} aria-hidden="true" />
          <input className="portal-input !pl-9" placeholder="Student, parent or receipt" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      </div>
      {!rows.length ? <EmptyState icon={<CheckCircle2 size={22} />} title={filter === "waiting" ? "Nothing to check" : "Nothing here"} body={filter === "waiting" ? "When a parent sends a transfer screenshot, it appears here for you to confirm." : "No payments match."} /> : (
        <div className="portal-card overflow-x-auto !p-0">
          <table className="w-full min-w-[720px] text-sm" data-testid="table-transfers">
            <thead className={"text-left text-xs uppercase tracking-wider " + MUTED}><tr><th className="px-4 py-3">Student</th><th className="px-3 py-3">For</th><th className="px-3 py-3">Sent</th><th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3">Status</th><th className="px-4 py-3" /></tr></thead>
            <tbody>{rows.map((t) => {
              const st = transferState(t);
              return (
                <tr key={t.id} className="border-t border-[hsl(var(--p-line))]" data-testid={`row-transfer-${t.id}`}>
                  <td className="px-4 py-3"><b>{t.studentName}</b><span className={"block text-xs " + MUTED}>{t.studentIdentifier} · {t.className}</span></td>
                  <td className="px-3 py-3"><span className="block">{t.description}</span><span className={"block text-xs " + MUTED}>{PURPOSE_LABEL[t.purpose as Purpose]}{t.academicYear ? ` · ${t.academicYear}` : ""}</span></td>
                  <td className="whitespace-nowrap px-3 py-3">{day(t.createdAt)}<span className={"block max-w-[12rem] truncate text-xs " + MUTED}>{t.payer}</span></td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{ngn(t.amountKobo)}</td>
                  <td className="px-3 py-3"><StatusPill tone={st.tone}>{st.label}</StatusPill>{t.receiptNumber && <span className={"block font-mono text-[11px] " + MUTED}>{t.receiptNumber}</span>}</td>
                  <td className="px-4 py-3 text-right">
                    {waiting(t) ? <button type="button" className="portal-btn !min-h-[32px] !px-3 text-xs" onClick={() => { setNote(""); setOpen(t); }} data-testid={`button-check-${t.id}`}>Check</button>
                      : t.status === "confirmed" ? <button type="button" className="portal-btn-ghost !min-h-[32px] !px-3 text-xs" onClick={() => printTransferReceipt(t)}><Printer size={13} aria-hidden="true" /> Receipt</button>
                      : <button type="button" className="portal-btn-ghost !min-h-[32px] !px-3 text-xs" onClick={() => setOpen(t)}>View</button>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-2xl overflow-y-auto rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">{open?.studentName}: {open ? ngn(open.amountKobo) : ""}</DialogTitle><DialogDescription>{open?.description}{open?.academicYear ? ` · ${open.academicYear}` : ""} · sent {day(open?.createdAt)} by {open?.payer}</DialogDescription></DialogHeader>
          {open && <div className="grid gap-4 sm:grid-cols-[1fr_15rem]">
            {open.proofImageId ? <a href={imageUrl(open.proofImageId)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-[hsl(var(--p-line))] bg-[hsl(var(--p-paper-2)/0.5)]"><img src={imageUrl(open.proofImageId)} alt="Transfer screenshot" className="max-h-[55dvh] w-full object-contain" data-testid="img-transfer-proof" /></a>
              : <p className={"flex items-center gap-2 rounded-xl border border-dashed border-[hsl(var(--p-line))] p-6 text-sm " + MUTED}><ImageIcon size={16} aria-hidden="true" /> No screenshot was sent.</p>}
            <dl className="space-y-2 text-sm">
              <div><dt className={MUTED}>Paid into</dt><dd className="font-semibold">{open.account ? <>{open.account.bankName}<span className="block font-mono">{open.account.accountNumber}</span></> : "Not recorded"}</dd></div>
              {open.transferReference && <div><dt className={MUTED}>Transfer reference</dt><dd className="font-semibold">{open.transferReference}</dd></div>}
              <div><dt className={MUTED}>Student ID</dt><dd className="font-mono">{open.studentIdentifier}</dd></div>
              <div><dt className={MUTED}>Payment reference</dt><dd className="break-all font-mono text-xs">{open.reference}</dd></div>
              {open.officeNote && <div><dt className={MUTED}>Note</dt><dd>{open.officeNote}</dd></div>}
            </dl>
          </div>}
          {open && waiting(open) && <>
            <label className="block text-sm font-semibold">Note for the parent <span className={"font-normal " + MUTED}>(needed if the money did not arrive)</span>
              <input className="portal-input mt-1" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. No money received yet, or the amount is short" data-testid="input-transfer-note" /></label>
            <DialogFooter className="gap-2">
              <button type="button" className="portal-btn-ghost text-[hsl(var(--p-red))]" disabled={review.isPending || note.trim().length < 3} onClick={() => void act("reject")} data-testid="button-reject-transfer"><XCircle size={15} aria-hidden="true" /> Not received</button>
              <button type="button" className="portal-btn" disabled={review.isPending} onClick={() => void act("confirm")} data-testid="button-confirm-transfer"><CheckCircle2 size={15} aria-hidden="true" /> Money received: confirm and issue receipt</button>
            </DialogFooter>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type AccountForm = PaymentAccountInput;
const blank = (purpose: Purpose = "school_fees"): AccountForm => ({ purpose, academicYear: "", bankName: "", accountName: "New World Emerald Private School", accountNumber: "", note: "", active: true });

/** The school's accounts: one for school fees and one for WAEC/NECO, and a different one for a session when it changes. */
export function PaymentAccountsPanel() {
  const q = useListPaymentAccounts({ query: { queryKey: getListPaymentAccountsQueryKey() } });
  const m = useManagePaymentAccounts();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<AccountForm | null>(null);
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError || !q.data) return <ErrorPanel title="Accounts did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const run = async (data: Parameters<typeof m.mutateAsync>[0]["data"], done?: () => void) => {
    try { const r = await m.mutateAsync({ data }); toast({ title: r.message }); done?.(); await qc.invalidateQueries({ queryKey: getListPaymentAccountsQueryKey() }); }
    catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); }
  };
  const edit = (a: PaymentAccount) => setForm({ id: a.id, purpose: a.purpose, academicYear: a.academicYear, bankName: a.bankName, accountName: a.accountName, accountNumber: a.accountNumber, note: a.note, active: a.active });
  return (
    <div className="space-y-4">
      <p className={"max-w-2xl text-sm " + MUTED}>Parents see the right account for each fee. Add one account for school fees and one for WAEC/NECO. If the account changes for a new session, add it for that session (for example 2027/2028); fees for that session use it, and older fees keep theirs.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {(["school_fees", "exam_registration"] as const).map((p) => {
          const list = q.data.accounts.filter((a) => a.purpose === p);
          return (
            <section key={p} className="portal-card space-y-3 p-5" data-testid={`accounts-${p}`}>
              <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-serif text-xl font-semibold"><Landmark size={18} aria-hidden="true" /> {PURPOSE_LABEL[p]}</h3>
                <button type="button" className="portal-btn !min-h-[34px] !px-3 text-xs" onClick={() => setForm(blank(p))} data-testid={`button-add-account-${p}`}><Plus size={13} aria-hidden="true" /> Add account</button></div>
              {!list.length ? <p className={"text-sm " + MUTED}>No account yet. Parents are asked to call the school before paying.</p> : (
                <ul className="space-y-2">{list.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[hsl(var(--p-line))] px-4 py-3" data-testid={`account-${a.id}`}>
                    <span className="min-w-0 flex-1"><span className="block font-mono text-lg font-semibold tracking-wider">{a.accountNumber}</span><span className={"block text-xs " + MUTED}>{a.bankName} · {a.accountName}</span></span>
                    <StatusPill tone={a.active ? (a.academicYear ? "ink" : "green") : "muted"}>{!a.active ? "Not in use" : a.academicYear ? a.academicYear : "Every session"}</StatusPill>
                    <button type="button" className="portal-btn-ghost !min-h-[30px] !px-2 text-xs" onClick={() => edit(a)} aria-label="Edit account"><Pencil size={13} /></button>
                    <button type="button" className="portal-btn-ghost !min-h-[30px] !px-2 text-xs text-[hsl(var(--p-red))]" disabled={m.isPending} onClick={() => { if (window.confirm(`Remove the ${a.bankName} account ${a.accountNumber}? Receipts already issued keep it.`)) void run({ action: "delete", id: a.id }); }} aria-label="Remove account"><Trash2 size={13} /></button>
                  </li>
                ))}</ul>
              )}
            </section>
          );
        })}
      </div>
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="portal !min-h-0 max-w-lg rounded-2xl">
          <DialogHeader><DialogTitle className="font-serif text-2xl">{form?.id ? "Edit account" : `Add ${form ? PURPOSE_LABEL[form.purpose as Purpose] : ""} account`}</DialogTitle><DialogDescription>Check the number twice: parents send money to it.</DialogDescription></DialogHeader>
          {form && <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="For" htmlFor="acc-purpose"><select id="acc-purpose" className="portal-input" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value as Purpose })}><option value="school_fees">School fees</option><option value="exam_registration">WAEC / NECO</option></select></Field>
              <Field label="Session" htmlFor="acc-year" hint="Empty: every session"><input id="acc-year" className="portal-input" list="acc-sessions" placeholder="e.g. 2026/2027" value={form.academicYear} onChange={(e) => setForm({ ...form, academicYear: e.target.value })} data-testid="input-account-session" /><datalist id="acc-sessions">{q.data.sessions.map((s) => <option key={s} value={s} />)}</datalist></Field>
            </div>
            <Field label="Bank" htmlFor="acc-bank"><input id="acc-bank" className="portal-input" maxLength={80} value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} data-testid="input-account-bank" /></Field>
            <Field label="Account name" htmlFor="acc-name"><input id="acc-name" className="portal-input" maxLength={120} value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} /></Field>
            <Field label="Account number" htmlFor="acc-number" hint="10 digits"><input id="acc-number" inputMode="numeric" className="portal-input font-mono text-lg tracking-wider" maxLength={10} value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value.replace(/\D/g, "") })} data-testid="input-account-number" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> In use (shown to parents)</label>
          </div>}
          <DialogFooter><button type="button" className="portal-btn" disabled={m.isPending || !form || form.accountNumber.length !== 10 || form.bankName.trim().length < 2} onClick={() => form && void run({ action: "save", account: form }, () => setForm(null))} data-testid="button-save-account">Save account</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The office's payments page: transfers to check, the bank accounts, and (in the staff portal) earlier card payments. */
export function FeePayments({ legacy }: { legacy?: React.ReactNode }) {
  const [tab, setTab] = useState<"transfers" | "accounts" | "legacy">("transfers");
  const tabs: ["transfers" | "accounts" | "legacy", string][] = [["transfers", "Transfers to confirm"], ["accounts", "Bank accounts"], ...(legacy ? [["legacy", "Earlier card payments"] as ["legacy", string]] : [])];
  return (
    <div className="space-y-5">
      <div className="flex gap-1 overflow-x-auto rounded-full border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface)/0.7)] p-1" role="tablist">
        {tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={"portal-tab whitespace-nowrap " + (tab === k ? "!bg-[hsl(var(--p-ink))] !text-[hsl(var(--p-paper))]" : "")} onClick={() => setTab(k)} data-testid={`tab-fees-${k}`}>{label}</button>)}
      </div>
      {tab === "transfers" && <TransfersReview />}
      {tab === "accounts" && <PaymentAccountsPanel />}
      {tab === "legacy" && legacy}
    </div>
  );
}
