import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChairmanBoard, FeeTransfer, MyExamRegistration, ParentOverview, PaymentAccount } from "@workspace/api-client-react";
import { TransferFees, TransferReceipts, payItems } from "../src/portal/payments/ParentTransfers";
import { TransfersReview } from "../src/portal/payments/OfficePayments";
import { pickAccount, transferReceiptHtml } from "../src/portal/payments/transfers";
import { StudentRegistration } from "../src/portal/exam-registration/StudentRegistration";
import { registrationsCsv } from "../src/portal/exam-registration/print";
import Chairman from "../src/pages/Chairman";

const api = vi.hoisted(() => ({
  report: vi.fn(async () => ({})), review: vi.fn(async () => ({ receiptNumber: "NWE/RCT/2026/00009" })), save: vi.fn(), upload: vi.fn(async () => "proof-1"),
  transfers: null as unknown, registration: null as unknown, board: null as unknown,
}));
vi.mock("@clerk/react", () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true }), useUser: () => ({ user: { id: "u1", firstName: "Ade" } }), useClerk: () => ({ signOut: vi.fn() }) }));
vi.mock("@/components/PaymentProof", () => ({ uploadProof: api.upload }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useReportParentTransfer: () => ({ mutateAsync: api.report, isPending: false }),
  useListFeeTransfers: () => ({ isLoading: false, isError: false, data: api.transfers, refetch: vi.fn() }),
  useReviewFeeTransfer: () => ({ mutateAsync: api.review, isPending: false }),
  useGetMyExamRegistration: () => ({ isLoading: false, isError: false, data: api.registration, refetch: vi.fn() }),
  useSaveMyExamRegistration: () => ({ mutateAsync: api.save, isPending: false }),
  useGetChairmanBoard: () => ({ isLoading: false, isError: false, data: api.board, refetch: vi.fn() }),
}));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const accounts: PaymentAccount[] = [
  { id: 1, purpose: "school_fees", academicYear: "", bankName: "Zenith Bank", accountName: "New World Emerald", accountNumber: "1111111111", note: "", active: true },
  { id: 2, purpose: "school_fees", academicYear: "2026/2027", bankName: "GTBank", accountName: "New World Emerald", accountNumber: "2222222222", note: "", active: true },
  { id: 3, purpose: "exam_registration", academicYear: "", bankName: "Access Bank", accountName: "NWE Exams", accountNumber: "3333333333", note: "", active: true },
];
const transfer = (over: Partial<FeeTransfer>): FeeTransfer => ({
  id: 7, reference: "NWE-FEE-ABC", receiptNumber: null, purpose: "school_fees", studentName: "Kemi Ade", studentIdentifier: "NWE/2026/00002", className: "JSS 1",
  description: "Tuition", term: "Autumn Term", academicYear: "2026/2027", amountKobo: 150_000_00, status: "reported", officeNote: null, proofImageId: "img-1",
  transferReference: null, payer: "mum@home.test", account: { bankName: "GTBank", accountName: "New World Emerald", accountNumber: "2222222222" },
  createdAt: "2026-11-09T09:00:00Z", confirmedAt: null, confirmedBy: null, ...over,
});
const overview = {
  email: "mum@home.test", paystackReady: false, classCount: 2, wallet: { balanceKobo: 0, entries: [] }, outstanding: [], payments: [], accounts,
  children: [
    { id: 1, name: "Tolu Ade", studentId: "NWE/2026/00001", photoImageId: null, statement: { className: "SS 3 Amber", items: [], totals: { totalKobo: 0, paidKobo: 0, pendingKobo: 0, outstandingKobo: 0 }, payments: [] } },
    { id: 2, name: "Kemi Ade", studentId: "NWE/2026/00002", photoImageId: null, statement: { className: "JSS 1", totals: { totalKobo: 0, paidKobo: 0, pendingKobo: 0, outstandingKobo: 0 }, payments: [], items: [
      { key: "class-4", kind: "class", description: "Tuition", term: "Autumn Term", academicYear: "2026/2027", amountKobo: 150_000_00, paidKobo: 0, reference: null, status: "due" },
      { key: "charge-9", kind: "individual", description: "Bus", term: "Autumn Term", academicYear: "2026/2027", amountKobo: 20_000_00, paidKobo: 0, reference: "R1", status: "pending" },
    ] } },
  ],
  transfers: [],
  examFees: [{ studentId: 1, studentName: "Tolu Ade", studentCode: "NWE/2026/00001", className: "SS 3 Amber", academicYear: "2026/2027", title: "WAEC and NECO registration", amountKobo: 45_000_00, status: "due", itemKey: "exam-2026/2027", formStatus: "draft" }],
} as unknown as ParentOverview;

describe("parents pay by bank transfer", () => {
  it("picks the account for the fee type and session", () => {
    expect(pickAccount(accounts, "school_fees", "2026/2027")?.accountNumber).toBe("2222222222");
    expect(pickAccount(accounts, "school_fees", "2025/2026")?.accountNumber).toBe("1111111111");
    expect(pickAccount(accounts, "exam_registration", "2026/2027")?.accountNumber).toBe("3333333333");
    expect(pickAccount([], "exam_registration", "2026/2027")).toBeNull();
  });
  it("lists WAEC/NECO and school fees per child, and sends the transfer with its screenshot", async () => {
    expect(payItems(overview).map((i) => `${i.description}:${i.status}`)).toEqual(["WAEC and NECO registration:due", "Tuition:due", "Bus:pending"]);
    render(wrap(<TransferFees data={overview} />));
    expect(screen.getByTestId("text-total-outstanding").textContent).toContain("195,000.00");
    expect(within(screen.getByTestId("fee-2-charge-9")).getByText("Being checked")).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-pay-1-exam-2026/2027"));
    expect(screen.getByTestId("text-transfer-account-number").textContent).toBe("3333333333");
    expect((screen.getByTestId("button-send-transfer") as HTMLButtonElement).disabled).toBe(true);
    const file = new File(["png"], "transfer.png", { type: "image/png" });
    URL.createObjectURL = vi.fn(() => "blob:preview");
    fireEvent.change(screen.getByTestId("input-transfer-proof"), { target: { files: [file] } });
    await waitFor(() => expect((screen.getByTestId("button-send-transfer") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByTestId("input-transfer-reference"), { target: { value: " FT998 " } });
    fireEvent.click(screen.getByTestId("button-send-transfer"));
    await waitFor(() => expect(api.report).toHaveBeenCalledWith({ data: { studentId: 1, itemKey: "exam-2026/2027", proofId: "proof-1", transferReference: "FT998" } }));
  });
  it("shows receipts once confirmed, and why a transfer was not accepted", () => {
    render(wrap(<TransferReceipts transfers={[transfer({ id: 1, status: "confirmed", receiptNumber: "NWE/RCT/2026/00001", confirmedAt: "2026-11-09T10:00:00Z" }), transfer({ id: 2, status: "rejected", officeNote: "No money received" })]} />));
    expect(screen.getByTestId("button-receipt-1")).toBeTruthy();
    expect(screen.queryByTestId("button-receipt-2")).toBeNull();
    expect(screen.getByTestId("transfer-2").textContent).toContain("No money received");
    const html = transferReceiptHtml(transfer({ status: "confirmed", receiptNumber: "NWE/RCT/2026/00001", confirmedAt: "2026-11-09T10:00:00Z" }), "/logo.jpg");
    expect(html).toContain("NWE/RCT/2026/00001");
    expect(html).toContain("2222222222");
  });
});

describe("the office checks transfers", () => {
  it("confirms a transfer, and needs a reason to say it did not arrive", async () => {
    api.transfers = { waiting: 1, transfers: [transfer({})] };
    render(wrap(<TransfersReview />));
    expect(screen.getByTestId("text-transfers-waiting").textContent).toBe("1");
    fireEvent.click(screen.getByTestId("button-check-7"));
    expect(screen.getByTestId("img-transfer-proof")).toBeTruthy();
    expect((screen.getByTestId("button-reject-transfer") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("button-confirm-transfer"));
    await waitFor(() => expect(api.review).toHaveBeenCalledWith({ id: 7, data: { action: "confirm" } }));
  });
});

const registration = (over: Partial<MyExamRegistration> = {}): MyExamRegistration => ({
  settings: { academicYear: "2026/2027", title: "WAEC and NECO registration", open: true, feeKobo: 45_000_00, compulsorySubjects: ["Mathematics", "English Language", "Civic Education", "Livestock Farming"], optionalSubjects: ["Biology", "Chemistry"], maxSubjects: 9, classIds: [1], deadline: "" },
  eligible: true, form: null, fee: { amountKobo: 45_000_00, status: "due", itemKey: "exam-2026/2027" },
  account: { bankName: "Access Bank", accountName: "NWE Exams", accountNumber: "3333333333" }, student: { name: "Tolu Ade", studentId: "NWE/2026/00001", className: "SS 3 Amber" }, ...over,
});

describe("SS 3 students register for WAEC and NECO", () => {
  it("fills the form with the compulsory subjects, saves a draft, and cannot submit until the fee is paid", async () => {
    api.registration = registration();
    api.save.mockResolvedValue(registration());
    render(wrap(<StudentRegistration />));
    expect(within(screen.getByTestId("list-reg-subjects")).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1MathematicsCompulsory", "2English LanguageCompulsory", "3Civic EducationCompulsory", "4Livestock FarmingCompulsory"]);
    expect(screen.getByTestId("text-transfer-account-number").textContent).toBe("3333333333");
    expect((screen.getByTestId("button-reg-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("button-subject-Biology"));
    fireEvent.change(screen.getByTestId("input-reg-surname"), { target: { value: "Ade" } });
    fireEvent.click(screen.getByTestId("button-reg-save"));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ data: expect.objectContaining({ surname: "Ade", subjects: ["Mathematics", "English Language", "Civic Education", "Livestock Farming", "Biology"], submit: false }) }));
  });
  it("submits once paid, and locks the form after", async () => {
    api.registration = registration({ fee: { amountKobo: 45_000_00, status: "paid", itemKey: "exam-2026/2027" } });
    render(wrap(<StudentRegistration />));
    expect(screen.getByTestId("text-reg-fee-status").textContent).toBe("Paid");
    expect((screen.getByTestId("button-reg-submit") as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    api.registration = registration({ fee: { amountKobo: 45_000_00, status: "paid", itemKey: "exam-2026/2027" }, form: { id: 1, academicYear: "2026/2027", surname: "Ade", firstName: "Tolu", middleName: "", dateOfBirth: "2009-03-14", stateOfOrigin: "Ogun", lga: "Abeokuta", gender: "Female", nin: "12345678901", subjects: ["Mathematics"], phone: "080", email: "t@x.test", signatureName: "Tolu Ade", status: "submitted", officeNote: "", submittedAt: "2026-11-09T10:00:00Z", updatedAt: "2026-11-09T10:00:00Z" } });
    render(wrap(<StudentRegistration />));
    expect(screen.queryByTestId("button-reg-submit")).toBeNull();
    expect((screen.getByTestId("input-reg-surname") as HTMLInputElement).disabled).toBe(true);
  });
  it("explains when registration is not open", () => {
    api.registration = registration({ settings: null, eligible: false, fee: null, account: null });
    render(wrap(<StudentRegistration />));
    expect(screen.getByText("Registration is not open")).toBeTruthy();
  });
  it("exports forms as a spreadsheet the office can use", () => {
    const csv = registrationsCsv([{ surname: "Ade", firstName: "Tolu", middleName: "", dateOfBirth: "2009-03-14", stateOfOrigin: "Ogun", lga: "Abeokuta, South", gender: "Female", nin: "12345678901", subjects: ["Mathematics", "Biology"], phone: "080", email: "t@x.test", signatureName: "Tolu Ade", studentCode: "S1", className: "SS 3", status: "submitted" }]);
    expect(csv.split("\r\n")[1]).toContain('"Abeokuta, South"');
    expect(csv.split("\r\n")[0]).toContain("Subject 9");
  });
});

describe("the Chairman's board", () => {
  it("shows the school at a glance, view only, with no money", () => {
    api.board = {
      days: 30, from: "2026-10-10T00:00:00Z", to: "2026-11-09T00:00:00Z", generatedAt: "2026-11-09T09:00:00Z",
      totals: { students: 420, teachers: 31, classes: 18, attendanceRate: 94, absentToday: 12, averageScore: 68 },
      sections: [{ section: "secondary", students: 250, classes: 9, attendanceRate: 93, averageScore: 64 }, { section: "primary", students: 170, classes: 9, attendanceRate: 96, averageScore: 74 }],
      classes: [{ className: "SS 3 Amber", section: "secondary", students: 28, attendanceRate: 91, recorded: 500, averageScore: 61, results: 40 }],
      attendanceTrend: [{ date: "2026-11-06", rate: 95, recorded: 400 }, { date: "2026-11-07", rate: 92, recorded: 398 }],
      learning: [{ label: "Exams and tests held", value: 14 }], admissions: [{ label: "New applications", value: 3 }],
      highlights: ["Attendance was 94% over the last 30 days."], waec: { academicYear: "2026/2027", open: true, candidates: 28, submitted: 20 },
    } satisfies ChairmanBoard;
    render(wrap(<Chairman />));
    expect(screen.getByTestId("text-view-only")).toBeTruthy();
    expect(screen.getByTestId("kpi-students").textContent).toContain("420");
    expect(screen.getByTestId("section-primary").textContent).toContain("170");
    expect(screen.getByTestId("card-chairman-waec").textContent).toContain("20");
    expect(within(screen.getByTestId("table-chairman-classes")).getByText("SS 3 Amber")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/₦|NGN/);
    expect(screen.queryByRole("button", { name: /send|email/i })).toBeNull();
  });
});
