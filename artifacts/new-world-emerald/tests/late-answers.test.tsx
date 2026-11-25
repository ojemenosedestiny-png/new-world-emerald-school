import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PortalManagement } from "@workspace/api-client-react";
import { MarkingPanel } from "../src/portal/manage/MarkingPanel";

const api = vi.hoisted(() => ({ run: vi.fn(async () => true) }));
vi.mock("../src/portal/manage/useCommand", async (original) => ({ ...await original<typeof import("../src/portal/manage/useCommand")>(), useCommand: () => ({ run: api.run, pending: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("shows answers a student's computer sent after time ran out, for the teacher to accept", async () => {
  const at = new Date(Date.now() - 3_600_000).toISOString();
  const data = {
    classes: [{ id: 1, name: "JSS 1A" }], teachers: [], materials: [], notices: [], makeups: [], students: [],
    exams: [{ id: 5, title: "Maths", subject: "Maths", classId: 1, durationMinutes: 30, startsAt: at, endsAt: at, mode: "interactive", fileId: null, instructions: "", published: true, resultsReleased: false, questions: [] }],
    attempts: [{ id: 41, examId: 5, classId: 1, subject: "Maths", title: "Maths", studentName: "Ada Obi", studentId: "NW/1", status: "marked", score: 2, totalMarks: 30, savedAt: at, deadline: at, answers: {}, questionKeys: [], closedBy: "time", submittedAt: at, lateAnswerCount: 27, lateAnswersAt: at }],
  } as unknown as PortalManagement;
  render(<MarkingPanel data={data} />);
  fireEvent.click(screen.getByTestId("button-filter-all"));
  expect(screen.getByTestId("late-answers-41").textContent).toContain("sent 27 answers after time ran out");
  fireEvent.click(screen.getByTestId("button-accept-late-41"));
  await waitFor(() => expect(api.run).toHaveBeenCalledWith({ action: "acceptLateAnswers", attemptControl: { attemptId: 41 } }, "Late answers accepted"));
  fireEvent.click(screen.getByTestId("button-ignore-late-41"));
  await waitFor(() => expect(api.run).toHaveBeenCalledWith({ action: "ignoreLateAnswers", attemptControl: { attemptId: 41 } }, "Late answers ignored"));
});
