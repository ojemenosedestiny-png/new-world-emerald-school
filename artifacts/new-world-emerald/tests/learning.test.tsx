import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortalDashboard, PortalManagement, StudentAssignment } from "@workspace/api-client-react";
import { StudentAssignments, assignmentState } from "../src/portal/StudentAssignments";
import { StudentAttendance } from "../src/portal/StudentAttendance";
import { AttendancePanel } from "../src/portal/manage/AttendancePanel";
import { studentNotifications } from "../src/portal/notifications";

const api = vi.hoisted(() => ({
  assignments: [] as unknown[],
  submit: vi.fn(),
  upload: vi.fn(),
  save: vi.fn(),
  attendance: null as unknown,
  // Stable objects, like real query data: a fresh object each render would loop the register's effect.
  sheet: { classId: 1, date: "2026-10-23", taken: false, students: [
    { id: 1, name: "Ada Obi", studentId: "NWE/2026/00001", status: null, note: "" },
    { id: 2, name: "Bayo Ade", studentId: "NWE/2026/00002", status: null, note: "" },
  ] },
  summary: { daysOpen: 0, students: [] },
}));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useListMyAssignments: () => ({ data: api.assignments, isLoading: false, isError: false }),
  useSubmitAssignment: () => ({ mutateAsync: api.submit, isPending: false }),
  uploadAssignmentImage: api.upload,
  useGetMyAttendance: () => ({ data: api.attendance, isLoading: false, isError: false }),
  useGetAttendanceSheet: () => ({ data: api.sheet, isLoading: false, isError: false }),
  useSaveAttendanceSheet: () => ({ mutateAsync: api.save, isPending: false }),
  useGetAttendanceSummary: () => ({ data: api.summary, isLoading: false, isError: false }),
}));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const day = 86_400_000;
const assignment = (over: Partial<StudentAssignment>): StudentAssignment => ({
  id: 1, subject: "Mathematics", title: "Fractions", instructions: "Do page 12", dueAt: new Date(Date.now() + day).toISOString(), maxScore: 10, submission: null, ...over,
});
const handedIn = { id: 5, text: "1/2 + 1/4 = 3/4", imageIds: [], submittedAt: new Date().toISOString(), late: false, score: null, feedback: "", markedAt: null };

describe("assignment states", () => {
  it("orders to-do, overdue, handed in and marked", () => {
    expect(assignmentState(assignment({}))).toBe("due");
    expect(assignmentState(assignment({ dueAt: new Date(Date.now() - day).toISOString() }))).toBe("overdue");
    expect(assignmentState(assignment({ submission: handedIn }))).toBe("submitted");
    expect(assignmentState(assignment({ submission: { ...handedIn, score: 8, markedAt: new Date().toISOString() } }))).toBe("marked");
  });
  it("notifies about new homework and marked work, not overdue or handed-in work", () => {
    const list = studentNotifications({ exams: [], attempts: [], notices: [], materials: [] } as unknown as PortalDashboard, undefined, {}, Date.now(), [], [
      assignment({ id: 1 }),
      assignment({ id: 2, dueAt: new Date(Date.now() - day).toISOString() }),
      assignment({ id: 3, submission: handedIn }),
      assignment({ id: 4, submission: { ...handedIn, score: 7, feedback: "Good", markedAt: new Date().toISOString() } }),
    ]);
    expect(list.map((n) => n.key).sort()).toEqual(["assignment-marked:4", "assignment:1"]);
    expect(list.find((n) => n.key === "assignment-marked:4")?.detail).toBe("7 / 10");
  });
});

describe("student assignments", () => {
  it("hands in typed work and a photo", async () => {
    api.assignments = [assignment({})];
    api.upload.mockResolvedValue({ imageId: "img-1" });
    api.submit.mockResolvedValue(assignment({ submission: handedIn }));
    render(wrap(<StudentAssignments />));
    expect(screen.getByTestId("card-assignment-1").textContent).toContain("To do");
    fireEvent.click(screen.getByTestId("button-open-submit-1"));
    expect((screen.getByTestId("button-hand-in-1") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-answer-1"), { target: { value: "  1/2 + 1/4 = 3/4 " } });
    fireEvent.click(screen.getByTestId("button-hand-in-1"));
    await waitFor(() => expect(api.submit).toHaveBeenCalledWith({ id: 1, data: { text: "1/2 + 1/4 = 3/4", imageIds: [] } }));
  });
  it("shows the score and feedback once marked, with no way to change the work", () => {
    api.assignments = [assignment({ submission: { ...handedIn, score: 9, feedback: "Excellent work", markedAt: new Date().toISOString() } })];
    render(wrap(<StudentAssignments />));
    expect(screen.getByTestId("feedback-1").textContent).toContain("9 / 10");
    expect(screen.getByTestId("feedback-1").textContent).toContain("Excellent work");
    expect(screen.queryByTestId("button-open-submit-1")).toBeNull();
  });
  it("explains an empty list", () => {
    api.assignments = [];
    render(wrap(<StudentAssignments />));
    expect(screen.getByText("No assignments yet")).toBeTruthy();
  });
});

describe("attendance", () => {
  it("shows the student's rate with late counted as present", () => {
    api.attendance = { totals: { present: 7, late: 1, absent: 1, excused: 1, daysPresent: 8, daysRecorded: 10 }, records: [{ date: "2026-10-23", status: "absent", note: "Sick" }] };
    render(wrap(<StudentAttendance />));
    expect(screen.getByTestId("text-attendance-rate").textContent).toBe("80% attendance");
    expect(screen.getByTestId("list-attendance").textContent).toContain("Sick");
  });
  it("lets a teacher mark everyone present, change one, and save only marked students", async () => {
    api.save.mockResolvedValue({ classId: 1, date: "2026-10-23", taken: true, students: [] });
    const data = { classes: [{ id: 1, name: "JSS 1" }] } as unknown as PortalManagement;
    render(wrap(<AttendancePanel data={data} />));
    fireEvent.click(screen.getByTestId("status-1-absent"));
    fireEvent.change(screen.getByTestId("note-1"), { target: { value: "Sick " } });
    fireEvent.click(screen.getByTestId("button-save-register"));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.save.mock.calls[0][0].data.records).toEqual([{ studentId: 1, status: "absent", note: "Sick" }]);
    fireEvent.click(screen.getByTestId("button-mark-all-present"));
    fireEvent.click(screen.getByTestId("button-save-register"));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(2));
    expect(api.save.mock.calls[1][0].data.records.map((r: { status: string }) => r.status)).toEqual(["absent", "present"]);
  });
});
