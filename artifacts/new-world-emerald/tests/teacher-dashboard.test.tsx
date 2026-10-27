import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PortalManagement } from "@workspace/api-client-react";
import { dashboardData } from "../src/portal/manage/dashboardData";
import { Dashboard } from "../src/portal/manage/Dashboard";

const api = vi.hoisted(() => ({ sheet: vi.fn() }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useListMessageThreads: () => ({ data: [{ unread: 2 }, { unread: 1 }] }),
  useListStaffAssignments: () => ({ data: [{ submitted: 5, marked: 2 }] }),
  getAttendanceSheet: api.sheet,
}));
vi.mock("recharts", async (original) => ({ ...await original<typeof import("recharts")>(), ResponsiveContainer: ({ children }: { children: ReactNode }) => <div style={{ width: 400, height: 200 }}>{children}</div> }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const now = Date.now();
const iso = (mins: number) => new Date(now + mins * 60_000).toISOString();
const students = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, studentId: `NWE/2026/0000${i + 1}`, name: `Student ${i + 1}`, classId: 1, active: true }));
const attempt = (id: number, studentId: number, status: string, deadlineMins: number) => ({ id, examId: 10, studentId: "x", studentName: "x", classId: 1, status, deadline: iso(deadlineMins), savedAt: iso(-5), score: null, totalMarks: 10, title: "Maths CBT", subject: "Maths", questions: [], questionKeys: [], answers: {} });
const data = {
  classes: [{ id: 1, name: "JSS 1" }, { id: 2, name: "JSS 2" }],
  students,
  teachers: [],
  exams: [{ id: 10, title: "Maths CBT", subject: "Maths", classId: 1, published: true, startsAt: iso(-30), endsAt: iso(60), durationMinutes: 40, questions: [], resultsReleased: false, mode: "interactive", instructions: "" }],
  attempts: [attempt(1, 1, "in_progress", 20), attempt(2, 2, "in_progress", 15), attempt(3, 3, "submitted", 0), attempt(4, 4, "in_progress", -1)],
  materials: [], notices: [],
} as unknown as PortalManagement;

it("counts each open exam's room: not started, writing, out of time and submitted add up to the class", () => {
  const [live] = dashboardData(data, now).live;
  expect(live).toMatchObject({ title: "Maths CBT", className: "JSS 1", classSize: 6, writing: 2, timedOut: 1, submitted: 1, notStarted: 2 });
});

it("shows today's plan, the live exam and sends the teacher to the right screen", async () => {
  api.sheet.mockImplementation(async ({ classId }: { classId: number }) => ({ classId, date: "x", taken: classId === 2, students: classId === 1 ? students : [{ id: 99 }] }));
  const onGo = vi.fn();
  render(wrap(<Dashboard data={data} dark={false} onGo={onGo} />));
  expect(screen.getByTestId("text-dashboard-summary").textContent).toBe("1 exam is open: 2 writing now.");
  expect(screen.getByTestId("live-notStarted-10").textContent).toBe("2");
  expect(screen.getByTestId("live-submitted-10").textContent).toBe("1");
  expect(screen.getByTestId("todo-mark").textContent).toContain("1 exam script to mark");
  expect(screen.getByTestId("todo-messages").textContent).toContain("3 unread messages");
  expect(screen.getByTestId("todo-homework").textContent).toContain("3 homework submissions to mark");
  const weekend = [0, 6].includes(new Date().getDay());
  if (!weekend) await waitFor(() => expect(screen.getByTestId("todo-register").textContent).toContain("Take today's register for JSS 1"));
  fireEvent.click(screen.getByTestId("button-dashboard-register"));
  expect(onGo).toHaveBeenLastCalledWith("attendance");
  fireEvent.click(screen.getByTestId("todo-messages").querySelector("button")!);
  expect(onGo).toHaveBeenLastCalledWith("messages");
});
