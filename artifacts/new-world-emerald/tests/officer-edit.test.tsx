import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ExamOfficerPaper } from "@workspace/api-client-react";
import { PaperDialog } from "../src/portal/exam-officer/OfficerViews";

const api = vi.hoisted(() => ({ edit: vi.fn(async () => ({ message: "Saved." })), paper: null as unknown }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useManageExamOfficer: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEditExamOfficerExam: () => ({ mutateAsync: api.edit, isPending: false }),
  useGetExamOfficerExam: () => ({ isLoading: false, isError: false, data: api.paper, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const opens = new Date(Date.now() + 86_400_000).toISOString(), closes = new Date(Date.now() + 86_400_000 + 7_200_000).toISOString();
const paper = (extra: Partial<ExamOfficerPaper> = {}): ExamOfficerPaper => ({
  exam: { id: 7, title: "JSS 2 Basic Science", subject: "Basic Science", classId: 3, className: "JSS 2", section: "secondary", setBy: "Mrs Okafor", startsAt: opens, endsAt: closes, durationMinutes: 40, mode: "interactive", questionCount: 1, totalMarks: 1, status: "awaiting", reviewNote: "", submittedBy: "okafor@example.test", submittedAt: opens, reviewedBy: "", reviewedAt: null, students: 30, sat: 0, marked: 0, opened: 0 },
  instructions: "Answer all.", history: [],
  questions: [{ id: "q1", type: "mcq", text: "Which is a mammal?", options: ["Shark", "Whale"], correctAnswer: 1, marks: 1, passage: "", hasDiagram: false }],
  editQuestions: [{ id: "q1", type: "mcq", text: "Which is a mammal?", options: ["Shark", "Whale"], correctAnswer: 1, marks: 1 }],
  locked: false, ...extra,
});

it("lets the exam officer change the date, time and questions, then save and publish", async () => {
  api.paper = paper();
  render(wrap(<PaperDialog id={7} onClose={() => {}} />));
  fireEvent.click(screen.getByTestId("button-edit-officer-exam"));
  expect(screen.getByTestId("officer-edit-dialog")).toBeTruthy();
  fireEvent.change(screen.getByTestId("input-officer-start"), { target: { value: "2030-03-10T09:00" } });
  fireEvent.change(screen.getByTestId("input-officer-end"), { target: { value: "2030-03-10T11:00" } });
  fireEvent.change(screen.getByTestId("input-officer-duration"), { target: { value: "50" } });
  fireEvent.change(screen.getByTestId("input-qtext-0"), { target: { value: "Which of these is a mammal?" } });
  fireEvent.click(screen.getByTestId("button-officer-save-publish"));
  await waitFor(() => expect(api.edit).toHaveBeenCalledTimes(1));
  const sent = (api.edit.mock.calls[0] as unknown as [{ examId: number; data: Record<string, unknown> }])[0];
  expect(sent.examId).toBe(7);
  expect(sent.data).toMatchObject({ durationMinutes: 50, publish: true, startsAt: new Date("2030-03-10T09:00").toISOString(), endsAt: new Date("2030-03-10T11:00").toISOString() });
  expect((sent.data.questions as { text: string; correctAnswer: number }[])[0]).toMatchObject({ text: "Which of these is a mammal?", correctAnswer: 1 });
});

it("stops a save that would break the exam, and locks questions once students start", async () => {
  api.paper = paper();
  render(wrap(<PaperDialog id={7} onClose={() => {}} />));
  fireEvent.click(screen.getByTestId("button-edit-officer-exam"));
  fireEvent.change(screen.getByTestId("input-officer-end"), { target: { value: "2020-01-01T08:00" } });
  fireEvent.click(screen.getByTestId("button-officer-save"));
  expect(screen.getByTestId("officer-edit-errors").textContent).toContain("The window must end after it starts.");
  expect(api.edit).not.toHaveBeenCalled();
  cleanup();

  api.paper = paper({ locked: true, exam: { ...paper().exam, status: "open", sat: 4 } });
  render(wrap(<PaperDialog id={7} onClose={() => {}} />));
  fireEvent.click(screen.getByTestId("button-edit-officer-exam"));
  expect(screen.getByTestId("text-officer-locked").textContent).toContain("questions are locked");
  expect(screen.queryByTestId("input-qtext-0")).toBeNull();
  expect(screen.queryByTestId("button-officer-save-publish")).toBeNull();
  fireEvent.click(screen.getByTestId("button-officer-save"));
  await waitFor(() => expect(api.edit).toHaveBeenCalledTimes(1));
});
