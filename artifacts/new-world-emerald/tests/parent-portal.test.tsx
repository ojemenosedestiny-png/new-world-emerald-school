import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ParentOverview } from "@workspace/api-client-react";
import { PayFees, ChildrenView } from "../src/portal/parents/ParentViews";
import { paymentSummary, parseNaira } from "../src/portal/parents/summary";
import { paymentState } from "../src/portal/parents/receipt";

const api = vi.hoisted(() => ({ start: vi.fn(async () => ({ reference: "NWE-20261102-ABCDEF1234", authorizationUrl: "https://checkout.paystack.com/abc", payment: null })) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useStartParentPayment: () => ({ mutateAsync: api.start, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const statement = (className: string, items: { key: string; amountKobo: number; paidKobo: number; status: "due" | "paid" | "pending" }[]) => ({
  studentName: "", studentId: "", className, payments: [],
  items: items.map((i) => ({ ...i, kind: "class" as const, description: "Tuition", term: "First Term", academicYear: "2026/2027", reference: null })),
  totals: { totalKobo: items.reduce((n, i) => n + i.amountKobo, 0), paidKobo: items.reduce((n, i) => n + i.paidKobo, 0), pendingKobo: 0, outstandingKobo: items.reduce((n, i) => n + i.amountKobo - i.paidKobo, 0) },
});
const data = (wallet = 0, ready = true): ParentOverview => ({
  email: "mum@example.test", paystackReady: ready, classCount: 2,
  wallet: { balanceKobo: wallet, entries: [] },
  children: [
    { id: 1, name: "Ada Obi", studentId: "NWE/2026/00001", photoImageId: null, statement: statement("JSS 1", [{ key: "class-1", amountKobo: 80_000_00, paidKobo: 30_000_00, status: "due" }]) },
    { id: 2, name: "Ben Obi", studentId: "NWE/2026/00002", photoImageId: null, statement: statement("SS 1", [{ key: "class-2", amountKobo: 100_000_00, paidKobo: 0, status: "due" }]) },
  ],
  outstanding: [
    { studentId: 1, studentCode: "NWE/2026/00001", studentName: "Ada Obi", className: "JSS 1", itemKey: "class-1", description: "Tuition", term: "First Term", academicYear: "2026/2027", outstandingKobo: 50_000_00 },
    { studentId: 2, studentCode: "NWE/2026/00002", studentName: "Ben Obi", className: "SS 1", itemKey: "class-2", description: "Tuition", term: "First Term", academicYear: "2026/2027", outstandingKobo: 100_000_00 },
  ],
  payments: [],
});

it("works out the amount like the server: wallet first, extra to the wallet, ₦100 minimum", () => {
  expect(paymentSummary(150_000_00, 20_000_00, null)).toMatchObject({ walletUsedKobo: 20_000_00, toPayKobo: 130_000_00, problem: null });
  expect(paymentSummary(150_000_00, 0, 200_000_00)).toMatchObject({ toPayKobo: 200_000_00, extraToWalletKobo: 50_000_00 });
  expect(paymentSummary(150_000_00, 0, 40_000_00)).toMatchObject({ leftOwingKobo: 110_000_00, problem: null });
  expect(paymentSummary(150_000_00, 0, 50_00).problem).toMatch(/₦100/);
  expect(paymentSummary(10_000_00, 50_000_00, null)).toMatchObject({ toPayKobo: 0, walletUsedKobo: 10_000_00, problem: null });
  expect(paymentSummary(0, 0, null).problem).toMatch(/Choose/);
  expect(parseNaira("₦85,000.50")).toBe(8_500_050);
  expect(parseNaira("abc")).toBeNull();
  expect(paymentState({ status: "pending", createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString() }).label).toBe("Not completed");
});

it("shows what is owed for every child, selected by default, and sends the parent to Paystack", async () => {
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
  render(wrap(<PayFees data={data(20_000_00)} onPaid={() => {}} />));
  expect(screen.getByTestId("text-total-outstanding").textContent).toBe("₦150,000.00");
  expect(within(screen.getByTestId("fees-child-1")).getByText(/30,000\.00 of ₦80,000\.00 paid/)).toBeTruthy();
  // Wallet is used first: 150,000 - 20,000.
  expect(screen.getByTestId("text-to-pay").textContent).toBe("₦130,000.00");
  // Paying later for Ben: only Ada's balance less the wallet remains.
  fireEvent.click(screen.getByTestId("check-2:class-2"));
  expect(screen.getByTestId("text-to-pay").textContent).toBe("₦30,000.00");
  fireEvent.click(screen.getByTestId("button-pay"));
  await waitFor(() => expect(api.start).toHaveBeenCalledWith({ data: { items: [{ studentId: 1, itemKey: "class-1" }], amountKobo: 30_000_00 } }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.paystack.com/abc"));
  vi.unstubAllGlobals();
});

it("a bigger amount tells the parent the extra goes to the wallet", () => {
  render(wrap(<PayFees data={data()} onPaid={() => {}} />));
  fireEvent.click(screen.getByTestId("button-custom-amount"));
  fireEvent.change(screen.getByTestId("input-custom-amount"), { target: { value: "200,000" } });
  expect(screen.getByText(/₦50,000\.00 more than needed: it is saved in your school wallet/)).toBeTruthy();
});

it("without Paystack set up, card payment is disabled and bank transfer is offered", () => {
  render(wrap(<PayFees data={data(0, false)} onPaid={() => {}} />));
  expect((screen.getByTestId("button-pay") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/School Payments/)).toBeTruthy();
});

it("each child shows their name, class, student ID and how much is paid", () => {
  render(wrap(<ChildrenView children={data().children} />));
  const ada = screen.getByTestId("card-child-1");
  expect(within(ada).getByText("Ada Obi")).toBeTruthy();
  expect(within(ada).getByText("JSS 1")).toBeTruthy();
  expect(within(ada).getByLabelText("Copy student ID NWE/2026/00001")).toBeTruthy();
  expect(within(ada).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("38");
});
