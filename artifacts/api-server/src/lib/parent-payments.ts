import { randomBytes } from "node:crypto";
import type { ParentPaymentAllocation, ParentPaymentSelection } from "@workspace/db";

/** Paystack's smallest sensible card payment, and the largest amount one payment row can hold. */
export const MIN_CARD_KOBO = 10_000;
export const MAX_CARD_KOBO = 2_000_000_000;
export const MAX_ITEMS = 60;

/** A fee item with money still owed on it, as the parent sees it. */
export type OutstandingItem = {
  studentId: number; studentCode: string; studentName: string; className: string;
  itemKey: string; description: string; term: string; academicYear: string; outstandingKobo: number;
};

const TERM_ORDER = ["first", "second", "third"];
const termRank = (term: string) => {
  const i = TERM_ORDER.findIndex((t) => term.toLowerCase().includes(t));
  return i < 0 ? TERM_ORDER.length : i;
};
/** Oldest debts first: earlier session, then earlier term, then by child and description. */
export function oldestFirst<T extends { academicYear: string; term: string; studentName: string; description: string }>(items: T[]) {
  return [...items].sort((a, b) => a.academicYear.localeCompare(b.academicYear) || termRank(a.term) - termRank(b.term)
    || a.term.localeCompare(b.term) || a.studentName.localeCompare(b.studentName) || a.description.localeCompare(b.description));
}

/** Spreads money over the chosen items, oldest first, never more than each item still owes. */
export function allocate(items: OutstandingItem[], poolKobo: number) {
  let left = Math.max(0, Math.floor(poolKobo));
  const allocations: ParentPaymentAllocation[] = [];
  for (const i of oldestFirst(items)) {
    if (left <= 0) break;
    const amountKobo = Math.min(left, i.outstandingKobo);
    if (amountKobo <= 0) continue;
    allocations.push({ studentId: i.studentId, studentCode: i.studentCode, studentName: i.studentName, className: i.className,
      itemKey: i.itemKey, description: i.description, term: i.term, academicYear: i.academicYear, amountKobo });
    left -= amountKobo;
  }
  return { allocations, allocatedKobo: allocations.reduce((n, a) => n + a.amountKobo, 0) };
}

/**
 * What a successful payment does: the wallet is used first, the card money and wallet together pay the chosen
 * items, and whatever the card paid beyond what was owed goes back into the wallet.
 */
export function settle(cardKobo: number, walletKobo: number, items: OutstandingItem[]) {
  const { allocations, allocatedKobo } = allocate(items, cardKobo + walletKobo);
  const walletUsedKobo = Math.max(0, allocatedKobo - cardKobo);
  const walletCreditKobo = Math.max(0, cardKobo - allocatedKobo);
  return { allocations, allocatedKobo, walletUsedKobo, walletCreditKobo, balanceAfterKobo: walletKobo - walletUsedKobo + walletCreditKobo };
}

/** Why a parent's choice cannot be paid, or null. `available` is what the parent's children still owe. */
export function selectionProblem(selection: ParentPaymentSelection[], available: OutstandingItem[]) {
  if (!selection.length) return "Choose at least one fee to pay.";
  if (selection.length > MAX_ITEMS) return "Too many fees in one payment. Pay in smaller groups.";
  const seen = new Set<string>();
  for (const s of selection) {
    const key = `${s.studentId}:${s.itemKey}`;
    if (seen.has(key)) return "A fee was chosen twice.";
    seen.add(key);
    if (!available.some((a) => a.studentId === s.studentId && a.itemKey === s.itemKey)) return "One of the chosen fees is already paid or is not for your child. Refresh and try again.";
  }
  return null;
}

/** Why a card amount is not allowed, or null. A zero card amount means "pay from the wallet only". */
export function amountProblem(cardKobo: number, owedKobo: number, walletKobo: number) {
  if (!Number.isSafeInteger(cardKobo) || cardKobo < 0) return "Enter a valid amount.";
  if (cardKobo > MAX_CARD_KOBO) return "That amount is too large for one payment.";
  if (cardKobo === 0) return walletKobo > 0 && owedKobo > 0 ? null : "Enter the amount to pay.";
  if (cardKobo < MIN_CARD_KOBO) return "The smallest card payment is ₦100.";
  return null;
}

/** The items the parent picked, with what each still owes now. */
export function chosen(selection: ParentPaymentSelection[], available: OutstandingItem[]) {
  return available.filter((a) => selection.some((s) => s.studentId === a.studentId && s.itemKey === a.itemKey));
}

/** A payment reference that cannot be guessed, e.g. NWE-20261102-4F9A2C7D1E. */
export function newPaymentReference(now = new Date()) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `NWE-${day}-${randomBytes(5).toString("hex").toUpperCase()}`;
}
