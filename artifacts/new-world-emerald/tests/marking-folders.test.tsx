import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PortalManagement } from "@workspace/api-client-react";
import { MarkingPanel } from "../src/portal/manage/MarkingPanel";

const api = vi.hoisted(() => ({ run: vi.fn(async () => true) }));
vi.mock("../src/portal/manage/useCommand", async (original) => ({ ...await original<typeof import("../src/portal/manage/useCommand")>(), useCommand: () => ({ run: api.run, pending: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const classes = [{ id: 1, name: "Year 1 Amber" }, { id: 2, name: "Year 1 B" }, { id: 3, name: "Year 2 A" }];
const at = new Date(Date.now() - 86_400_000).toISOString(), later = new Date(Date.now() - 3_600_000).toISOString();
const exam = (id: number, classId: number, subject: string) => ({ id, title: `${subject} test`, subject, classId, durationMinutes: 30, startsAt: at, endsAt: later, mode: "interactive", fileId: null, instructions: "", published: true, resultsReleased: false, questions: [] });
const CODES: Record<string, string> = { Ada: "NWE/11", Kemi: "NWE/12", Tobi: "NWE/13" };
const attempt = (id: number, examId: number, classId: number, subject: string, name: string, status: "marked" | "submitted", score?: number) => ({
  id, examId, classId, subject, title: `${subject} test`, studentName: name, studentId: CODES[name] ?? "NWE/X" + id, status, score, totalMarks: 10, savedAt: at, deadline: later, answers: {}, questionKeys: [], marks: [], focusLosses: 0,
});
const data = {
  classes, examClasses: classes, teachers: [], materials: [], notices: [], makeups: [],
  students: [
    { id: 11, studentId: "NWE/11", name: "Ada", classId: 1, active: true }, { id: 12, studentId: "NWE/12", name: "Kemi", classId: 1, active: true },
    { id: 13, studentId: "NWE/13", name: "Tobi", classId: 1, active: true },
  ],
  exams: [exam(100, 1, "Maths"), exam(101, 2, "Maths"), exam(102, 1, "English"), exam(103, 3, "Maths")],
  attempts: [
    attempt(1, 100, 1, "Maths", "Ada", "marked", 8), attempt(2, 100, 1, "Maths", "Kemi", "submitted"),
    attempt(3, 101, 2, "Maths", "Bola", "marked", 6), attempt(4, 102, 1, "English", "Ada", "marked", 9), attempt(5, 103, 3, "Maths", "Zara", "submitted"),
  ],
} as unknown as PortalManagement;

it("files scripts by year, class and subject, with scores in one place", () => {
  render(<MarkingPanel data={data} />);
  const shelf = screen.getByTestId("marking-folders");
  expect(within(shelf).getAllByRole("button").map((b) => b.getAttribute("data-testid"))).toEqual(["marking-folder-all", "marking-folder-year-1", "marking-folder-year-2"]);
  expect(screen.getByTestId("marking-folder-year-1").textContent).toContain("1 to mark");
  // Awaiting marking by default; then every script and score.
  expect(screen.getAllByTestId(/^row-attempt-/).map((r) => r.getAttribute("data-testid"))).toEqual(["row-attempt-2", "row-attempt-5"]);
  fireEvent.click(screen.getByTestId("button-filter-all"));
  fireEvent.click(screen.getByTestId("marking-folder-year-1"));
  expect(screen.queryByTestId("row-attempt-5")).toBeNull();
  expect(screen.getByTestId("marking-class-1").textContent).toBe("Year 1 Amber");
  expect(screen.getByTestId("marking-subject-English")).toBeTruthy();
  expect(within(screen.getByTestId("marking-exam-100")).getByTestId("text-score-1").textContent).toBe("8 / 10 (80%)");
  expect(screen.getByTestId("marking-exam-100").textContent).toContain("Average 80%");
  fireEvent.click(screen.getByTestId("marking-class-2"));
  expect(screen.getAllByTestId(/^row-attempt-/).map((r) => r.getAttribute("data-testid"))).toEqual(["row-attempt-3"]);
});

it("gives a student who missed the exam their own make-up window", async () => {
  render(<MarkingPanel data={data} />);
  fireEvent.click(screen.getByTestId("button-filter-all"));
  fireEvent.click(screen.getByTestId("button-marking-makeup-100"));
  const dialog = screen.getByTestId("makeup-dialog");
  expect(dialog.textContent).toContain("(1 have not written it)");
  expect(screen.queryByTestId("checkbox-makeup-11")).toBeNull();
  fireEvent.click(screen.getByTestId("checkbox-makeup-13"));
  fireEvent.click(screen.getByTestId("button-save-makeup"));
  await waitFor(() => expect(api.run).toHaveBeenCalledTimes(1));
  const [command] = api.run.mock.calls[0] as unknown as [{ action: string; makeup: { examId: number; studentIds: number[]; startsAt: string; endsAt: string } }];
  expect([command.action, command.makeup.examId, command.makeup.studentIds]).toEqual(["setMakeup", 100, [13]]);
  expect(new Date(command.makeup.endsAt).getTime() - new Date(command.makeup.startsAt).getTime()).toBe(60 * 60_000);
});
