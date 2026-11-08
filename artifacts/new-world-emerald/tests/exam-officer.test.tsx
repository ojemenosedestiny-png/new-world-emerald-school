import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExamOfficerExam, ExamOfficerOverview, PortalManagement } from "@workspace/api-client-react";
import { ActivityView, AllExamsView, OverviewView, PaperDialog, QueueView } from "../src/portal/exam-officer/OfficerViews";
import { ExamsPanel } from "../src/portal/manage/ExamsPanel";

const api = vi.hoisted(() => ({ manage: vi.fn(async () => ({ message: "Saved." })), staff: vi.fn(async () => ({ message: "Saved." })), access: vi.fn(), paper: null as unknown, activity: null as unknown }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useManageExamOfficer: () => ({ mutateAsync: api.manage, isPending: false }),
  useGetExamOfficerExam: () => ({ isLoading: false, isError: false, data: api.paper, refetch: vi.fn() }),
  useGetExamOfficerActivity: () => ({ isLoading: false, isError: false, data: api.activity, refetch: vi.fn() }),
  useManagePortal: () => ({ mutateAsync: api.staff, isPending: false }),
  useRecordExamAccess: () => ({ mutate: api.access }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const future = new Date(Date.now() + 86_400_000).toISOString(), later = new Date(Date.now() + 2 * 86_400_000).toISOString();
const ex = (id: number, status: ExamOfficerExam["status"], section: ExamOfficerExam["section"], extra: Partial<ExamOfficerExam> = {}): ExamOfficerExam => ({
  id, title: `Exam ${id}`, subject: "Mathematics", classId: id, className: section === "primary" ? "Year 3" : "JSS 1", section, setBy: "Mr Musa", startsAt: future, endsAt: later,
  durationMinutes: 30, mode: "interactive", questionCount: 10, totalMarks: 20, status, reviewNote: "", submittedBy: "Mr Musa", submittedAt: future, reviewedBy: "", reviewedAt: null,
  students: 20, sat: 0, marked: 0, opened: 3, ...extra,
});
const data: ExamOfficerOverview = {
  configured: true, today: "2026-11-08", term: "2026-1", terms: [{ key: "2026-1", label: "Autumn Term, 2026/2027", count: 4 }, { key: "2025-3", label: "Summer Term, 2025/2026", count: 9 }],
  exams: [ex(1, "awaiting", "secondary"), ex(2, "open", "secondary"), ex(3, "returned", "primary", { reviewNote: "Fix question 2" }), ex(4, "draft", "primary")],
  sections: [
    { section: "secondary", label: "Secondary (JSS 1 to SS 3)", draft: 0, awaiting: 1, returned: 0, scheduled: 0, open: 1, closed: 0, released: 0 },
    { section: "primary", label: "Primary (Year 1 to 6)", draft: 1, awaiting: 0, returned: 1, scheduled: 0, open: 0, closed: 0, released: 0 },
    { section: "other", label: "Nursery and other classes", draft: 0, awaiting: 0, returned: 0, scheduled: 0, open: 0, closed: 0, released: 0 },
  ],
};

describe("exam officer portal", () => {
  it("shows what is waiting, publishing by section, and the next exams to review", () => {
    const open = vi.fn(), view = vi.fn();
    render(wrap(<OverviewView data={data} name="Mrs Grace Ade" onOpen={open} onView={view} />));
    expect(screen.getByRole("heading", { level: 2, name: /1 exam is waiting for you, Grace/ })).toBeTruthy();
    expect(within(screen.getByTestId("hero-published")).getByText("1")).toBeTruthy();
    expect(within(screen.getByTestId("section-primary")).getAllByText("1")).toHaveLength(2);
    fireEvent.click(screen.getByTestId("button-open-queue"));
    expect(open).toHaveBeenCalledWith("queue");
    fireEvent.click(screen.getByTestId("button-view-officer-exam-1"));
    expect(view).toHaveBeenCalledWith(1);
  });

  it("warns when no exam officer email is set yet", () => {
    render(wrap(<OverviewView data={{ ...data, configured: false }} name="" onOpen={vi.fn()} onView={vi.fn()} />));
    expect(screen.getByTestId("text-officer-not-configured").textContent).toContain("teachers still publish their own exams");
  });

  it("lists the queue and returned exams with the officer's note", () => {
    render(wrap(<QueueView data={data} onView={vi.fn()} />));
    expect(screen.getByTestId("officer-exam-1")).toBeTruthy();
    expect(within(screen.getByTestId("officer-exam-3")).getByText("Your note: Fix question 2")).toBeTruthy();
    expect(screen.queryByTestId("officer-exam-2")).toBeNull();
  });

  it("filters all exams by section and status, and switches term", () => {
    const term = vi.fn();
    render(wrap(<AllExamsView data={data} onTerm={term} onView={vi.fn()} />));
    fireEvent.change(screen.getByTestId("select-officer-section"), { target: { value: "primary" } });
    expect(screen.queryByTestId("officer-exam-1")).toBeNull();
    expect(screen.getByTestId("officer-exam-3")).toBeTruthy();
    fireEvent.change(screen.getByTestId("select-officer-status"), { target: { value: "draft" } });
    expect(screen.queryByTestId("officer-exam-3")).toBeNull();
    fireEvent.click(screen.getByTestId("officer-term-2025-3"));
    expect(term).toHaveBeenCalledWith("2025-3");
  });

  it("publishes a paper, or returns it only with a note", async () => {
    api.paper = { exam: ex(1, "awaiting", "secondary"), instructions: "Answer all.", questions: [{ id: "a", type: "mcq", text: "2 + 2?", options: ["3", "4"], correctAnswer: 1, marks: 2, passage: "", hasDiagram: false }],
      history: [{ at: future, who: "Mr Musa", label: "Opened the questions", kind: "opened", examId: 1, examTitle: "Exam 1" }] };
    const close = vi.fn();
    render(wrap(<PaperDialog id={1} onClose={close} />));
    expect(within(screen.getByTestId("officer-history")).getByText("Opened the questions")).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-return-exam"));
    expect((screen.getByTestId("button-confirm-return-exam") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-officer-note"), { target: { value: "Add marks to question 1" } });
    fireEvent.click(screen.getByTestId("button-confirm-return-exam"));
    await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "return", examId: 1, note: "Add marks to question 1" } }));
    cleanup();
    render(wrap(<PaperDialog id={1} onClose={close} />));
    fireEvent.click(screen.getByTestId("button-publish-exam"));
    await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "publish", examId: 1 } }));
  });

  it("shows each member of staff's exam activity, with questions opened", () => {
    const zero = { saved: 0, pdf: 0, diagram: 0, submitted: 0, published: 0, returned: 0, withdrawn: 0, hidden: 0, opened: 0, marked: 0, released: 0, deleted: 0, attempt: 0 };
    api.activity = { from: "2026-11-02", to: "2026-11-08", today: "2026-11-08", staff: [
      { email: "musa@x", name: "Mr Musa", role: "teacher", counts: { ...zero, saved: 2, opened: 5, released: 1 }, events: [{ at: future, who: "Mr Musa", label: "Copied the questions", kind: "opened", examId: 1, examTitle: "Exam 1" }] },
      { email: "eo@x", name: "eo@x", role: "exam officer", counts: { ...zero, published: 3 }, events: [] },
    ] };
    render(wrap(<ActivityView />));
    const musa = screen.getByTestId("officer-staff-musa@x");
    expect(within(musa).getByText("Questions opened · 5")).toBeTruthy();
    expect(within(musa).getByText("Results released · 1")).toBeTruthy();
    expect(within(musa).getByText(/Copied the questions/)).toBeTruthy();
    expect(within(screen.getByTestId("officer-staff-eo@x")).getByText("Exam officer")).toBeTruthy();
    fireEvent.change(screen.getByTestId("select-activity-staff"), { target: { value: "eo@x" } });
    expect(screen.queryByTestId("officer-staff-musa@x")).toBeNull();
  });
});

describe("staff exams with an exam officer", () => {
  const exam = { id: 9, title: "Algebra", subject: "Mathematics", classId: 7, durationMinutes: 30, startsAt: future, endsAt: later, mode: "interactive", instructions: "", questions: [], published: false, resultsReleased: false, fileId: "f1" };
  const staff = (examOfficer: boolean, extra = {}) => ({ classes: [{ id: 7, name: "JSS 1" }], students: [], teachers: [], exams: [{ ...exam, ...extra }], attempts: [], materials: [], notices: [], examOfficer } as unknown as PortalManagement);

  it("says when an exam waits for the exam officer, shows their note, and records opening the paper", () => {
    render(wrap(<ExamsPanel data={staff(true, { reviewStatus: "returned", reviewNote: "Fix question 2" })} />));
    expect(screen.getByText("Returned by the exam officer")).toBeTruthy();
    expect(screen.getByTestId("text-review-note-9").textContent).toContain("Fix question 2");
    expect(screen.getByTestId("button-review-publish-9").textContent).toContain("send to exam officer");
    fireEvent.click(screen.getByText("Paper"));
    expect(api.access).toHaveBeenCalledWith({ examId: 9, data: { kind: "pdf" } });
    fireEvent.click(screen.getByTestId("button-duplicate-exam-9"));
    expect(api.access).toHaveBeenCalledWith({ examId: 9, data: { kind: "copy" } });
  });

  it("keeps the plain publish wording without an exam officer", () => {
    render(wrap(<ExamsPanel data={staff(false, { reviewStatus: "submitted" })} />));
    expect(screen.getByText("Waiting for the exam officer")).toBeTruthy();
    expect(screen.queryByTestId("button-review-publish-9")).toBeNull();
    cleanup();
    render(wrap(<ExamsPanel data={staff(false)} />));
    expect(screen.getByTestId("button-review-publish-9").textContent).toContain("Review and publish");
  });
});
