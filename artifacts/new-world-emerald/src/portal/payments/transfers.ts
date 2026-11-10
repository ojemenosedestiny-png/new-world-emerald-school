import type { FeeTransfer, FeeTransferAccount, PaymentAccount } from "@workspace/api-client-react";

export type Purpose = "school_fees" | "exam_registration";
export const PURPOSE_LABEL: Record<Purpose, string> = { school_fees: "School fees", exam_registration: "WAEC / NECO" };

/** The account to pay into: one for this purpose and session, else one for every session (the server applies the same rule). */
export function pickAccount(accounts: PaymentAccount[], purpose: Purpose, academicYear: string): FeeTransferAccount | null {
  const live = accounts.filter((a) => a.active && a.purpose === purpose);
  const a = live.find((x) => x.academicYear === academicYear.trim()) ?? live.find((x) => !x.academicYear);
  return a ? { bankName: a.bankName, accountName: a.accountName, accountNumber: a.accountNumber } : null;
}

export const ngn = (kobo: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 2 }).format(kobo / 100);
export const day = (iso: string | null | undefined) => iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)) : "";

/** How a reported transfer reads to a parent or the office. */
export function transferState(t: Pick<FeeTransfer, "status">) {
  if (t.status === "confirmed") return { label: "Paid", tone: "green" as const };
  if (t.status === "rejected") return { label: "Not received", tone: "red" as const };
  return { label: "Being checked", tone: "gold" as const };
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A printable official receipt for a confirmed bank transfer. */
export function transferReceiptHtml(t: FeeTransfer, logoUrl: string) {
  const row = (label: string, value: string) => `<tr><td class="m">${esc(label)}</td><td><b>${esc(value)}</b></td></tr>`;
  return `<!doctype html><html lang="en-NG"><head><meta charset="utf-8"><title>Receipt ${esc(t.receiptNumber ?? t.reference)}</title><style>
  @page { size: A5; margin: 14mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #10232c; margin: 0; font-size: 13px; }
  header { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #176345; padding-bottom: 12px; }
  header img { width: 58px; height: 58px; object-fit: contain; }
  h1 { font: 700 19px Georgia, serif; margin: 0; } .m { color: #5c6b70; font-size: 12px; }
  .badge { margin-left: auto; text-align: right; } .badge b { display: block; font: 700 20px Georgia, serif; color: #176345; letter-spacing: .08em; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; } td { padding: 8px 0; border-bottom: 1px solid #e3ded2; vertical-align: top; }
  td:first-child { width: 42%; } .amount { margin-top: 18px; background: #f4f1ea; border-radius: 12px; padding: 14px 18px; display: flex; justify-content: space-between; align-items: baseline; }
  .amount b { font: 700 26px Georgia, serif; } footer { margin-top: 26px; font-size: 11px; color: #5c6b70; line-height: 1.5; }
  </style></head><body>
  <header><img src="${esc(logoUrl)}" alt=""><div><h1>New World Emerald Private School</h1><div class="m">Emerald Building, New World Crescent, Oyigene Audu Avenue, F01 Kubwa, Abuja</div></div>
  <div class="badge"><span class="m">Official receipt</span><b>PAID</b></div></header>
  <table>
  ${row("Receipt number", t.receiptNumber ?? "")}
  ${row("Date confirmed", day(t.confirmedAt))}
  ${row("Student", `${t.studentName} (${t.studentIdentifier})`)}
  ${row("Class", t.className)}
  ${row("Payment for", `${t.description}${t.term ? ` · ${t.term}` : ""}${t.academicYear ? ` · ${t.academicYear}` : ""}`)}
  ${row("Paid by", t.payer)}
  ${t.account ? row("Paid into", `${t.account.bankName} · ${t.account.accountNumber} · ${t.account.accountName}`) : ""}
  ${t.transferReference ? row("Transfer reference", t.transferReference) : ""}
  ${row("Payment reference", t.reference)}
  </table>
  <div class="amount"><span>Amount received</span><b>${esc(ngn(t.amountKobo))}</b></div>
  <footer>This receipt was issued by the school office after the bank transfer was received${t.confirmedBy ? ` (confirmed by ${esc(t.confirmedBy)})` : ""}. Keep it for your records. Questions: info@newworldemeraldprivateschool.com · +234 813 603 7074</footer>
  </body></html>`;
}

/** Opens the receipt in a new window and prints it. */
export function printTransferReceipt(t: FeeTransfer) {
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) return false;
  w.document.open();
  w.document.write(transferReceiptHtml(t, `${window.location.origin}/logo.jpg`));
  w.document.close();
  const go = () => { try { w.focus(); w.print(); } catch { /* window closed */ } };
  if (w.document.readyState === "complete") window.setTimeout(go, 300);
  else w.addEventListener("load", () => window.setTimeout(go, 100), { once: true });
  return true;
}
