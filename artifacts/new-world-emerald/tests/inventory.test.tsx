import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { InventoryItem, PortalManagement } from "@workspace/api-client-react";
import { InventoryPanel, quantityAfter } from "../src/portal/manage/InventoryPanel";

const api = vi.hoisted(() => ({ record: vi.fn(async () => ({})), list: null as unknown }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useListInventory: () => ({ data: api.list, isLoading: false, isError: false }),
  useListInventoryMoves: () => ({ data: [{ id: 1, kind: "count", change: 30, quantityAfter: 30, note: "Opening stock", actor: "office@example.test", createdAt: "2026-10-01T09:00:00Z" }], isLoading: false, isError: false }),
  useRecordInventoryMove: () => ({ mutateAsync: api.record, isPending: false }),
  useSaveInventoryItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteInventoryItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });

const item = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 1, name: "Plastic chairs", category: "Furniture", location: "Store B", unit: "pieces", quantity: 30, reorderLevel: 10,
  condition: "good", classId: null, className: "", notes: "", status: "ok", canEdit: true, updatedAt: "2026-10-20T09:00:00Z", ...over,
});
const data = { classes: [{ id: 1, name: "JSS 1" }], students: [], teachers: [], exams: [], attempts: [], materials: [], notices: [] } as unknown as PortalManagement;

it("predicts stock after a movement the way the server applies it", () => {
  expect(quantityAfter(10, "issued", 4)).toBe(6);
  expect(quantityAfter(10, "received", 4)).toBe(14);
  expect(quantityAfter(10, "count", 3)).toBe(3);
  expect(quantityAfter(3, "lost", 4)).toBeNull();
  expect(quantityAfter(3, "issued", 0)).toBeNull();
});

it("summarises stock, filters from the figures, and records a movement with a preview", async () => {
  api.list = {
    canDelete: true, categories: ["Books", "Furniture"],
    items: [
      item({}),
      item({ id: 2, name: "Maths textbooks", category: "Books", quantity: 4, status: "low", classId: 1, className: "JSS 1" }),
      item({ id: 3, name: "Microscopes", category: "Science lab", quantity: 0, status: "out", condition: "needs_repair" }),
    ],
  };
  render(wrap(<InventoryPanel data={data} isAdmin />));
  expect(screen.getByTestId("stat-inv-items").textContent).toContain("3");
  expect(screen.getByTestId("stat-inv-units").textContent).toContain("34");
  expect(screen.getByTestId("stat-inv-low").textContent).toContain("2");
  expect(screen.getByTestId("stat-inv-repair").textContent).toContain("1");

  fireEvent.click(screen.getByTestId("stat-inv-repair"));
  expect(within(screen.getByTestId("table-inventory")).getAllByRole("row")).toHaveLength(2);
  fireEvent.click(screen.getByTestId("stat-inv-repair"));
  fireEvent.change(screen.getByTestId("input-inv-search"), { target: { value: "jss 1" } });
  expect(screen.getByTestId("row-item-2")).toBeTruthy();
  expect(screen.queryByTestId("row-item-1")).toBeNull();
  fireEvent.change(screen.getByTestId("input-inv-search"), { target: { value: "" } });

  fireEvent.click(screen.getByTestId("button-move-1"));
  fireEvent.change(screen.getByTestId("input-move-amount"), { target: { value: "31" } });
  expect(screen.getByTestId("text-move-preview").textContent).toContain("Only 30 in stock");
  expect((screen.getByTestId("button-record-move") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByTestId("input-move-amount"), { target: { value: "12" } });
  expect(screen.getByTestId("text-move-preview").textContent).toContain("30 → 18");
  fireEvent.click(screen.getByTestId("button-record-move"));
  await vi.waitFor(() => expect(api.record).toHaveBeenCalledWith({ id: 1, data: { kind: "issued", quantity: 12, note: "" } }));
});

it("opens an item's history from its row", () => {
  api.list = { canDelete: false, categories: [], items: [item({ canEdit: false })] };
  render(wrap(<InventoryPanel data={data} isAdmin={false} />));
  fireEvent.click(screen.getByTestId("row-item-1"));
  expect(screen.getByTestId("list-item-history").textContent).toContain("Opening stock");
  expect(screen.queryByTestId("button-details-edit")).toBeNull();
  expect(screen.queryByTestId("button-delete-item")).toBeNull();
});

it("exports to CSV without letting a cell run as an Excel formula", async () => {
  const { toCsv } = await import("../src/portal/manage/InventoryPanel");
  const csv = toCsv([item({ name: "=HYPERLINK(\"http://evil\")", notes: "+1 spare", location: "@store" })]);
  expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
  expect(csv).toContain(`"'+1 spare"`);
  expect(csv).toContain(`"'@store"`);
});
