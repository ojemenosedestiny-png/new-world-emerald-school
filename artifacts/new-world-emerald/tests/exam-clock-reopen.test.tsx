import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PortalManagement } from "@workspace/api-client-react";
import { activeStudentExams, examWindow, setServerClock } from "../src/portal/lib";
import { ExamResults } from "../src/portal/manage/ExamResults";

const api = vi.hoisted(() => ({ run: vi.fn(async () => true) }));
vi.mock("../src/portal/manage/useCommand", async (original) => ({ ...await original<typeof import("../src/portal/manage/useCommand")>(), useCommand: () => ({ run: api.run, pending: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); setServerClock(new Date().toISOString(), Date.now()); });

it("a computer with a wrong clock still sees the exam open at the school's time", () => {
  const day = 86_400_000;
  const computer = Date.now();
  const school = computer + day; // this computer's clock is a whole day behind
  const exam = { id: 1, startsAt: new Date(school - 3_600_000).toISOString(), endsAt: new Date(school + 3_600_000).toISOString() };
  expect(examWindow(exam.startsAt, exam.endsAt)).toBe("upcoming"); // by the computer's own clock: "Not open yet"
  setServerClock(new Date(school).toISOString(), computer);
  expect(examWindow(exam.startsAt, exam.endsAt)).toBe("open");
  expect(activeStudentExams([exam], []).map((e) => e.id)).toEqual([1]);
});

it("a teacher reopens a script that closed early, keeping its answers, with the minutes they choose", async () => {
  const at = new Date(Date.now() - 3_600_000).toISOString();
  const exam = { id: 9, title: "Maths", subject: "Maths", classId: 1, durationMinutes: 30, startsAt: at, endsAt: new Date(Date.now() + 3_600_000).toISOString(), mode: "interactive", fileId: null, instructions: "", published: true, resultsReleased: false, questions: [{ id: "q1", type: "mcq", text: "?", options: ["a", "b"], correctAnswer: 0, marks: 1 }] };
  const data = {
    classes: [{ id: 1, name: "JSS 1A" }], teachers: [], materials: [], notices: [], makeups: [], exams: [exam],
    students: [{ id: 5, studentId: "NW/5", name: "Ada Obi", classId: 1, active: true }],
    attempts: [{ id: 77, examId: 9, classId: 1, studentId: "NW/5", studentName: "Ada Obi", status: "marked", score: 0, totalMarks: 1, deadline: at, savedAt: at, answers: {}, questionKeys: [], marks: [] }],
  } as unknown as PortalManagement;
  render(<ExamResults data={data} exam={exam as never} isAdmin={false} onClose={() => {}} />);
  fireEvent.click(screen.getByTestId("button-reopen-77"));
  fireEvent.click(screen.getByTestId("reopen-minutes-20"));
  fireEvent.click(screen.getByTestId("button-confirm-reopen"));
  await waitFor(() => expect(api.run).toHaveBeenCalledWith({ action: "reopenAttempt", attemptControl: { attemptId: 77, minutes: 20 } }, "Ada Obi can carry on for 20 minutes"));
});
