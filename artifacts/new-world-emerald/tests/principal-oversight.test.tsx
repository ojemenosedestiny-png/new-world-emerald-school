import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PrincipalDashboard, PrincipalExamList, PrincipalResults } from "@workspace/api-client-react";
import { ExamsView, OverviewView, ResultsView, attentionItems, lastSeenLabel } from "../src/portal/principal/OversightViews";

const zero = { register: 0, scores: 0, exams: 0, marking: 0, messages: 0, assignments: 0, notes: 0, announcements: 0, other: 0 };
const days = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"];
const dash: PrincipalDashboard = {
  today: "2026-11-02", days, examTerm: "First Term, 2026/2027", resultTerm: "First Term, 2026/2027",
  figures: { teachers: 2, activeToday: 1, classes: 2, registersToday: 1, examsThisTerm: 3, awaitingSignature: 1 },
  teachers: [
    { id: 7, name: "Mr Musa", email: "m@x", photoFileId: null, classes: ["JSS 1"], activeDays: [true, true, true, true, true, false, true], activeToday: true, lastSeen: "2026-11-02T13:10:00Z", counts: { ...zero, register: 5, marking: 2 }, examsSet: 2 },
    { id: 8, name: "Mrs Ngozi", email: "n@x", photoFileId: null, classes: [], activeDays: [true, false, false, false, false, false, false], activeToday: false, lastSeen: null, counts: zero, examsSet: 0 },
  ],
  classes: [
    { id: 1, name: "JSS 1", students: 20, classTeachers: ["Mr Musa"], registerToday: true, resultStatus: "review", scoresEntered: 100, scoresExpected: 120, examsThisTerm: 3 },
    { id: 2, name: "JSS 2", students: 18, classTeachers: [], registerToday: false, resultStatus: "draft", scoresEntered: 0, scoresExpected: 90, examsThisTerm: 0 },
  ],
};
const examList: PrincipalExamList = {
  terms: [{ key: "2026-1", label: "First Term, 2026/2027", count: 2 }, { key: "2025-3", label: "Third Term, 2025/2026", count: 4 }], term: "2026-1",
  exams: [
    { id: 11, title: "Mid-term test", subject: "Mathematics", classId: 1, className: "JSS 1", setBy: "Mr Musa", startsAt: "2026-11-02T08:00:00Z", endsAt: "2026-11-02T09:00:00Z", durationMinutes: 40, mode: "questions", questionCount: 2, totalMarks: 10, status: "open", students: 20, sat: 12, marked: 0, averagePercent: null },
    { id: 12, title: "Spelling", subject: "English", classId: 2, className: "JSS 2", setBy: "", startsAt: "2026-10-29T08:00:00Z", endsAt: "2026-10-29T09:00:00Z", durationMinutes: 20, mode: "questions", questionCount: 5, totalMarks: 10, status: "released", students: 18, sat: 18, marked: 18, averagePercent: 64 },
  ],
};
const results = (image: string | null): PrincipalResults => ({
  terms: [{ id: 3, label: "First Term, 2026/2027" }], termId: 3, signature: { name: image ? "Mrs Okafor" : "", image },
  classes: [
    { id: 1, name: "JSS 1", status: "review", teacherName: "Mr Musa", submittedAt: "2026-10-31T10:00:00Z", approvedBy: "", approvedAt: null, signedByPrincipal: false, students: 20, scoresEntered: 120, scoresExpected: 120, returnNote: "" },
    { id: 2, name: "JSS 2", status: "approved", teacherName: "Mrs Ngozi", submittedAt: null, approvedBy: "Mrs Okafor", approvedAt: null, signedByPrincipal: true, students: 18, scoresEntered: 90, scoresExpected: 90, returnNote: "" },
  ],
});

const api = vi.hoisted(() => ({ manage: vi.fn(async () => ({ message: "Saved." })), results: null as unknown, examParams: vi.fn() }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useGetPrincipalDashboard: () => ({ isLoading: false, isError: false, data: dash, refetch: vi.fn() }),
  useGetPrincipalExams: (params: unknown) => { api.examParams(params); return { isLoading: false, isError: false, data: examList, refetch: vi.fn() }; },
  useGetPrincipalExam: () => ({ isLoading: false, isError: false, data: { exam: examList.exams[0], instructions: "Answer all.", questions: [{ id: "a", type: "mcq", text: "2 + 2?", options: ["3", "4"], correctAnswer: 1, marks: 2, passage: "", hasDiagram: false }] }, refetch: vi.fn() }),
  useGetPrincipalResults: () => ({ isLoading: false, isError: false, data: api.results, refetch: vi.fn() }),
  useManagePrincipalResults: () => ({ mutateAsync: api.manage, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("greets the principal with today's figures and what needs attention", () => {
  const open = vi.fn();
  render(wrap(<OverviewView section="secondary" schoolLabel="Secondary school principal" classesLabel="JSS 1 to SS 3" name="Mrs Adaeze Okafor" onOpen={open} />));
  expect(screen.getByRole("heading", { level: 2, name: /, Adaeze$/ })).toBeTruthy();
  expect(within(screen.getByTestId("hero-active")).getByText("1 of 2")).toBeTruthy();
  fireEvent.click(screen.getByTestId("button-hero-sign"));
  expect(open).toHaveBeenCalledWith("results");
  expect(within(screen.getByTestId("panel-attention")).getByText(/JSS 1 has results waiting for your signature/)).toBeTruthy();
  expect(screen.getByTestId("attention-teacher").textContent).toContain("JSS 2 has no class teacher");
  expect(within(screen.getByTestId("week-7")).getByText("Registers · 5")).toBeTruthy();
  expect(within(screen.getByTestId("week-7")).getByText("2 exams set this term")).toBeTruthy();
  fireEvent.click(screen.getByTestId("filter-week-away"));
  expect(screen.queryByTestId("week-7")).toBeNull();
  expect(within(screen.getByTestId("week-8")).getByText("Not this week")).toBeTruthy();
});

it("lists a register missing only on school days, and names teachers away for three days", () => {
  const keys = attentionItems(dash).map((i) => i.key);
  expect(keys).toEqual(["sign", "register", "teacher", "away"]);
  expect(attentionItems({ ...dash, today: "2026-11-01" }).some((i) => i.key === "register")).toBe(false);
  expect(lastSeenLabel("2026-11-02T13:10:00Z", days)).toBe("Today 14:10");
  expect(lastSeenLabel("2026-11-01T08:00:00Z", days)).toBe("Yesterday 09:00");
});

it("shows the term's exams with who set them, filters them, and opens a paper with its answers", async () => {
  render(wrap(<ExamsView section="secondary" />));
  expect(within(screen.getByTestId("exam-11")).getByText("Mr Musa")).toBeTruthy();
  expect(within(screen.getByTestId("exam-12")).getByText("Not recorded")).toBeTruthy();
  fireEvent.change(screen.getByTestId("select-exam-status"), { target: { value: "open" } });
  expect(screen.queryByTestId("exam-12")).toBeNull();
  fireEvent.click(screen.getByTestId("term-2025-3"));
  expect(api.examParams).toHaveBeenLastCalledWith({ section: "secondary", term: "2025-3" });
  fireEvent.click(screen.getByTestId("button-view-exam-11"));
  await waitFor(() => expect(screen.getByTestId("exam-paper")).toBeTruthy());
  expect(screen.getByLabelText("Correct answer").closest("li")?.textContent).toContain("4");
});

it("asks for a signature before signing, then signs, publishes and sends back results", async () => {
  api.results = results(null);
  const { unmount } = render(wrap(<ResultsView section="primary" />));
  expect((screen.getByTestId("button-sign-1") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByTestId("input-principal-name"), { target: { value: "Mrs Okafor" } });
  fireEvent.click(screen.getByTestId("button-save-principal-signature"));
  await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "saveSignature", name: "Mrs Okafor", signature: null, section: "primary" } }));
  unmount();
  api.results = results("data:image/png;base64,AAAA");
  render(wrap(<ResultsView section="primary" />));
  fireEvent.click(screen.getByTestId("button-sign-1"));
  await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "approve", termId: 3, classId: 1, section: "primary" } }));
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(screen.getByTestId("button-publish-2"));
  await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "publish", termId: 3, classId: 2, section: "primary" } }));
  confirm.mockRestore();
  fireEvent.click(screen.getByTestId("button-return-1"));
  fireEvent.change(screen.getByTestId("input-return-note"), { target: { value: "Check Maths" } });
  fireEvent.click(screen.getByTestId("button-confirm-return"));
  await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "return", termId: 3, classId: 1, note: "Check Maths", section: "primary" } }));
});
