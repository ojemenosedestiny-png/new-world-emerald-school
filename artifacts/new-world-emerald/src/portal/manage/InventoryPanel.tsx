import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInventory, getListInventoryQueryKey, useSaveInventoryItem, useDeleteInventoryItem, useRecordInventoryMove,
  useListInventoryMoves, getListInventoryMovesQueryKey,
  type InventoryItem, type InventoryItemInput, type InventoryCondition, type InventoryMoveInputKind, type PortalManagement,
} from "@workspace/api-client-react";
import { ArrowRightLeft, Boxes, Download, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EmptyState, ErrorPanel, Field, Skeleton } from "../ui";
import { errorMessage } from "../lib";

export const CONDITIONS: Record<InventoryCondition, string> = { good: "Good", fair: "Fair", needs_repair: "Needs repair", damaged: "Damaged" };
export const MOVES: Record<InventoryMoveInputKind, { label: string; hint: string; amount: string }> = {
  received: { label: "Received", hint: "New stock delivered or bought", amount: "How many arrived?" },
  issued: { label: "Issued", hint: "Given out to a class, staff member or event", amount: "How many were given out?" },
  returned: { label: "Returned", hint: "Items brought back into the store", amount: "How many came back?" },
  damaged: { label: "Damaged", hint: "Broken beyond use and written off", amount: "How many are written off?" },
  lost: { label: "Lost", hint: "Missing or stolen", amount: "How many are missing?" },
  count: { label: "Stock count", hint: "Set the exact number you counted", amount: "How many did you count?" },
  condition: { label: "Condition", hint: "Report the condition without changing stock", amount: "" },
};
type Filter = "all" | "low" | "out" | "repair";
const STATUS = { ok: { label: "In stock", cls: "bg-[hsl(var(--p-emerald-soft))] text-[hsl(var(--p-emerald))]" }, low: { label: "Low stock", cls: "bg-[hsl(var(--p-gold-soft))] text-[hsl(var(--p-gold-ink))]" }, out: { label: "Out of stock", cls: "bg-[hsl(var(--p-red)/0.1)] text-[hsl(var(--p-red))]" } };
const needsRepair = (i: InventoryItem) => i.condition === "needs_repair" || i.condition === "damaged";
const fmt = (n: number) => n.toLocaleString("en-NG");

/** Predicts the quantity after a movement, as the server will apply it (null when not allowed). */
export function quantityAfter(quantity: number, kind: InventoryMoveInputKind, amount: number): number | null {
  if (!Number.isInteger(amount) || amount < 0) return null;
  if (kind === "condition") return quantity;
  if (kind === "count") return amount;
  if (amount === 0) return null;
  const after = kind === "received" || kind === "returned" ? quantity + amount : quantity - amount;
  return after < 0 ? null : after;
}

function toCsv(items: InventoryItem[]) {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [["Item", "Category", "Class", "Location", "Quantity", "Unit", "Reorder level", "Status", "Condition", "Notes", "Last updated"],
    ...items.map((i) => [i.name, i.category, i.className || "School-wide", i.location, i.quantity, i.unit, i.reorderLevel, STATUS[i.status].label, CONDITIONS[i.condition], i.notes, i.updatedAt.slice(0, 10)])];
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

function useRefresh() {
  const qc = useQueryClient();
  return (id?: number) => {
    void qc.invalidateQueries({ queryKey: getListInventoryQueryKey() });
    if (id) void qc.invalidateQueries({ queryKey: getListInventoryMovesQueryKey(id) });
  };
}

function ItemEditor({ item, data, isAdmin, categories, onClose }: { item: InventoryItem | null; data: PortalManagement; isAdmin: boolean; categories: string[]; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const save = useSaveInventoryItem();
  const [f, setF] = useState<InventoryItemInput>(() => item
    ? { id: item.id, name: item.name, category: item.category, location: item.location, unit: item.unit, quantity: item.quantity, reorderLevel: item.reorderLevel, condition: item.condition, classId: item.classId, notes: item.notes }
    : { name: "", category: "", location: "", unit: "pieces", quantity: 0, reorderLevel: 0, condition: "good", classId: isAdmin ? null : data.classes[0]?.id ?? null, notes: "" });
  const set = (patch: Partial<InventoryItemInput>) => setF((x) => ({ ...x, ...patch }));
  const valid = f.name.trim() && f.category.trim() && Number.isInteger(f.quantity) && f.quantity >= 0 && Number.isInteger(f.reorderLevel) && f.reorderLevel >= 0 && (isAdmin || f.classId != null);
  const submit = async () => {
    try {
      const saved = await save.mutateAsync({ data: f });
      refresh(saved.id);
      toast({ title: item ? "Item updated" : "Item added", description: saved.name });
      onClose();
    } catch (e) { toast({ variant: "destructive", title: "Not saved", description: errorMessage(e) }); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-xl overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">{item ? "Edit item" : "Add item"}</DialogTitle>
          <DialogDescription>{item ? "Stock changes are recorded with Record movement, so the history always adds up." : "The opening quantity is recorded as the first entry in the item's history."}</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Item name" htmlFor="inv-name"><input id="inv-name" className="portal-input" maxLength={120} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Plastic chairs" data-testid="input-inv-name" /></Field></div>
          <Field label="Category" htmlFor="inv-cat"><input id="inv-cat" className="portal-input" list="inv-categories" maxLength={60} value={f.category} onChange={(e) => set({ category: e.target.value })} data-testid="input-inv-category" />
            <datalist id="inv-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="Belongs to" htmlFor="inv-class" hint={isAdmin ? undefined : "Teachers add items for their own classes."}>
            <select id="inv-class" className="portal-input" value={f.classId ?? ""} onChange={(e) => set({ classId: e.target.value ? Number(e.target.value) : null })} data-testid="select-inv-class">
              {isAdmin && <option value="">School-wide</option>}
              {data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></Field>
          <Field label="Location" htmlFor="inv-loc"><input id="inv-loc" className="portal-input" maxLength={120} value={f.location} onChange={(e) => set({ location: e.target.value })} placeholder="e.g. Store room B" data-testid="input-inv-location" /></Field>
          <Field label="Unit" htmlFor="inv-unit"><input id="inv-unit" className="portal-input" maxLength={30} value={f.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="pieces, boxes, sets" /></Field>
          {!item && <Field label="Opening quantity" htmlFor="inv-qty"><input id="inv-qty" type="number" min={0} className="portal-input" value={f.quantity} onChange={(e) => set({ quantity: Math.floor(Number(e.target.value)) })} data-testid="input-inv-quantity" /></Field>}
          <Field label="Reorder level" htmlFor="inv-reorder" hint="Shows as low stock at or below this. 0 turns it off."><input id="inv-reorder" type="number" min={0} className="portal-input" value={f.reorderLevel} onChange={(e) => set({ reorderLevel: Math.floor(Number(e.target.value)) })} data-testid="input-inv-reorder" /></Field>
          <Field label="Condition" htmlFor="inv-cond"><select id="inv-cond" className="portal-input" value={f.condition} onChange={(e) => set({ condition: e.target.value as InventoryCondition })}>
            {Object.entries(CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <div className="sm:col-span-2"><Field label="Notes" htmlFor="inv-notes"><textarea id="inv-notes" className="portal-input min-h-[64px]" maxLength={1000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Supplier, serial numbers, who keeps the key" /></Field></div>
        </div>
        <DialogFooter className="gap-2">
          <button className="portal-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="portal-btn" disabled={!valid || save.isPending} onClick={() => void submit()} data-testid="button-save-item">{save.isPending ? "Saving..." : item ? "Save changes" : "Add item"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const record = useRecordInventoryMove();
  const [kind, setKind] = useState<InventoryMoveInputKind>("issued");
  const [amount, setAmount] = useState(1);
  const [condition, setCondition] = useState<InventoryCondition | "">("");
  const [note, setNote] = useState("");
  const after = quantityAfter(item.quantity, kind, amount);
  const valid = after !== null && (kind !== "condition" || condition);
  const submit = async () => {
    try {
      await record.mutateAsync({ id: item.id, data: { kind, quantity: kind === "condition" ? 0 : amount, note: note.trim(), ...(condition ? { condition } : {}) } });
      refresh(item.id);
      toast({ title: "Recorded", description: `${item.name}: ${MOVES[kind].label.toLowerCase()}` });
      onClose();
    } catch (e) { toast({ variant: "destructive", title: "Not recorded", description: errorMessage(e) }); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">Record movement</DialogTitle>
          <DialogDescription>{item.name} · {fmt(item.quantity)} {item.unit} in stock</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Movement">
            {(Object.keys(MOVES) as InventoryMoveInputKind[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); if (k === "count") setAmount(item.quantity); else if (amount === item.quantity || amount === 0) setAmount(1); }}
                className={"rounded-xl border px-2 py-2 text-sm font-semibold transition-colors " + (kind === k ? "border-[hsl(var(--p-emerald))] bg-[hsl(var(--p-emerald))] text-white" : "border-[hsl(var(--p-line))] hover:border-[hsl(var(--p-emerald)/0.5)]")} data-testid={"move-kind-" + k}>{MOVES[k].label}</button>
            ))}
          </div>
          <p className="text-sm text-[hsl(var(--p-ink)/0.65)]">{MOVES[kind].hint}.</p>
          {kind !== "condition" && (
            <Field label={MOVES[kind].amount} htmlFor="move-amount"><input id="move-amount" type="number" min={0} className="portal-input" value={amount} onChange={(e) => setAmount(Math.floor(Number(e.target.value)))} data-testid="input-move-amount" /></Field>
          )}
          <Field label={kind === "condition" ? "Condition now" : "Condition now (optional)"} htmlFor="move-cond">
            <select id="move-cond" className="portal-input" value={condition} onChange={(e) => setCondition(e.target.value as InventoryCondition | "")} data-testid="select-move-condition">
              <option value="">{kind === "condition" ? "Choose condition" : `No change (${CONDITIONS[item.condition]})`}</option>
              {Object.entries(CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></Field>
          <Field label="Note (optional)" htmlFor="move-note"><input id="move-note" className="portal-input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "issued" ? "e.g. To JSS 2 for the science practical" : "e.g. Invoice 1043"} /></Field>
          <div className="flex items-center justify-between rounded-xl bg-[hsl(var(--p-paper-2)/0.8)] px-4 py-3 text-sm" data-testid="text-move-preview">
            <span>Stock after</span>
            {after === null
              ? <span className="font-semibold text-[hsl(var(--p-red))]">{amount > item.quantity && kind !== "count" && kind !== "received" && kind !== "returned" ? `Only ${fmt(item.quantity)} in stock` : "Enter a number"}</span>
              : <span className="font-serif text-xl font-semibold tabular-nums">{fmt(item.quantity)} → {fmt(after)} <span className="text-sm font-normal">{item.unit}</span></span>}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <button className="portal-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="portal-btn" disabled={!valid || record.isPending} onClick={() => void submit()} data-testid="button-record-move">{record.isPending ? "Recording..." : "Record"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemDetails({ item, canDelete, onEdit, onMove, onClose }: { item: InventoryItem; canDelete: boolean; onEdit: () => void; onMove: () => void; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const moves = useListInventoryMoves(item.id, { query: { queryKey: getListInventoryMovesQueryKey(item.id) } });
  const remove = useDeleteInventoryItem();
  const [confirm, setConfirm] = useState(false);
  const del = async () => {
    try { await remove.mutateAsync({ id: item.id }); refresh(); toast({ title: "Item removed", description: item.name }); onClose(); }
    catch (e) { toast({ variant: "destructive", title: "Not removed", description: errorMessage(e) }); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">{item.name}</DialogTitle>
          <DialogDescription>{[item.category, item.className || "School-wide", item.location].filter(Boolean).join(" · ")}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 divide-[hsl(var(--p-line))] rounded-xl border border-[hsl(var(--p-line))] sm:grid-cols-4 sm:divide-x">
          {[["In stock", `${fmt(item.quantity)} ${item.unit}`], ["Status", STATUS[item.status].label], ["Reorder at", item.reorderLevel ? fmt(item.reorderLevel) : "Off"], ["Condition", CONDITIONS[item.condition]]].map(([k, v]) => (
            <div key={k} className="p-3"><dt className="text-xs text-[hsl(var(--p-ink)/0.6)]">{k}</dt><dd className="mt-0.5 font-semibold">{v}</dd></div>
          ))}
        </dl>
        {item.notes && <p className="whitespace-pre-wrap text-sm text-[hsl(var(--p-ink)/0.75)]">{item.notes}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="portal-btn" onClick={onMove} data-testid="button-details-move"><ArrowRightLeft size={14} /> Record movement</button>
          {item.canEdit && <button className="portal-btn-ghost" onClick={onEdit} data-testid="button-details-edit"><Pencil size={14} /> Edit details</button>}
          {canDelete && (confirm
            ? <button className="portal-btn-ghost ml-auto text-[hsl(var(--p-red))]" disabled={remove.isPending} onClick={() => void del()} data-testid="button-confirm-delete">Remove item and history?</button>
            : <button className="portal-btn-ghost ml-auto text-[hsl(var(--p-red))]" onClick={() => setConfirm(true)} data-testid="button-delete-item"><Trash2 size={14} /> Remove</button>)}
        </div>
        <div>
          <h3 className="mb-2 font-serif text-lg font-semibold">History</h3>
          {moves.isLoading ? <Skeleton className="h-32" />
            : moves.isError || !moves.data ? <ErrorPanel title="History did not load" message={errorMessage(moves.error)} onRetry={() => moves.refetch()} />
            : (
              <ol className="divide-y divide-[hsl(var(--p-line))] rounded-xl border border-[hsl(var(--p-line))]" data-testid="list-item-history">
                {moves.data.map((m) => (
                  <li key={m.id} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 p-3 text-sm">
                    <span className="font-semibold">{MOVES[m.kind as InventoryMoveInputKind]?.label ?? m.kind}{m.note && <span className="font-normal text-[hsl(var(--p-ink)/0.7)]"> · {m.note}</span>}</span>
                    <span className={"text-right font-bold tabular-nums " + (m.change > 0 ? "text-[hsl(var(--p-emerald))]" : m.change < 0 ? "text-[hsl(var(--p-red))]" : "text-[hsl(var(--p-ink)/0.5)]")}>{m.change > 0 ? "+" : ""}{m.change === 0 ? "–" : fmt(m.change)}</span>
                    <span className="text-xs text-[hsl(var(--p-ink)/0.55)]">{new Date(m.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}{m.actor && ` · ${m.actor}`}</span>
                    <span className="text-right text-xs tabular-nums text-[hsl(var(--p-ink)/0.55)]">{fmt(m.quantityAfter)} after</span>
                  </li>
                ))}
              </ol>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** School stock for the office and teachers: what there is, where, how much, its condition and every change. */
export function InventoryPanel({ data, isAdmin }: { data: PortalManagement; isAdmin: boolean }) {
  const inv = useListInventory({ query: { queryKey: getListInventoryQueryKey() } });
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<InventoryItem | null | "new">(null);
  const [moving, setMoving] = useState<InventoryItem | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const items = inv.data?.items ?? [];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) =>
      (!needle || [i.name, i.category, i.location, i.className, i.notes].some((t) => t.toLowerCase().includes(needle)))
      && (!category || i.category === category)
      && (!classFilter || (classFilter === "school" ? i.classId == null : String(i.classId) === classFilter))
      && (filter === "all" || (filter === "repair" ? needsRepair(i) : i.status === filter)));
  }, [items, q, category, classFilter, filter]);

  if (inv.isLoading) return <Skeleton className="h-72" />;
  if (inv.isError || !inv.data) return <ErrorPanel title="The inventory did not load" message={errorMessage(inv.error)} onRetry={() => inv.refetch()} />;

  const low = items.filter((i) => i.status !== "ok").length;
  const repair = items.filter(needsRepair).length;
  const units = items.reduce((s, i) => s + i.quantity, 0);
  const open = items.find((i) => i.id === openId) ?? null;
  const usedCategories = [...new Set(items.map((i) => i.category))].sort((a, b) => a.localeCompare(b));
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob(["﻿" + toCsv(shown)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  const figure = (key: Filter, label: string, value: number, tone: string, testId: string) => (
    <button type="button" onClick={() => setFilter(filter === key ? "all" : key)} aria-pressed={key !== "all" && filter === key}
      className={"p-4 text-left transition-colors hover:bg-[hsl(var(--p-paper-2)/0.6)] " + (key !== "all" && filter === key ? "bg-[hsl(var(--p-paper-2)/0.8)]" : "")} data-testid={testId}>
      <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--p-ink)/0.55)]">{label}</p>
      <p className={"mt-1 font-serif text-3xl font-semibold tabular-nums " + (value ? tone : "")}>{fmt(value)}</p>
    </button>
  );

  return (
    <div className="space-y-4">
      <section className="portal-card grid grid-cols-2 divide-[hsl(var(--p-line))] overflow-hidden md:grid-cols-4 md:divide-x" aria-label="Inventory summary">
        {figure("all", "Items", items.length, "", "stat-inv-items")}
        <div className="p-4" data-testid="stat-inv-units"><p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--p-ink)/0.55)]">Units in stock</p><p className="mt-1 font-serif text-3xl font-semibold tabular-nums">{fmt(units)}</p></div>
        {figure("low", "Low or out of stock", low, "text-[hsl(var(--p-gold-ink))]", "stat-inv-low")}
        {figure("repair", "Needs repair", repair, "text-[hsl(var(--p-red))]", "stat-inv-repair")}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1">
          <span className="sr-only">Search inventory</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--p-ink)/0.45)]" aria-hidden="true" />
          <input className="portal-input !pl-9" placeholder="Search items, places, notes" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-inv-search" />
        </label>
        <select aria-label="Category" className="portal-input !w-auto" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="select-inv-category-filter">
          <option value="">All categories</option>{usedCategories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select aria-label="Class" className="portal-input !w-auto" value={classFilter} onChange={(e) => setClassFilter(e.target.value)} data-testid="select-inv-class-filter">
          <option value="">All {isAdmin ? "stock" : "my stock"}</option><option value="school">School-wide</option>
          {data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Status" className="portal-input !w-auto" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} data-testid="select-inv-status">
          <option value="all">Any status</option><option value="low">Low stock</option><option value="out">Out of stock</option><option value="repair">Needs repair</option>
        </select>
        <button className="portal-btn-ghost" onClick={exportCsv} disabled={!shown.length} data-testid="button-inv-export"><Download size={14} /> Export</button>
        {(isAdmin || data.classes.length > 0) && <button className="portal-btn" onClick={() => setEditing("new")} data-testid="button-add-item"><Plus size={15} /> Add item</button>}
      </div>

      {!items.length ? (
        <EmptyState icon={<Boxes size={22} />} title="No items yet" body={isAdmin ? "Add the school's furniture, books, equipment and supplies to keep count of stock and condition." : "Add your class's items, or ask the office to add school-wide stock."} />
      ) : !shown.length ? (
        <div className="portal-card p-8 text-center text-sm text-[hsl(var(--p-ink)/0.65)]">No items match. <button className="font-semibold text-[hsl(var(--p-emerald))]" onClick={() => { setQ(""); setCategory(""); setClassFilter(""); setFilter("all"); }}>Clear filters</button></div>
      ) : (<>
        {/* Phones: one card per item. */}
        <ul className="space-y-2 md:hidden" data-testid="list-inventory">
          {shown.map((i) => (
            <li key={i.id} className="portal-card p-4">
              <button type="button" className="block w-full text-left" onClick={() => setOpenId(i.id)} data-testid={"card-item-" + i.id}>
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0"><span className="block font-semibold">{i.name}</span>
                    <span className="block text-xs text-[hsl(var(--p-ink)/0.6)]">{[i.category, i.className || "School-wide", i.location].filter(Boolean).join(" · ")}</span></span>
                  <span className="shrink-0 text-right"><span className="font-serif text-2xl font-semibold tabular-nums">{fmt(i.quantity)}</span> <span className="text-xs text-[hsl(var(--p-ink)/0.6)]">{i.unit}</span></span>
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className={"rounded-full px-2.5 py-1 font-bold " + STATUS[i.status].cls}>{STATUS[i.status].label}</span>
                  <span className={needsRepair(i) ? "font-semibold text-[hsl(var(--p-red))]" : "text-[hsl(var(--p-ink)/0.65)]"}>{CONDITIONS[i.condition]}</span>
                  {i.reorderLevel > 0 && <span className="text-[hsl(var(--p-ink)/0.5)]">reorder at {fmt(i.reorderLevel)}</span>}
                </span>
              </button>
              <button className="portal-btn-ghost mt-3 w-full justify-center" onClick={() => setMoving(i)}><ArrowRightLeft size={13} /> Record movement</button>
            </li>
          ))}
        </ul>
        <div className="portal-card hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-sm" data-testid="table-inventory">
            <caption className="sr-only">Inventory, {shown.length} of {items.length} items</caption>
            <thead><tr className="border-b border-[hsl(var(--p-line))] text-left text-xs uppercase tracking-wide text-[hsl(var(--p-ink)/0.6)]">
              <th scope="col" className="p-3">Item</th><th scope="col" className="p-3">Belongs to</th><th scope="col" className="p-3 text-right">In stock</th>
              <th scope="col" className="p-3">Status</th><th scope="col" className="p-3">Condition</th><th scope="col" className="p-3">Updated</th><th scope="col" className="p-3"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} className="cursor-pointer border-b border-[hsl(var(--p-line))] last:border-0 hover:bg-[hsl(var(--p-paper-2)/0.5)]" onClick={() => setOpenId(i.id)} data-testid={"row-item-" + i.id}>
                  <th scope="row" className="p-3 text-left font-normal">
                    <span className="block font-semibold">{i.name}</span>
                    <span className="text-xs text-[hsl(var(--p-ink)/0.6)]">{[i.category, i.location].filter(Boolean).join(" · ")}</span>
                  </th>
                  <td className="p-3">{i.className || <span className="text-[hsl(var(--p-ink)/0.6)]">School-wide</span>}</td>
                  <td className="p-3 text-right"><span className="font-serif text-lg font-semibold tabular-nums">{fmt(i.quantity)}</span> <span className="text-xs text-[hsl(var(--p-ink)/0.6)]">{i.unit}</span>
                    {i.reorderLevel > 0 && <span className="block text-[11px] text-[hsl(var(--p-ink)/0.5)]">reorder at {fmt(i.reorderLevel)}</span>}</td>
                  <td className="p-3"><span className={"rounded-full px-2.5 py-1 text-xs font-bold " + STATUS[i.status].cls} data-testid={"status-item-" + i.id}>{STATUS[i.status].label}</span></td>
                  <td className={"p-3 " + (needsRepair(i) ? "font-semibold text-[hsl(var(--p-red))]" : "")}>{CONDITIONS[i.condition]}</td>
                  <td className="p-3 text-xs text-[hsl(var(--p-ink)/0.6)]">{new Date(i.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                  <td className="p-3 text-right"><button className="portal-btn-ghost !py-1.5" onClick={(e) => { e.stopPropagation(); setMoving(i); }} data-testid={"button-move-" + i.id}><ArrowRightLeft size={13} /> Record</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}

      {editing && <ItemEditor item={editing === "new" ? null : editing} data={data} isAdmin={isAdmin} categories={inv.data.categories} onClose={() => setEditing(null)} />}
      {moving && <MoveDialog item={moving} onClose={() => setMoving(null)} />}
      {open && !editing && !moving && <ItemDetails item={open} canDelete={inv.data.canDelete} onEdit={() => setEditing(open)} onMove={() => setMoving(open)} onClose={() => setOpenId(null)} />}
    </div>
  );
}
