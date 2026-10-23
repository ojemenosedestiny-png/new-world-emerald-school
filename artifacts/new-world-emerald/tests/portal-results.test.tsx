import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortalManagement } from "@workspace/api-client-react";
import { examRoster, examStats, resultsCsv, studentAverage } from "../src/portal/manage/results";
import { ExamResults } from "../src/portal/manage/ExamResults";
import { ExamsPanel } from "../src/portal/manage/ExamsPanel";

const mocks = vi.hoisted(() => ({ manage: vi.fn() }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useManagePortal: () => ({ mutateAsync: mocks.manage, isPending: false }),
}));

const now = Date.now();
const question = { id: "q1", type: "mcq" as const, text: "2 + 2?", options: ["3", "4"], correctAnswer: 1, marks: 10 };
function attempt(id: number, studentId: string, studentName: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id, examId: 1, title: "Maths test", subject: "Maths", mode: "interactive", instructions: "", fileId: null,
    questions: [{ id: "q1", type: "mcq" as const, text: "2 + 2?", options: ["3", "4"], marks: 10 }], answers: {},
    startedAt: new Date(now - 60_000).toISOString(), deadline: new Date(now + 20 * 60_000).toISOString(),
    serverNow: new Date(now).toISOString(), savedAt: new Date(now).toISOString(), status, totalMarks: 10,
    resultsReleased: false, classId: 7, studentName, studentId, questionKeys: [question], ...extra,
  };
}
function management(overrides: Partial<PortalManagement> = {}): PortalManagement {
  return {
    classes: [{ id: 7, name: "JSS 1" }],
    students: [
      { id: 1, studentId: "S-ADA", name: "Ada", classId: 7, active: true },
      { id: 2, studentId: "S-BAYO", name: "Bayo", classId: 7, active: true },
      { id: 3, studentId: "S-CHI", name: "Chi", classId: 7, active: true },
      { id: 4, studentId: "S-DEJI", name: "Deji", classId: 7, active: true },
      { id: 5, studentId: "S-OFF", name: "Inactive", classId: 7, active: false },
      { id: 6, studentId: "S-OTHER", name: "Other class", classId: 8, active: true },
    ],
    teachers: [],
    exams: [{
      id: 1, title: "Maths test", subject: "Maths", classId: 7, durationMinutes: 30, mode: "interactive",
      startsAt: new Date(now - 3_600_000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString(),
      instructions: "", fileId: null, questions: [question], published: true, resultsReleased: false,
    }],
    attempts: [
      attempt(11, "S-ADA", "Ada", "marked", { score: 8 }),
      attempt(12, "S-BAYO", "Bayo", "marked", { score: 3 }),
      attempt(13, "S-CHI", "Chi", "in_progress"),
      attempt(14, "S-GONE", "=Former student", "submitted"),
    ],
    materials: [], notices: [],
    ...overrides,
  } as PortalManagement;
}
function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("exam results helpers", () => {
  it("lists active class students with their status, including former students with attempts", () => {
    const data = management();
    const rows = examRoster(data, data.exams[0], now);
    expect(rows.map((r) => [r.studentId, r.status])).toEqual([
      ["S-GONE", "submitted"], ["S-ADA", "marked"], ["S-BAYO", "marked"], ["S-CHI", "writing"], ["S-DEJI", "not_started"],
    ]);
    expect(rows.find((r) => r.studentId === "S-ADA")?.percent).toBe(80);
  });
  it("treats an in-progress attempt past its deadline as awaiting marking", () => {
    const data = management({ attempts: [attempt(13, "S-CHI", "Chi", "in_progress", { deadline: new Date(now - 1000).toISOString() })] });
    expect(examRoster(data, data.exams[0], now).find((r) => r.studentId === "S-CHI")?.status).toBe("submitted");
  });
  it("calculates class statistics from marked attempts only", () => {
    const data = management();
    expect(examStats(examRoster(data, data.exams[0], now))).toEqual({ marked: 2, average: 55, highest: 80, lowest: 30, passRate: 50 });
    expect(examStats([])).toBeNull();
  });
  it("exports CSV that spreadsheets cannot run as formulas", () => {
    const data = management();
    const csv = resultsCsv(examRoster(data, data.exams[0], now));
    expect(csv.split("\r\n")[0]).toBe("Student ID,Name,Status,Score,Total marks,Percent");
    expect(csv).toContain("S-GONE,'=Former student,Awaiting marking,,10,");
    expect(csv).toContain("S-ADA,Ada,Marked,8,10,80");
    expect(resultsCsv([{ studentId: "X", name: 'Ngozi "Ada", Jr', status: "not_started", totalMarks: 5 }])).toContain('"Ngozi ""Ada"", Jr"');
  });
  it("averages only released results for students", () => {
    expect(studentAverage([
      { status: "marked", resultsReleased: true, score: 8, totalMarks: 10 },
      { status: "marked", resultsReleased: true, score: 5, totalMarks: 20 },
      { status: "marked", resultsReleased: false, score: 0, totalMarks: 10 },
      { status: "submitted", resultsReleased: false, totalMarks: 10 },
    ])).toEqual({ count: 2, average: 52.5 });
    expect(studentAverage([{ status: "submitted", resultsReleased: false, totalMarks: 10 }])).toBeNull();
  });
});

describe("exam results controls", () => {
  it("gives a writing student extra time and lets an admin reset after confirming", async () => {
    mocks.manage.mockResolvedValue({ message: "Saved successfully." });
    const data = management();
    render(wrap(<ExamResults data={data} exam={data.exams[0]} isAdmin onClose={() => {}} />));
    expect(screen.getByTestId("results-stats").textContent).toContain("Average 55%");
    fireEvent.click(screen.getByTestId("button-extend-13-10"));
    await waitFor(() => expect(mocks.manage).toHaveBeenCalledWith({ data: { action: "extendAttempt", attemptControl: { attemptId: 13, minutes: 10 } } }));
    fireEvent.click(screen.getByTestId("button-reset-11"));
    fireEvent.click(await screen.findByTestId("button-confirm-reset"));
    await waitFor(() => expect(mocks.manage).toHaveBeenCalledWith({ data: { action: "resetAttempt", attemptControl: { attemptId: 11 } } }));
  });
  it("hides reset from teachers and all attempt controls once results are released", () => {
    const data = management();
    const { unmount } = render(wrap(<ExamResults data={data} exam={data.exams[0]} isAdmin={false} onClose={() => {}} />));
    expect(screen.queryByTestId("button-reset-11")).toBeNull();
    expect(screen.getByTestId("button-extend-13-5")).toBeTruthy();
    unmount();
    const released = management();
    released.exams[0].resultsReleased = true;
    render(wrap(<ExamResults data={released} exam={released.exams[0]} isAdmin onClose={() => {}} />));
    expect(screen.queryByTestId("button-reset-11")).toBeNull();
    expect(screen.queryByTestId("button-extend-13-5")).toBeNull();
  });
  it("offers delete only for exams no student has started", async () => {
    mocks.manage.mockResolvedValue({ message: "Saved successfully." });
    const started = management();
    const { unmount } = render(wrap(<ExamsPanel data={started} />));
    expect(screen.queryByTestId("button-delete-exam-1")).toBeNull();
    expect(screen.getByTestId("button-results-exam-1")).toBeTruthy();
    unmount();
    render(wrap(<ExamsPanel data={management({ attempts: [] })} />));
    fireEvent.click(screen.getByTestId("button-delete-exam-1"));
    fireEvent.click(await screen.findByTestId("button-confirm-delete-exam"));
    await waitFor(() => expect(mocks.manage).toHaveBeenCalledWith({ data: { action: "deleteExam", target: { id: 1 } } }));
  });
});
