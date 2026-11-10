import type { AccountEntry, SchoolAccounts } from "@workspace/api-client-react";
import { ngn } from "../payments/transfers";

export const SOURCE_LABEL: Record<AccountEntry["source"], string> = { manual: "Recorded by hand", fee_transfer: "Parent transfer", card: "Card payment", store: "School store" };
export const METHOD_LABEL: Record<string, string> = { transfer: "Bank transfer", cash: "Cash", pos: "POS", cheque: "Cheque", card: "Card" };

/** Today in Lagos as YYYY-MM-DD. */
export const lagosToday = (now = new Date()) => new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);

/** Ready-made periods: this month, last month, the last three months, this year. */
export function presetRange(preset: "month" | "last-month" | "quarter" | "year", now = new Date()): { from: string; to: string } {
  const today = lagosToday(now);
  const [y, m] = today.split("-").map(Number);
  const first = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  if (preset === "last-month") { const [yy, mm] = m === 1 ? [y - 1, 12] : [y, m - 1]; return { from: first(yy, mm), to: lastDay(yy, mm) }; }
  if (preset === "quarter") { let [yy, mm] = [y, m - 2]; if (mm < 1) { mm += 12; yy -= 1; } return { from: first(yy, mm), to: today }; }
  if (preset === "year") return { from: `${y}-01-01`, to: today };
  return { from: first(y, m), to: today };
}

/** "85,000.50" or "₦85000" as kobo; null when it is not a positive amount. */
export function parseNaira(text: string): number | null {
  const clean = text.replace(/[₦,\s]/g, "").replace(/^NGN/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const kobo = Math.round(Number(clean) * 100);
  return kobo > 0 ? kobo : null;
}

export const shortDate = (d: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(d + "T12:00:00Z"));
export const monthLabel = (m: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short", year: "2-digit" }).format(new Date(m + "-15T12:00:00Z"));

export function statusLabel(e: Pick<AccountEntry, "status" | "direction">) {
  if (e.status === "pending") return { label: "Waiting for approval", tone: "gold" as const };
  if (e.status === "rejected") return { label: "Not approved", tone: "red" as const };
  if (e.status === "void") return { label: "Cancelled", tone: "muted" as const };
  return { label: e.direction === "out" ? "Approved" : "Received", tone: "green" as const };
}

export function receiptUrl(id: string) {
  return import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/portal/accounts/receipts/" + encodeURIComponent(id);
}

/** Every entry as a spreadsheet (Excel opens it), amounts in naira. */
export function accountsCsv(entries: AccountEntry[]) {
  const cell = (v: string) => /[",\n\r]/.test(v) || /^[=+\-@]/.test(v) ? `"${(/^[=+\-@]/.test(v) ? "'" : "") + v.replace(/"/g, '""')}"` : v;
  const head = ["Date", "Money", "Category", "Description", "Paid by / paid to", "Amount (NGN)", "Method", "Reference", "Status", "Source", "Recorded by", "Decided by", "Note"];
  const rows = entries.map((e) => [
    e.date, e.direction === "in" ? "In" : "Out", e.category, e.description, e.counterparty, (e.amountKobo / 100).toFixed(2), METHOD_LABEL[e.method] ?? e.method,
    e.reference, statusLabel(e).label, SOURCE_LABEL[e.source], e.recordedBy, e.decidedBy ?? "", e.note,
  ].map((v) => cell(String(v))).join(","));
  return [head.join(","), ...rows].join("\r\n");
}

export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A printable statement for the period: totals, categories, and every counted entry. */
export function statementHtml(a: SchoolAccounts, logoUrl: string) {
  const counted = a.entries.filter((e) => e.status === "approved").slice().sort((x, y) => x.date.localeCompare(y.date));
  const cats = (dir: "in" | "out") => a.categories.filter((c) => c.direction === dir).map((c) => `<tr><td>${esc(c.category)}</td><td class="r">${c.count}</td><td class="r">${esc(ngn(c.amountKobo))}</td></tr>`).join("") || `<tr><td colspan="3" class="m">Nothing in this period.</td></tr>`;
  const rows = counted.map((e) => `<tr><td>${esc(shortDate(e.date))}</td><td>${esc(e.description)}<div class="m">${esc(e.category)}${e.counterparty ? ` · ${esc(e.counterparty)}` : ""}${e.reference ? ` · ${esc(e.reference)}` : ""}</div></td><td class="r">${e.direction === "in" ? esc(ngn(e.amountKobo)) : ""}</td><td class="r">${e.direction === "out" ? esc(ngn(e.amountKobo)) : ""}</td></tr>`).join("");
  return `<!doctype html><html lang="en-NG"><head><meta charset="utf-8"><title>School accounts ${esc(a.from)} to ${esc(a.to)}</title><style>
  @page { size: A4; margin: 14mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #10232c; margin: 0; font-size: 12px; }
  header { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #176345; padding-bottom: 10px; }
  header img { width: 52px; height: 52px; object-fit: contain; } h1 { font: 700 18px Georgia, serif; margin: 0; } h2 { font: 700 14px Georgia, serif; margin: 18px 0 6px; }
  .m { color: #5c6b70; font-size: 11px; } .r { text-align: right; white-space: nowrap; }
  .kpi { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; } .kpi div { background: #f4f1ea; border-radius: 8px; padding: 8px 10px; } .kpi b { display: block; font: 700 15px Georgia, serif; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; } td, th { padding: 5px 4px; border-bottom: 1px solid #e3ded2; vertical-align: top; text-align: left; } th { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #5c6b70; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; } footer { margin-top: 24px; display: flex; justify-content: space-between; gap: 30px; font-size: 11px; }
  footer div { flex: 1; border-top: 1px solid #10232c; padding-top: 4px; }
  </style></head><body>
  <header><img src="${esc(logoUrl)}" alt=""><div><h1>New World Emerald Private School</h1><div class="m">Statement of school accounts · ${esc(shortDate(a.from))} to ${esc(shortDate(a.to))}</div></div></header>
  <div class="kpi"><div>Money in<b>${esc(ngn(a.totals.inKobo))}</b></div><div>Money out<b>${esc(ngn(a.totals.outKobo))}</b></div><div>Net for the period<b>${esc(ngn(a.totals.netKobo))}</b></div><div>Balance recorded to date<b>${esc(ngn(a.totals.balanceKobo))}</b></div></div>
  ${a.totals.pendingCount ? `<p class="m">${a.totals.pendingCount} spending ${a.totals.pendingCount === 1 ? "entry" : "entries"} (${esc(ngn(a.totals.pendingKobo))}) waiting for approval are not included.</p>` : ""}
  <div class="two"><div><h2>Money in by category</h2><table><tr><th>Category</th><th class="r">Entries</th><th class="r">Amount</th></tr>${cats("in")}</table></div>
  <div><h2>Money out by category</h2><table><tr><th>Category</th><th class="r">Entries</th><th class="r">Amount</th></tr>${cats("out")}</table></div></div>
  <h2>Every entry</h2><table><tr><th>Date</th><th>Details</th><th class="r">In</th><th class="r">Out</th></tr>${rows || `<tr><td colspan="4" class="m">No entries in this period.</td></tr>`}
  <tr><td></td><td><b>Totals</b></td><td class="r"><b>${esc(ngn(a.totals.inKobo))}</b></td><td class="r"><b>${esc(ngn(a.totals.outKobo))}</b></td></tr></table>
  <footer><div>Bursar</div><div>School owner</div><div>Date</div></footer>
  <p class="m">Printed ${esc(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }).format(new Date()))}. Spending counts only after the school owner approves it.</p>
  </body></html>`;
}

export function printStatement(a: SchoolAccounts) {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return false;
  w.document.open();
  w.document.write(statementHtml(a, `${window.location.origin}/logo.jpg`));
  w.document.close();
  const go = () => { try { w.focus(); w.print(); } catch { /* window closed */ } };
  if (w.document.readyState === "complete") window.setTimeout(go, 300);
  else w.addEventListener("load", () => window.setTimeout(go, 100), { once: true });
  return true;
}
