// Stock rules for the school inventory, kept free of the database so they can be unit tested.

export const CONDITIONS = ["good", "fair", "needs_repair", "damaged"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const MOVE_KINDS = ["received", "issued", "returned", "damaged", "lost", "count", "condition"] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];
/** Suggested categories; staff may type their own. */
export const DEFAULT_CATEGORIES = ["Furniture", "Books", "Stationery", "ICT equipment", "Science lab", "Sports", "Cleaning", "Kitchen", "Uniforms", "Medical"];
export const MAX_QUANTITY = 1_000_000;

export type StockStatus = "ok" | "low" | "out";
export function stockStatus(item: { quantity: number; reorderLevel: number }): StockStatus {
  if (item.quantity <= 0) return "out";
  return item.reorderLevel > 0 && item.quantity <= item.reorderLevel ? "low" : "ok";
}

/**
 * Applies one movement: received and returned add, issued, damaged and lost take away, a stock count
 * sets the exact quantity, and a condition report changes no stock. Returns the change or a problem.
 */
export function applyMove(quantity: number, kind: MoveKind, amount: number): { change: number; after: number } | { problem: string } {
  if (!Number.isInteger(amount) || amount < 0 || amount > MAX_QUANTITY) return { problem: "Enter a whole number of items." };
  if (kind === "condition") return { change: 0, after: quantity };
  if (kind === "count") return { change: amount - quantity, after: amount };
  if (amount === 0) return { problem: "Enter how many items." };
  const change = kind === "received" || kind === "returned" ? amount : -amount;
  const after = quantity + change;
  if (after < 0) return { problem: `Only ${quantity} in stock; you cannot take away ${amount}.` };
  if (after > MAX_QUANTITY) return { problem: "That is more than the inventory can record." };
  return { change, after };
}

export interface ItemInput { name: string; category: string; location: string; unit: string; quantity: number; reorderLevel: number; condition: string; classId: number | null; notes: string }
export function itemProblem(i: ItemInput): string | null {
  if (!i.name.trim()) return "Give the item a name.";
  if (!i.category.trim()) return "Choose a category.";
  if (!CONDITIONS.includes(i.condition as Condition)) return "Choose a condition.";
  for (const [n, label] of [[i.quantity, "Quantity"], [i.reorderLevel, "Reorder level"]] as const) {
    if (!Number.isInteger(n) || n < 0 || n > MAX_QUANTITY) return `${label} must be a whole number from 0.`;
  }
  return null;
}

/** Teachers manage stock for their own classes; school-wide stock (no class) is for the office to edit. */
export function teacherMayEdit(item: { classId: number | null }, classIds: number[]) {
  return item.classId != null && classIds.includes(item.classId);
}
/** Teachers see their classes' items and school-wide items, and can record use of either. */
export function teacherMaySee(item: { classId: number | null }, classIds: number[]) {
  return item.classId == null || classIds.includes(item.classId);
}
