import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReportWorkspace } from "@workspace/api-client-react";
import { CbtScoresDialog, convertScore } from "../src/portal/reports/CbtScoresDialog";

const api = vi.hoisted(() => ({ manage: vi.fn(async () => ({ message: "ok" })) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useManageReports: () => ({ mutateAsync: api.manage, isPending: false }),
  useGetPortalManagement: () => ({ isLoading: false, data: {
    exams: [{ id: 50, title: "SS3 Mathematics CBT", subject: "Mathematics", classId: 7, mode: "interactive", startsAt: "2026-10-28T08:00:00Z" }],
    attempts: [
      { examId: 50, studentId: "NWE-1", status: "marked", score: 38, totalMarks: 50 },
      { examId: 50, studentId: "nwe-2", status: "marked", score: 50, totalMarks: 50 },
      { examId: 50, studentId: "NWE-3", status: "in_progress", score: undefined, totalMarks: 50 },
    ],
  } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const term = { id: 3, session: "2026/2027", term: "First Term", caMax: 40, examMax: 60, nextTermBegins: null };
const ws = (subjects: { id: number; name: string }[]) => ({
  classes: [{ id: 7, name: "SS3" }], classId: 7, canAdmin: true,
  subjects: subjects.map((s, i) => ({ ...s, classId: 7, sortOrder: i, teacherId: null })),
  students: [{ id: 1, studentId: "NWE-1", name: "Ada Obi" }, { id: 2, studentId: "NWE-2", name: "Bayo Ade" }, { id: 3, studentId: "NWE-3", name: "Chi Eze" }],
  scores: [{ studentId: 1, subjectId: 10, ca: 30, exam: null, total: null, grade: null }],
}) as unknown as ReportWorkspace;

it("converts a CBT score to the report card maximum in half marks", () => {
  expect(convertScore(38, 50, 60)).toBe(45.5);
  expect(convertScore(50, 50, 60)).toBe(60);
  expect(convertScore(7, 20, 40)).toBe(14);
  expect(convertScore(5, 0, 60)).toBeNull();
});

it("brings marked CBT scores into the Exam column, keeping each student's CA, and skips who did not finish", async () => {
  render(wrap(<CbtScoresDialog ws={ws([{ id: 10, name: "Mathematics" }])} term={term} onClose={() => {}} />));
  expect(screen.getByTestId("text-cbt-summary").textContent).toContain("2 of 3 students have a marked score. 1 did not sit");
  expect(screen.getByTestId("table-cbt-preview").textContent).toContain("38/50");
  fireEvent.click(screen.getByTestId("button-save-cbt"));
  await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "saveScores", scores: { termId: 3, entries: [
    { studentId: 1, subjectId: 10, ca: 30, exam: 45.5, total: null, grade: null },
    { studentId: 2, subjectId: 10, ca: null, exam: 60, total: null, grade: null },
  ] } } }));
});

it("with no subjects yet, the office adds the subject from the exam first", async () => {
  render(wrap(<CbtScoresDialog ws={ws([])} term={term} onClose={() => {}} />));
  expect(screen.getByTestId("button-save-cbt").textContent).toBe("Add subject");
  fireEvent.click(screen.getByTestId("button-save-cbt"));
  await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "saveSubject", subject: { classId: 7, name: "Mathematics" } } }));
});
