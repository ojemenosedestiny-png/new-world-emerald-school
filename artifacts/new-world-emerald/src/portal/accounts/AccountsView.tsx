import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSchoolAccountsQueryKey, useDecideSchoolTransaction, useRecordSchoolTransaction, type AccountEntry, type SchoolAccounts } from "@workspace/api-client-react";
import { ArrowDownLeft, ArrowUpRight, Ban, Check, Clock3, Download, ImagePlus, Loader2, LogOut, Minus, Plus, Printer, Receipt, Scale, Search, ShieldCheck, Wallet, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { uploadProof } from "@/components/PaymentProof";
import { asset } from "@/lib/asset";
import { EmptyState, StatusPill } from "../ui";
import { errorMessage } from "../lib";
import { ngn } from "../payments/transfers";
import { accountsCsv, downloadCsv, lagosToday, METHOD_LABEL, monthLabel, parseNaira, presetRange, printStatement, receiptUrl, shortDate, SOURCE_LABEL, statusLabel } from "./ledger";

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";
const PRESETS = [["month", "This month"], ["last-month", "Last month"], ["quarter", "3 months"], ["year", "This year"]] as const;
type Filter = "all" | "in" | "out" | "pending" | "closed";
const FILTERS: [Filter, string][] = [["all", "Everything"], ["in", "Money in"], ["out", "Money out"], ["pending", "Waiting"], ["closed", "Rejected or cancelled"]];

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [getGetSchoolAccountsQueryKey()[0]] });
}

/** Record other income or spending, with a photo of the receipt or invoice. */
function RecordDialog({ open, direction, a, onClose }: { open: boolean; direction: "in" | "out"; a: SchoolAccounts; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const save = useRecordSchoolTransaction();
  const out = direction === "out";
  const cats = out ? a.expenseCategories : a.incomeCategories;
  const blank = { category: "", description: "", counterparty: "", amount: "", date: lagosToday(), method: "transfer", reference: "" };
  const [f, setF] = useState(blank);
  const [receipt, setReceipt] = useState<{ id: string; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const close = () => { setF(blank); setReceipt(null); onClose(); };
  const kobo = parseNaira(f.amount);
  const ready = !!f.category && f.description.trim().length >= 3 && kobo !== null && !!f.date && (!out || f.counterparty.trim().length >= 2) && !uploading;
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast({ variant: "destructive", title: "A picture please", description: "Take a photo of the receipt or invoice." }); return; }
    setUploading(true);
    try { setReceipt({ id: await uploadProof(file), preview: URL.createObjectURL(file) }); }
    catch (e) { toast({ variant: "destructive", title: "Receipt not uploaded", description: errorMessage(e) }); }
    finally { setUploading(false); }
  };
  const send = async () => {
    if (!ready || kobo === null) return;
    try {
      const r = await save.mutateAsync({ data: { direction, category: f.category, description: f.description.trim(), counterparty: f.counterparty.trim(), amountKobo: kobo, date: f.date, method: f.method as "transfer", ...(f.reference.trim() ? { reference: f.reference.trim() } : {}), ...(receipt ? { receiptId: receipt.id } : {}) } });
      toast({ title: r.status === "pending" ? "Sent for approval" : out ? "Spending recorded" : "Income recorded", description: r.status === "pending" ? "The school owner has been told. It counts once approved." : `${ngn(r.amountKobo)} is now in the accounts.` });
      await refresh();
      close();
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); }
  };
  const label = "block text-sm font-semibold";
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">{out ? "Record spending" : "Record money in"}</DialogTitle>
          <DialogDescription>{out ? (a.canApprove ? "You are the school owner, so this counts at once." : "It is sent to the school owner and counts once approved.") : "Income from outside the portal: donations, uniforms, bus, cash. Fee transfers and store orders are added by themselves."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className={label}>Category
            <select className="portal-input mt-1" value={f.category} onChange={set("category")} data-testid="select-entry-category"><option value="">Choose…</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className={label}>What it was for
            <input className="portal-input mt-1" value={f.description} onChange={set("description")} maxLength={200} placeholder={out ? "Diesel for the generator, 200 litres" : "PTA donation for new chairs"} data-testid="input-entry-description" /></label>
          <label className={label}>{out ? "Paid to" : "Received from"} {!out && <span className={"font-normal " + MUTED}>(optional)</span>}
            <input className="portal-input mt-1" value={f.counterparty} onChange={set("counterparty")} maxLength={120} placeholder={out ? "Shop, company or person" : "Who gave the money"} data-testid="input-entry-counterparty" /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>Amount (₦)
              <input className="portal-input mt-1 tabular-nums" inputMode="decimal" value={f.amount} onChange={set("amount")} placeholder="85,000" data-testid="input-entry-amount" />
              {f.amount && <span className={"mt-1 block text-xs font-normal " + (kobo === null ? "text-[hsl(var(--p-red))]" : MUTED)}>{kobo === null ? "Enter an amount like 85000 or 85,000.50" : ngn(kobo)}</span>}</label>
            <label className={label}>Date
              <input type="date" className="portal-input mt-1" value={f.date} max={lagosToday()} onChange={set("date")} data-testid="input-entry-date" /></label>
            <label className={label}>Paid by
              <select className="portal-input mt-1" value={f.method} onChange={set("method")} data-testid="select-entry-method">{["transfer", "cash", "pos", "cheque"].map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select></label>
            <label className={label}>Reference <span className={"font-normal " + MUTED}>(optional)</span>
              <input className="portal-input mt-1" value={f.reference} onChange={set("reference")} maxLength={100} placeholder="Bank ref or receipt no." data-testid="input-entry-reference" /></label>
          </div>
          <div>
            <p className={label}>Receipt or invoice photo <span className={"font-normal " + MUTED}>(recommended)</span></p>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-entry-receipt" />
            {receipt ? (
              <div className="mt-2 flex items-center gap-3 rounded-xl border border-[hsl(var(--p-line))] p-2">
                <img src={receipt.preview} alt="Receipt" className="h-14 w-14 rounded-lg object-cover" />
                <p className="flex-1 text-sm font-semibold text-[hsl(var(--p-emerald))]">Receipt attached</p>
                <button type="button" className="portal-btn-ghost !min-h-[32px] !px-2" aria-label="Remove receipt" onClick={() => setReceipt(null)}><X size={14} /></button>
              </div>
            ) : (
              <button type="button" className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[hsl(var(--p-line))] py-4 text-sm font-semibold hover:bg-[hsl(var(--p-paper-2)/0.5)]" disabled={uploading} onClick={() => fileRef.current?.click()} data-testid="button-entry-receipt">
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />} {uploading ? "Uploading…" : "Add a photo"}
              </button>
            )}
          </div>
          <button type="button" className="portal-btn w-full justify-center !py-3.5" disabled={!ready || save.isPending} onClick={() => void send()} data-testid="button-save-entry">
            {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {out && !a.canApprove ? "Send for approval" : "Save"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Decision = { entry: AccountEntry; action: "approve" | "reject" | "void" | "cancel" };
const DECISION_TEXT = {
  approve: ["Approve this spending?", "It will count in the accounts.", "Approve"],
  reject: ["Do not approve", "Tell the bursar why. It will not count in the accounts.", "Do not approve"],
  void: ["Cancel this entry", "It stops counting in the accounts but stays on record. Write the reason.", "Cancel entry"],
  cancel: ["Withdraw this entry", "It will no longer wait for approval.", "Withdraw"],
} as const;

function DecisionDialog({ d, onClose }: { d: Decision | null; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const decide = useDecideSchoolTransaction();
  const [note, setNote] = useState("");
  const needsNote = d?.action === "reject" || d?.action === "void";
  const close = () => { setNote(""); onClose(); };
  const go = async () => {
    if (!d?.entry.id) return;
    try {
      await decide.mutateAsync({ id: d.entry.id, data: { action: d.action, ...(note.trim() ? { note: note.trim() } : {}) } });
      toast({ title: d.action === "approve" ? "Approved" : d.action === "reject" ? "Not approved" : d.action === "void" ? "Entry cancelled" : "Withdrawn" });
      await refresh();
      close();
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); }
  };
  const [title, body, button] = d ? DECISION_TEXT[d.action] : ["", "", ""];
  return (
    <Dialog open={!!d} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="portal !min-h-0 max-w-md rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">{title}</DialogTitle><DialogDescription>{body}</DialogDescription></DialogHeader>
        {d && <div className="rounded-xl bg-[hsl(var(--p-paper-2)/0.6)] p-4 text-sm"><p className="font-semibold">{d.entry.description}</p><p className={MUTED}>{d.entry.category}{d.entry.counterparty ? ` · ${d.entry.counterparty}` : ""} · {shortDate(d.entry.date)}</p><p className="mt-1 font-serif text-2xl font-semibold tabular-nums">{ngn(d.entry.amountKobo)}</p></div>}
        {(needsNote || d?.action === "approve") && <label className="block text-sm font-semibold">{needsNote ? "Reason" : "Note"} {!needsNote && <span className={"font-normal " + MUTED}>(optional)</span>}
          <textarea className="portal-input mt-1 min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} data-testid="input-decision-note" /></label>}
        <button type="button" className={(d?.action === "approve" ? "portal-btn" : "portal-btn-ghost") + " w-full justify-center !py-3"} disabled={decide.isPending || (needsNote && note.trim().length < 3)} onClick={() => void go()} data-testid="button-confirm-decision">
          {decide.isPending && <Loader2 size={16} className="animate-spin" />} {button}
        </button>
      </DialogContent>
    </Dialog>
  );
}

/** Money in and out by month, side by side. */
function MonthBars({ months }: { months: SchoolAccounts["months"] }) {
  const shown = months.slice(-12);
  const top = Math.max(1, ...shown.flatMap((m) => [m.inKobo, m.outKobo]));
  if (!shown.some((m) => m.inKobo || m.outKobo)) return <p className={"py-10 text-center text-sm " + MUTED}>Nothing counted in this period yet.</p>;
  return (
    <div>
      <div className="flex h-48 items-end gap-3" role="img" aria-label={shown.map((m) => `${monthLabel(m.month)}: in ${ngn(m.inKobo)}, out ${ngn(m.outKobo)}`).join("; ")}>
        {shown.map((m) => (
          <div key={m.month} className="flex h-full flex-1 items-end justify-center gap-1" title={`${monthLabel(m.month)} · in ${ngn(m.inKobo)} · out ${ngn(m.outKobo)}`}>
            <div className="w-full max-w-[22px] rounded-t-md bg-[hsl(var(--p-emerald))]" style={{ height: `${Math.max(m.inKobo ? 3 : 0, (m.inKobo / top) * 100)}%` }} />
            <div className="w-full max-w-[22px] rounded-t-md bg-[hsl(var(--p-gold))]" style={{ height: `${Math.max(m.outKobo ? 3 : 0, (m.outKobo / top) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className={"mt-2 flex gap-3 text-[11px] " + MUTED}>{shown.map((m) => <span key={m.month} className="flex-1 text-center">{monthLabel(m.month)}</span>)}</div>
      <div className={"mt-3 flex gap-4 text-xs " + MUTED}><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--p-emerald))]" /> Money in</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-[hsl(var(--p-gold))]" /> Money out</span></div>
    </div>
  );
}

function Categories({ a, direction }: { a: SchoolAccounts; direction: "in" | "out" }) {
  const rows = a.categories.filter((c) => c.direction === direction);
  const total = rows.reduce((s, c) => s + c.amountKobo, 0);
  return (
    <section className="portal-card p-5" aria-label={direction === "in" ? "Money in by category" : "Money out by category"}>
      <h2 className="font-serif text-lg font-semibold">{direction === "in" ? "Where money came from" : "Where money went"}</h2>
      {rows.length === 0 ? <p className={"mt-3 text-sm " + MUTED}>Nothing in this period.</p> : (
        <ul className="mt-3 space-y-3">{rows.map((c) => (
          <li key={c.category}>
            <div className="flex items-baseline justify-between gap-2 text-sm"><span>{c.category} <span className={"text-xs " + MUTED}>· {c.count}</span></span><b className="tabular-nums">{ngn(c.amountKobo)}</b></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--p-paper-2))]"><div className="h-full rounded-full" style={{ width: `${total ? (c.amountKobo / total) * 100 : 0}%`, background: `hsl(var(${direction === "in" ? "--p-emerald" : "--p-gold"}))` }} /></div>
          </li>
        ))}</ul>
      )}
    </section>
  );
}

/** One row in the book, with what this person may do to it. */
function EntryRow({ e, a, me, onDecide }: { e: AccountEntry; a: SchoolAccounts; me: string; onDecide: (d: Decision) => void }) {
  const st = statusLabel(e);
  const inn = e.direction === "in";
  const crossed = e.status === "rejected" || e.status === "void";
  const decided = e.source === "manual" && e.direction === "out" && e.decidedBy && e.status !== "pending";
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-[hsl(var(--p-line))] px-4 py-3 sm:grid-cols-[104px_1fr_auto_150px_auto] sm:items-start sm:px-5" data-testid={`row-entry-${e.key}`}>
      <span className={"col-span-2 text-xs tabular-nums sm:col-span-1 sm:pt-0.5 sm:text-sm " + MUTED}>{shortDate(e.date)}</span>
      <div className="min-w-0 text-sm">
        <p className={"font-semibold " + (crossed ? "line-through decoration-[hsl(var(--p-ink)/0.35)]" : "")}>{e.description}</p>
        <p className={"text-xs " + MUTED}>{e.category}{e.counterparty ? ` · ${inn ? "from" : "to"} ${e.counterparty}` : ""} · {METHOD_LABEL[e.method] ?? e.method}{e.reference ? ` · ${e.reference}` : ""}</p>
        <p className={"text-[11px] " + MUTED}>{SOURCE_LABEL[e.source]}{e.source === "manual" ? ` by ${e.recordedBy}` : ""}{decided ? ` · ${e.status === "rejected" ? "declined" : e.status === "void" ? "cancelled" : "approved"} by ${e.decidedBy}` : ""}</p>
        {e.note && e.source === "manual" && <p className="mt-1 text-xs italic">“{e.note}”</p>}
      </div>
      <span className={"whitespace-nowrap text-right font-semibold tabular-nums " + (inn ? "text-[hsl(var(--p-emerald))]" : "")}>{inn ? "+" : "−"}{ngn(e.amountKobo)}</span>
      <span className="col-span-2 sm:col-span-1"><StatusPill tone={st.tone}>{st.label}</StatusPill></span>
      <div className="col-span-2 flex flex-wrap justify-start gap-1 sm:col-span-1 sm:justify-end">
        {e.receiptId && <a href={receiptUrl(e.receiptId)} target="_blank" rel="noreferrer" className="portal-btn-ghost !min-h-[32px] !px-2" aria-label="Open the receipt" title="Receipt"><Receipt size={14} /></a>}
        {a.canApprove && e.status === "pending" && <>
          <button type="button" className="portal-btn !min-h-[32px] !px-2.5 text-xs" onClick={() => onDecide({ entry: e, action: "approve" })} data-testid={`button-approve-${e.id}`}><Check size={14} /> Approve</button>
          <button type="button" className="portal-btn-ghost !min-h-[32px] !px-2" aria-label="Do not approve" onClick={() => onDecide({ entry: e, action: "reject" })} data-testid={`button-reject-${e.id}`}><X size={14} /></button>
        </>}
        {!a.canApprove && e.status === "pending" && e.recordedBy === me && <button type="button" className="portal-btn-ghost !min-h-[32px] !px-2.5 text-xs" onClick={() => onDecide({ entry: e, action: "cancel" })} data-testid={`button-withdraw-${e.id}`}>Withdraw</button>}
        {a.canApprove && e.source === "manual" && e.status === "approved" && <button type="button" className="portal-btn-ghost !min-h-[32px] !px-2" aria-label="Cancel this entry" title="Cancel entry" onClick={() => onDecide({ entry: e, action: "void" })} data-testid={`button-void-${e.id}`}><Ban size={14} /></button>}
      </div>
    </li>
  );
}

/** The school accounts: totals, spending waiting for approval, months, categories and the full book. */
export function AccountsView({ a, me, firstName, onRange, onLeave }: { a: SchoolAccounts; me: string; firstName: string; onRange: (r: { from: string; to: string }) => void; onLeave: () => void }) {
  const [record, setRecord] = useState<"in" | "out" | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return a.entries.filter((e) => {
      if (filter === "in" && !(e.direction === "in" && e.status === "approved")) return false;
      if (filter === "out" && !(e.direction === "out" && e.status === "approved")) return false;
      if (filter === "pending" && e.status !== "pending") return false;
      if (filter === "closed" && e.status !== "rejected" && e.status !== "void") return false;
      return !q || [e.description, e.category, e.counterparty, e.reference, e.recordedBy].some((v) => v.toLowerCase().includes(q));
    });
  }, [a.entries, filter, search]);
  const preset = PRESETS.find(([p]) => { const r = presetRange(p); return r.from === a.from && r.to === a.to; })?.[0];
  const kpis: [typeof Wallet, string, string, string, string][] = [
    [ArrowDownLeft, "Money in", ngn(a.totals.inKobo), "fees, store and other income", "in"],
    [ArrowUpRight, "Money out", ngn(a.totals.outKobo), "approved spending", "out"],
    [Scale, "Net", ngn(a.totals.netKobo), a.totals.netKobo >= 0 ? "more in than out" : "more out than in", "net"],
    [Wallet, "Balance to date", ngn(a.totals.balanceKobo), "everything recorded so far", "balance"],
  ];
  const ownPending = a.pending.filter((e) => a.canApprove || e.recordedBy === me);

  return (
    <main className="portal min-h-screen pb-16">
      <header className="portal-hero px-4 pb-24 pt-6 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <img src={asset("/logo.jpg")} alt="" className="h-11 w-11 rounded-full bg-white object-contain p-0.5" />
          <div className="min-w-0 flex-1"><p className="font-serif text-base font-semibold leading-tight sm:text-lg">New World Emerald Private School</p><p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--p-gold))]">School accounts</p></div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1 text-xs text-white/85" data-testid="text-accounts-role"><ShieldCheck size={13} aria-hidden="true" /> {a.canApprove ? "School owner · approves spending" : "Bursar"}</span>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-white/80 hover:bg-white/10" onClick={onLeave}><LogOut size={13} aria-hidden="true" /> Sign out</button>
        </div>
        <div className="mx-auto mt-10 flex max-w-6xl flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-white/75">Good day{firstName ? `, ${firstName}` : ""}.</p>
            <h1 className="mt-1 font-serif text-4xl font-semibold leading-tight sm:text-5xl">Money in and out</h1>
            <p className="mt-2 text-sm text-white/70">{shortDate(a.from)} to {shortDate(a.to)}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap gap-1 rounded-full border border-white/20 bg-white/[0.06] p-1" role="group" aria-label="Period">
              {PRESETS.map(([p, label]) => <button key={p} type="button" aria-pressed={preset === p} onClick={() => onRange(presetRange(p))} className={"rounded-full px-3.5 py-1.5 text-sm " + (preset === p ? "bg-[hsl(var(--p-gold))] font-semibold text-[hsl(var(--p-ink))]" : "text-white/85 hover:bg-white/10")} data-testid={`button-range-${p}`}>{label}</button>)}
            </div>
            <div className="flex items-center gap-2 text-xs text-white/80">
              <label className="flex items-center gap-1">From <input type="date" value={a.from} max={a.to} onChange={(e) => e.target.value && onRange({ from: e.target.value, to: a.to })} className="rounded-md border border-white/25 bg-white/10 px-2 py-1 text-white [color-scheme:dark]" data-testid="input-range-from" /></label>
              <label className="flex items-center gap-1">to <input type="date" value={a.to} min={a.from} max={lagosToday()} onChange={(e) => e.target.value && onRange({ from: a.from, to: e.target.value })} className="rounded-md border border-white/25 bg-white/10 px-2 py-1 text-white [color-scheme:dark]" data-testid="input-range-to" /></label>
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto -mt-16 max-w-6xl space-y-6 px-4 sm:px-8">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Totals">
          {kpis.map(([Icon, label, value, sub, id]) => (
            <div key={id} className="portal-card !bg-[hsl(var(--p-surface))] p-5 shadow-lg" data-testid={`kpi-${id}`}>
              <p className={"flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] " + MUTED}><Icon size={14} aria-hidden="true" className="text-[hsl(var(--p-emerald))]" /> {label}</p>
              <p className={"mt-2 font-serif text-3xl font-semibold tabular-nums " + (id === "net" && a.totals.netKobo < 0 ? "text-[hsl(var(--p-red))]" : "")}>{value}</p>
              <p className={"mt-1 text-xs " + MUTED}>{sub}</p>
            </div>
          ))}
        </section>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="portal-btn" onClick={() => setRecord("in")} data-testid="button-record-in"><Plus size={16} /> Record money in</button>
          <button type="button" className="portal-btn" onClick={() => setRecord("out")} data-testid="button-record-out"><Minus size={16} /> Record spending</button>
          <span className="flex-1" />
          <button type="button" className="portal-btn-ghost" onClick={() => printStatement(a)} data-testid="button-print-statement"><Printer size={16} /> Print statement</button>
          <button type="button" className="portal-btn-ghost" onClick={() => downloadCsv(`school-accounts-${a.from}-to-${a.to}.csv`, accountsCsv(a.entries))} data-testid="button-export-accounts"><Download size={16} /> Excel (CSV)</button>
        </div>

        {ownPending.length > 0 && (
          <section className="portal-card border-l-4 border-l-[hsl(var(--p-gold))] !p-0" aria-labelledby="pending-title" data-testid="panel-pending">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5 sm:px-6">
              <h2 id="pending-title" className="flex items-center gap-2 font-serif text-xl font-semibold"><Clock3 size={18} aria-hidden="true" className="text-[hsl(var(--p-gold-ink))]" /> {a.canApprove ? "Waiting for your approval" : "Waiting for the school owner"}</h2>
              <span className={"text-sm " + MUTED}>{a.pending.length} · {ngn(a.totals.pendingKobo)}</span>
            </div>
            <ul className="mt-3">{ownPending.map((e) => <EntryRow key={e.key} e={e} a={a} me={me} onDecide={setDecision} />)}</ul>
          </section>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-start">
          <section className="portal-card p-5 sm:p-6" aria-labelledby="months-title">
            <h2 id="months-title" className="font-serif text-xl font-semibold">Month by month</h2>
            <div className="mt-4"><MonthBars months={a.months} /></div>
          </section>
          <div className="space-y-6"><Categories a={a} direction="in" /><Categories a={a} direction="out" /></div>
        </div>

        <section className="portal-card !p-0" aria-labelledby="book-title">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 sm:px-6">
            <h2 id="book-title" className="font-serif text-xl font-semibold">Every entry</h2>
            <label className="relative w-full sm:w-64"><Search size={14} className={"absolute left-3 top-1/2 -translate-y-1/2 " + MUTED} aria-hidden="true" /><input className="portal-input !pl-8" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search entries" data-testid="input-search-entries" /></label>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 px-5 sm:px-6" role="group" aria-label="Show">
            {FILTERS.map(([f, label]) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={"rounded-full border px-3 py-1 text-xs " + (filter === f ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald))] font-semibold text-white" : "border-[hsl(var(--p-line))] hover:bg-[hsl(var(--p-paper-2))]")} data-testid={`filter-${f}`}>{label}</button>)}
          </div>
          {shown.length === 0 ? <div className="p-6"><EmptyState icon={<Receipt size={22} />} title="No entries" body={a.entries.length ? "Nothing matches. Try another filter or search." : "Nothing in this period yet. Confirmed fee transfers appear here by themselves; record other income and spending with the buttons above."} /></div> : (
            <div className="mt-3">
              <div className={"hidden grid-cols-[104px_1fr_auto_150px_auto] gap-x-3 px-5 pb-2 text-xs uppercase tracking-wider sm:grid " + MUTED} aria-hidden="true"><span>Date</span><span>Details</span><span className="text-right">Amount</span><span>Status</span><span /></div>
              <ul data-testid="table-entries">{shown.map((e) => <EntryRow key={e.key} e={e} a={a} me={me} onDecide={setDecision} />)}</ul>
            </div>
          )}
        </section>
        <p className={"text-center text-xs " + MUTED}>Fee transfers confirmed by the office, card payments and paid store orders are added by themselves. Spending counts only after the school owner approves it. The balance is what the portal has recorded, not a bank statement.</p>
      </div>

      <RecordDialog open={record !== null} direction={record ?? "in"} a={a} onClose={() => setRecord(null)} />
      <DecisionDialog d={decision} onClose={() => setDecision(null)} />
    </main>
  );
}
