import type { ParentPayment } from "@workspace/api-client-react";

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const ngn = (kobo: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 2 }).format(kobo / 100);
export const when = (iso: string | null | undefined) => iso
  ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
  : "";

/** How a payment's state reads to a parent. A card payment left unpaid for two hours is "not completed". */
export function paymentState(p: Pick<ParentPayment, "status" | "createdAt">, now = Date.now()) {
  if (p.status === "success") return { label: "Paid", tone: "green" as const };
  if (p.status === "failed") return { label: "Not paid", tone: "red" as const };
  return now - new Date(p.createdAt).getTime() > 2 * 3_600_000 ? { label: "Not completed", tone: "muted" as const } : { label: "Waiting for Paystack", tone: "gold" as const };
}

export const channelLabel = (c: string | null) => c === "wallet" ? "School wallet" : c ? `Paystack (${c.replace(/_/g, " ")})` : "Paystack";

/** A printable A5-style receipt for one successful payment. */
export function receiptHtml(p: ParentPayment, logoUrl: string) {
  const rows = p.allocations.map((a) => `<tr><td><b>${esc(a.studentName)}</b> <span class="m">${esc(a.studentCode)} · ${esc(a.className)}</span><br><span class="m">${esc(a.description)} · ${esc(a.term)} ${esc(a.academicYear)}</span></td><td class="r">${ngn(a.amountKobo)}</td></tr>`).join("");
  return `<!doctype html><html lang="en-NG"><head><meta charset="utf-8"><title>Receipt ${esc(p.reference)}</title><style>
  @page { size: A4; margin: 18mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #10232c; margin: 0; font-size: 13px; }
  header { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #176345; padding-bottom: 12px; }
  header img { width: 56px; height: 56px; object-fit: contain; }
  h1 { font: 700 20px Georgia, serif; margin: 0; } .m { color: #5c6b70; font-size: 12px; }
  .badge { margin-left: auto; text-align: right; } .badge b { display: block; font: 700 18px Georgia, serif; color: #176345; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; } td { padding: 9px 0; border-bottom: 1px solid #e3ded2; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; } .total td { font-weight: 700; font-size: 15px; border-bottom: 2px solid #10232c; }
  .box { margin-top: 16px; background: #f4f1ea; border-radius: 10px; padding: 12px 16px; display: grid; grid-template-columns: 1fr auto; gap: 4px 16px; }
  footer { margin-top: 28px; font-size: 11px; color: #5c6b70; }
  </style></head><body>
  <header><img src="${esc(logoUrl)}" alt=""><div><h1>New World Emerald Private School</h1><div class="m">Emerald Building, New World Crescent, Oyigene Audu Avenue, F01 Kubwa, Abuja · +234 813 603 7074</div></div>
  <div class="badge"><span class="m">Official receipt</span><b>PAID</b></div></header>
  <table><tr><td><span class="m">Receipt number</span><br><b style="font-family:Consolas,monospace">${esc(p.reference)}</b></td><td class="r"><span class="m">Date</span><br><b>${esc(when(p.paidAt ?? p.settledAt ?? p.createdAt))}</b></td></tr>
  <tr><td><span class="m">Paid by</span><br><b>${esc(p.parentEmail)}</b></td><td class="r"><span class="m">Method</span><br><b>${esc(channelLabel(p.channel))}</b></td></tr></table>
  <table>${rows}<tr class="total"><td>Total applied to school fees</td><td class="r">${ngn(p.appliedKobo)}</td></tr></table>
  <div class="box"><span>Paid through Paystack</span><b class="r">${ngn(p.cardKobo)}</b><span>From the school wallet</span><b class="r">${ngn(p.walletUsedKobo)}</b><span>Saved to the school wallet (overpayment)</span><b class="r">${ngn(p.walletCreditKobo)}</b></div>
  <footer>This receipt was issued automatically after the payment was confirmed with Paystack. Any wallet balance is used automatically for the next payment. Questions: info@newworldemeraldprivateschool.com</footer>
  </body></html>`;
}

/** Opens the receipt in a new window and prints it (inline scripts are blocked there, so printing is driven from here). */
export function printReceipt(p: ParentPayment) {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return false;
  w.document.open();
  w.document.write(receiptHtml(p, `${window.location.origin}/logo.jpg`));
  w.document.close();
  const go = () => { try { w.focus(); w.print(); } catch { /* window closed */ } };
  if (w.document.readyState === "complete") window.setTimeout(go, 300);
  else w.addEventListener("load", () => window.setTimeout(go, 100), { once: true });
  return true;
}
