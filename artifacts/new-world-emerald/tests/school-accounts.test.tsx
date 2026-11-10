import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountEntry, SchoolAccounts } from "@workspace/api-client-react";
import { AccountsView } from "../src/portal/accounts/AccountsView";
import { accountsCsv, parseNaira, presetRange, statementHtml } from "../src/portal/accounts/ledger";

const api = vi.hoisted(() => ({ record: vi.fn(async (v: unknown) => ({ ...(v as object), status: "pending", amountKobo: 85_000_00 })), decide: vi.fn(async () => ({})) }));
vi.mock("@/components/PaymentProof", () => ({ uploadProof: vi.fn(async () => "receipt-1") }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useRecordSchoolTransaction: () => ({ mutateAsync: api.record, isPending: false }),
  useDecideSchoolTransaction: () => ({ mutateAsync: api.decide, isPending: false }),
}));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const entry = (over: Partial<AccountEntry>): AccountEntry => ({
  key: "txn-1", source: "manual", id: 1, direction: "out", category: "Electricity and diesel", description: "Diesel for the generator", counterparty: "Total",
  amountKobo: 85_000_00, date: "2026-11-09", method: "transfer", reference: "", receiptId: "r-1", status: "pending", recordedBy: "bursar@school.test",
  decidedBy: null, decidedAt: null, note: "", ...over,
});
const pending = entry({});
const accounts = (over: Partial<SchoolAccounts> = {}): SchoolAccounts => ({
  role: "bursar", canApprove: false, from: "2026-11-01", to: "2026-11-10", generatedAt: "2026-11-10T09:00:00Z",
  totals: { inKobo: 362_000_00, outKobo: 500_00, netKobo: 361_500_00, pendingKobo: 85_000_00, pendingCount: 1, balanceKobo: 1_000_000_00 },
  months: [{ month: "2026-11", inKobo: 362_000_00, outKobo: 500_00 }],
  categories: [{ direction: "in", category: "School fees", amountKobo: 150_000_00, count: 1 }, { direction: "out", category: "Bank charges", amountKobo: 500_00, count: 1 }],
  entries: [
    pending,
    entry({ key: "fee-4", source: "fee_transfer", id: null, direction: "in", category: "School fees", description: "Tuition · Kemi Ade (JSS 1)", amountKobo: 150_000_00, status: "approved", reference: "NWE/RCT/2026/00004", recordedBy: "Parent payment" }),
    entry({ key: "txn-2", id: 2, category: "Bank charges", description: "SMS alerts", amountKobo: 500_00, status: "approved", receiptId: null, decidedBy: "owner@school.test" }),
    entry({ key: "txn-3", id: 3, description: "=HYPERLINK(\"x\")", status: "rejected", note: "Paid already" }),
  ],
  pending: [pending], incomeCategories: ["Donation", "Other income"], expenseCategories: ["Electricity and diesel", "Bank charges"], ...over,
});

describe("school accounts helpers", () => {
  it("reads naira amounts", () => {
    expect(parseNaira("85,000")).toBe(85_000_00);
    expect(parseNaira("₦1,250.5")).toBe(1_250_50);
    expect(parseNaira("0")).toBeNull();
    expect(parseNaira("12abc")).toBeNull();
  });
  it("gives ready-made periods", () => {
    const now = new Date("2026-01-15T10:00:00Z");
    expect(presetRange("month", now)).toEqual({ from: "2026-01-01", to: "2026-01-15" });
    expect(presetRange("last-month", now)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("quarter", now)).toEqual({ from: "2025-11-01", to: "2026-01-15" });
    expect(presetRange("year", now)).toEqual({ from: "2026-01-01", to: "2026-01-15" });
  });
  it("exports a spreadsheet that cannot run formulas", () => {
    const csv = accountsCsv(accounts().entries);
    expect(csv.split("\r\n")[0]).toContain("Amount (NGN)");
    expect(csv).toContain("85000.00");
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
  it("prints a statement of counted entries only", () => {
    const html = statementHtml(accounts(), "/logo.jpg");
    expect(html).toContain("SMS alerts");
    expect(html).not.toContain("Diesel for the generator");
    expect(html).toContain("waiting for approval are not included");
    expect(html).not.toContain("<script");
  });
});

describe("the accounts page", () => {
  it("lets the bursar record and withdraw, but not approve", () => {
    render(wrap(<AccountsView a={accounts()} me="bursar@school.test" firstName="Ngozi" onRange={vi.fn()} onLeave={vi.fn()} />));
    expect(screen.getByTestId("text-accounts-role").textContent).toContain("Bursar");
    const panel = screen.getByTestId("panel-pending");
    expect(within(panel).getByText("Waiting for the school owner")).toBeTruthy();
    expect(within(panel).queryByTestId("button-approve-1")).toBeNull();
    expect(within(panel).getByTestId("button-withdraw-1")).toBeTruthy();
    expect(screen.queryByTestId("button-void-2")).toBeNull();
    expect(screen.getByTestId("kpi-balance").textContent).toContain("1,000,000.00");
  });

  it("sends spending for approval", async () => {
    render(wrap(<AccountsView a={accounts()} me="bursar@school.test" firstName="" onRange={vi.fn()} onLeave={vi.fn()} />));
    fireEvent.click(screen.getByTestId("button-record-out"));
    const save = screen.getByTestId("button-save-entry") as HTMLButtonElement;
    expect(save.textContent).toContain("Send for approval");
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("select-entry-category"), { target: { value: "Electricity and diesel" } });
    fireEvent.change(screen.getByTestId("input-entry-description"), { target: { value: "Diesel, 200 litres" } });
    fireEvent.change(screen.getByTestId("input-entry-counterparty"), { target: { value: "Total Kubwa" } });
    fireEvent.change(screen.getByTestId("input-entry-amount"), { target: { value: "85,000" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await vi.waitFor(() => expect(api.record).toHaveBeenCalled());
    expect(api.record.mock.calls[0][0]).toMatchObject({ data: { direction: "out", category: "Electricity and diesel", amountKobo: 85_000_00, counterparty: "Total Kubwa", method: "transfer" } });
  });

  it("lets the school owner approve, reject with a reason, and cancel entries", async () => {
    render(wrap(<AccountsView a={accounts({ role: "owner", canApprove: true })} me="owner@school.test" firstName="" onRange={vi.fn()} onLeave={vi.fn()} />));
    expect(screen.getByText("Waiting for your approval")).toBeTruthy();
    expect(screen.getByTestId("button-void-2")).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("panel-pending")).getByTestId("button-reject-1"));
    const confirm = screen.getByTestId("button-confirm-decision") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-decision-note"), { target: { value: "No receipt from Total" } });
    fireEvent.click(confirm);
    await vi.waitFor(() => expect(api.decide).toHaveBeenCalledWith({ id: 1, data: { action: "reject", note: "No receipt from Total" } }));
  });

  it("filters the book", () => {
    render(wrap(<AccountsView a={accounts()} me="bursar@school.test" firstName="" onRange={vi.fn()} onLeave={vi.fn()} />));
    const table = () => screen.getByTestId("table-entries");
    fireEvent.click(screen.getByTestId("filter-in"));
    expect(within(table()).getByText(/Kemi Ade/)).toBeTruthy();
    expect(within(table()).queryByText("SMS alerts")).toBeNull();
    fireEvent.click(screen.getByTestId("filter-closed"));
    expect(within(table()).getByText("Not approved")).toBeTruthy();
  });
});
