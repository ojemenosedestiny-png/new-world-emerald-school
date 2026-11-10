import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetParentOverviewQueryKey, useReportParentTransfer, type FeeTransfer, type FeeTransferAccount, type ParentOverview } from "@workspace/api-client-react";
import { Building2, Check, Clock3, Copy, GraduationCap, ImagePlus, Landmark, Loader2, Printer, Receipt, ShieldCheck, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { uploadProof } from "@/components/PaymentProof";
import { EmptyState, StatusPill } from "../ui";
import { errorMessage } from "../lib";
import { day, ngn, pickAccount, printTransferReceipt, transferState, PURPOSE_LABEL, type Purpose } from "./transfers";

const MUTED = "text-[hsl(var(--p-ink)/0.62)]";

/** One fee a parent can pay: a statement item or a WAEC/NECO registration fee. */
export type PayItem = { studentId: number; studentName: string; studentCode: string; itemKey: string; description: string; detail: string; academicYear: string; amountKobo: number; purpose: Purpose; status: "due" | "pending" | "paid" };

/** Everything owed or being checked, per child, from the statements and the WAEC/NECO fees. */
export function payItems(data: ParentOverview): PayItem[] {
  const fees = data.children.flatMap((c) => c.statement.items.filter((i) => i.status !== "paid").map((i) => ({
    studentId: c.id, studentName: c.name, studentCode: c.studentId, itemKey: i.key, description: i.description, detail: [i.term, i.academicYear].filter(Boolean).join(" · "),
    academicYear: i.academicYear, amountKobo: i.amountKobo - i.paidKobo, purpose: "school_fees" as const, status: i.status as "due" | "pending",
  })));
  const exams = data.examFees.filter((f) => f.status !== "paid").map((f) => ({
    studentId: f.studentId, studentName: f.studentName, studentCode: f.studentCode, itemKey: f.itemKey, description: f.title, detail: `${f.className} · ${f.academicYear}`,
    academicYear: f.academicYear, amountKobo: f.amountKobo, purpose: "exam_registration" as const, status: f.status,
  }));
  return [...exams, ...fees];
}

function CopyLine({ label, value, mono = false, testId }: { label: string; value: string; mono?: boolean; testId?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0"><p className={"text-[11px] font-semibold uppercase tracking-[0.14em] " + MUTED}>{label}</p><p className={(mono ? "font-mono text-xl tracking-wider " : "font-semibold ") + "break-all"} data-testid={testId}>{value}</p></div>
      <button type="button" className="portal-btn-ghost !min-h-[34px] shrink-0 !px-3 text-xs" onClick={() => void navigator.clipboard?.writeText(value).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); }, () => undefined)} aria-label={`Copy ${label.toLowerCase()}`}>
        {done ? <><Check size={13} aria-hidden="true" /> Copied</> : <><Copy size={13} aria-hidden="true" /> Copy</>}
      </button>
    </div>
  );
}

/** The school account to pay into, with one-tap copies. */
export function AccountCard({ account, purpose }: { account: FeeTransferAccount | null; purpose: Purpose }) {
  if (!account) return <p className="rounded-xl bg-[hsl(var(--p-gold-soft))] p-4 text-sm text-[hsl(var(--p-gold-ink))]" data-testid="text-no-account">The school has not added the {PURPOSE_LABEL[purpose]} account yet. Please call the school office on +234 813 603 7074 before paying.</p>;
  return (
    <div className="rounded-2xl bg-[hsl(var(--p-chrome))] px-5 py-3 text-[hsl(var(--p-chrome-ink))]" data-testid={`account-${purpose}`}>
      <p className="flex items-center gap-2 pt-2 text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--p-gold))]"><Landmark size={14} aria-hidden="true" /> {PURPOSE_LABEL[purpose]} account</p>
      <div className="divide-y divide-[hsl(var(--p-chrome-ink)/0.12)]">
        <CopyLine label="Account number" value={account.accountNumber} mono testId="text-transfer-account-number" />
        <CopyLine label="Bank" value={account.bankName} />
        <CopyLine label="Account name" value={account.accountName} />
      </div>
    </div>
  );
}

/** Pay one fee by transfer: the right account, the amount, then the screenshot. */
function TransferDialog({ item, account, onClose }: { item: PayItem | null; account: FeeTransferAccount | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const report = useReportParentTransfer();
  const fileRef = useRef<HTMLInputElement>(null);
  const [proof, setProof] = useState<{ id: string; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ref, setRef] = useState("");
  const close = () => { setProof(null); setRef(""); onClose(); };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast({ variant: "destructive", title: "A picture please", description: "Upload a screenshot or photo of the transfer." }); return; }
    setUploading(true);
    try { setProof({ id: await uploadProof(f), preview: URL.createObjectURL(f) }); }
    catch (e) { toast({ variant: "destructive", title: "Screenshot not uploaded", description: errorMessage(e) }); }
    finally { setUploading(false); }
  };
  const send = async () => {
    if (!item || !proof) return;
    try {
      await report.mutateAsync({ data: { studentId: item.studentId, itemKey: item.itemKey, proofId: proof.id, ...(ref.trim() ? { transferReference: ref.trim() } : {}) } });
      toast({ title: "Sent to the school office", description: "You will get a receipt here and by email once the school confirms the money arrived." });
      await queryClient.invalidateQueries({ queryKey: getGetParentOverviewQueryKey() });
      close();
    } catch (e) { toast({ variant: "destructive", title: "Not sent", description: errorMessage(e) }); }
  };
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && close()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Pay by bank transfer</DialogTitle>
          <DialogDescription>{item?.description} for {item?.studentName}</DialogDescription>
        </DialogHeader>
        {item && <div className="space-y-4">
          <div className="flex items-baseline justify-between rounded-xl border border-[hsl(var(--p-line))] px-4 py-3">
            <span className={"text-sm " + MUTED}>Amount to transfer</span>
            <span className="font-serif text-3xl font-semibold tabular-nums" data-testid="text-transfer-amount">{ngn(item.amountKobo)}</span>
          </div>
          <ol className="space-y-4">
            <li><p className="mb-2 text-sm font-semibold">1. Transfer to this account</p><AccountCard account={account} purpose={item.purpose} /></li>
            <li className="text-sm"><p className="font-semibold">2. In the transfer note (narration), write</p><p className="mt-1 rounded-lg bg-[hsl(var(--p-paper-2)/0.7)] px-3 py-2 font-mono">{item.studentName} {item.studentCode}</p></li>
            <li>
              <p className="text-sm font-semibold">3. Upload the screenshot of the transfer</p>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-transfer-proof" />
              {proof ? (
                <div className="mt-2 flex items-center gap-3 rounded-xl border border-[hsl(var(--p-emerald)/0.4)] bg-[hsl(var(--p-emerald-soft))] p-2">
                  <img src={proof.preview} alt="Your transfer screenshot" className="h-16 w-16 rounded-lg object-cover" />
                  <p className="flex-1 text-sm font-semibold text-[hsl(var(--p-emerald))]">Screenshot attached</p>
                  <button type="button" className="portal-btn-ghost !min-h-[32px] !px-2" aria-label="Remove screenshot" onClick={() => setProof(null)}><X size={14} /></button>
                </div>
              ) : (
                <button type="button" className="mt-2 flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed border-[hsl(var(--p-line))] py-6 text-sm hover:bg-[hsl(var(--p-paper-2)/0.5)]" disabled={uploading} onClick={() => fileRef.current?.click()} data-testid="button-transfer-proof">
                  {uploading ? <Loader2 className="animate-spin" size={20} aria-hidden="true" /> : <ImagePlus size={22} aria-hidden="true" />}
                  <span className="font-semibold">{uploading ? "Uploading..." : "Choose the screenshot"}</span><span className={"text-xs " + MUTED}>A photo or screenshot of the successful transfer</span>
                </button>
              )}
            </li>
            <li><label className="block text-sm font-semibold">Transfer reference or sender name <span className={"font-normal " + MUTED}>(optional)</span>
              <input className="portal-input mt-1" maxLength={80} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="From your bank's receipt" data-testid="input-transfer-reference" /></label></li>
          </ol>
          <button type="button" className="portal-btn w-full justify-center !py-3.5" disabled={!proof || report.isPending || uploading || !account} onClick={() => void send()} data-testid="button-send-transfer">
            {report.isPending ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Sending...</> : "I have paid: send to the school"}
          </button>
          <p className={"flex gap-2 text-xs leading-relaxed " + MUTED}><ShieldCheck size={15} className="mt-0.5 shrink-0 text-[hsl(var(--p-emerald))]" aria-hidden="true" />The school office checks the account and confirms. Your official receipt then appears under Receipts and is emailed to you.</p>
        </div>}
      </DialogContent>
    </Dialog>
  );
}

/** What is owed for each child (school fees and WAEC/NECO), each paid by transfer with a screenshot. */
export function TransferFees({ data }: { data: ParentOverview }) {
  const [paying, setPaying] = useState<PayItem | null>(null);
  const items = payItems(data);
  const due = items.filter((i) => i.status === "due");
  const owed = due.reduce((n, i) => n + i.amountKobo, 0);
  const checking = items.filter((i) => i.status === "pending").length;
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl bg-[hsl(var(--p-chrome))] text-[hsl(var(--p-chrome-ink))]" aria-labelledby="owed-title">
        <div className="grid gap-5 p-6 sm:grid-cols-[1fr_auto] sm:items-end sm:p-8">
          <div>
            <p id="owed-title" className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--p-gold))]">Still to pay</p>
            <p className="mt-2 font-serif text-4xl font-semibold tabular-nums sm:text-5xl" data-testid="text-total-outstanding">{ngn(owed)}</p>
            <p className="mt-2 text-sm opacity-80">{data.children.length === 1 ? "For 1 child" : `For ${data.children.length} children`} · pay by bank transfer and upload the screenshot</p>
          </div>
          {checking > 0 && <p className="flex items-center gap-2 rounded-xl border border-[hsl(var(--p-chrome-ink)/0.18)] px-4 py-3 text-sm" data-testid="text-checking-count"><Clock3 size={16} aria-hidden="true" /> {checking} {checking === 1 ? "payment" : "payments"} being checked</p>}
        </div>
      </section>
      {!items.length ? <EmptyState icon={<ShieldCheck size={22} />} title="All fees are paid" body="There is nothing to pay right now. New fees appear here as soon as the school publishes them." /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.children.map((c) => {
            const mine = items.filter((i) => i.studentId === c.id);
            if (!mine.length) return null;
            return (
              <section key={c.id} className="portal-card overflow-hidden !p-0" data-testid={`fees-child-${c.id}`} aria-label={`Fees for ${c.name}`}>
                <div className="flex items-center gap-3 border-b border-[hsl(var(--p-line))] px-5 py-4">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-[hsl(var(--p-emerald-soft))] font-semibold text-[hsl(var(--p-emerald))]" aria-hidden="true">{c.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("")}</span>
                  <div className="min-w-0"><p className="truncate font-semibold">{c.name}</p><p className={"text-xs " + MUTED}>{c.statement.className} · <span className="font-mono">{c.studentId}</span></p></div>
                </div>
                <ul className="divide-y divide-[hsl(var(--p-line))]">
                  {mine.map((i) => (
                    <li key={i.itemKey} className="flex flex-wrap items-center gap-3 px-5 py-4" data-testid={`fee-${c.id}-${i.itemKey}`}>
                      <span className={"grid h-9 w-9 shrink-0 place-items-center rounded-lg " + (i.purpose === "exam_registration" ? "bg-[hsl(var(--p-gold-soft))] text-[hsl(var(--p-gold-ink))]" : "bg-[hsl(var(--p-paper-2))]")} aria-hidden="true">{i.purpose === "exam_registration" ? <GraduationCap size={17} /> : <Building2 size={17} />}</span>
                      <span className="min-w-0 flex-1"><span className="block font-medium">{i.description}</span><span className={"block text-xs " + MUTED}>{i.detail}</span></span>
                      <span className="text-right"><span className="block font-semibold tabular-nums">{ngn(i.amountKobo)}</span>
                        {i.status === "pending" ? <StatusPill tone="gold">Being checked</StatusPill>
                          : <button type="button" className="portal-btn mt-1 !min-h-[34px] !px-3 text-xs" onClick={() => setPaying(i)} data-testid={`button-pay-${c.id}-${i.itemKey}`}>Pay by transfer</button>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      <TransferDialog item={paying} account={paying ? pickAccount(data.accounts, paying.purpose, paying.academicYear) : null} onClose={() => setPaying(null)} />
    </div>
  );
}

/** Every transfer reported for the family, with the printable receipt once the school confirms it. */
export function TransferReceipts({ transfers }: { transfers: FeeTransfer[] }) {
  if (!transfers.length) return <EmptyState icon={<Receipt size={22} />} title="No payments yet" body="After you pay by transfer and send the screenshot, it is listed here. Your receipt appears once the school confirms it." />;
  return (
    <ul className="portal-card divide-y divide-[hsl(var(--p-line))] !p-0" data-testid="list-transfers">
      {transfers.map((t) => {
        const s = transferState(t);
        return (
          <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-4" data-testid={`transfer-${t.id}`}>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{t.description} · {t.studentName}</span>
              <span className={"block text-xs " + MUTED}>{t.receiptNumber ? <span className="font-mono">{t.receiptNumber}</span> : `Sent ${day(t.createdAt)}`}{t.academicYear ? ` · ${t.academicYear}` : ""}</span>
              {t.status === "rejected" && t.officeNote && <span className="mt-1 block rounded-lg bg-[hsl(var(--p-red)/0.07)] px-3 py-1.5 text-sm"><b>School office:</b> {t.officeNote}</span>}
            </span>
            <span className="flex flex-col items-end gap-1">
              <span className="font-semibold tabular-nums">{ngn(t.amountKobo)}</span>
              <StatusPill tone={s.tone}>{s.label}</StatusPill>
            </span>
            {t.status === "confirmed" && <button type="button" className="portal-btn-ghost !min-h-[34px] !px-3 text-xs" onClick={() => printTransferReceipt(t)} data-testid={`button-receipt-${t.id}`}><Printer size={13} aria-hidden="true" /> Receipt</button>}
          </li>
        );
      })}
    </ul>
  );
}
