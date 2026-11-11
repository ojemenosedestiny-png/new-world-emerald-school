import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PrincipalOverview } from "@workspace/api-client-react";
import { ActivityView, ClassesView, TeachersView } from "../src/portal/principal/PrincipalViews";

const zero = { register: 0, scores: 0, exams: 0, marking: 0, messages: 0, assignments: 0, notes: 0, announcements: 0, other: 0 };
const api = vi.hoisted(() => ({ manage: vi.fn(async () => ({ message: "Saved." })), activity: null as unknown, activityParams: vi.fn() }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useManagePrincipal: () => ({ mutateAsync: api.manage, isPending: false }),
  useGetPrincipalActivity: (params: unknown) => { api.activityParams(params); return { isLoading: false, isError: false, data: api.activity, refetch: vi.fn() }; },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const data: PrincipalOverview = {
  today: "2026-11-04",
  classes: [
    { id: 1, name: "JSS 1", students: 24, teachers: [{ id: 7, name: "Mr Musa" }], subjects: [{ id: 30, name: "Mathematics", teacherId: 7, teacherName: "Mr Musa" }, { id: 31, name: "English", teacherId: null, teacherName: null }] },
    { id: 2, name: "JSS 2", students: 20, teachers: [], subjects: [] },
  ],
  teachers: [
    { id: 7, name: "Mr Musa", email: "musa@example.test", classIds: [1], photoFileId: null, subjectCount: 1, inSection: true },
    { id: 8, name: "Mrs Ngozi", email: "ngozi@example.test", classIds: [], photoFileId: null, subjectCount: 0, inSection: true },
    // Teaches in the other school (primary): offered last, and not listed among this school's teachers.
    { id: 9, name: "Miss Bisi", email: "bisi@example.test", classIds: [], photoFileId: null, subjectCount: 0, inSection: true, unassigned: true },
  ],
};

it("shows each class's teachers and gaps, and assigns a teacher to a class", async () => {
  render(wrap(<ClassesView data={data} />));
  expect(screen.getByText("Classes without a class teacher").nextElementSibling?.textContent).toBe("1");
  expect(within(screen.getByTestId("principal-class-2")).getByText("No class teacher yet.")).toBeTruthy();
  fireEvent.change(screen.getByTestId("select-assign-2"), { target: { value: "8" } });
  fireEvent.click(screen.getByTestId("button-assign-2"));
  await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "assign", classId: 2, teacherId: 8 } }));
});

it("changes a class teacher and sets a subject's teacher", async () => {
  render(wrap(<ClassesView data={data} />));
  fireEvent.click(screen.getByTestId("button-change-1-7"));
  fireEvent.change(screen.getByTestId("select-replace-teacher"), { target: { value: "8" } });
  fireEvent.click(screen.getByTestId("button-confirm-replace"));
  await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "replace", classId: 1, teacherId: 7, newTeacherId: 8 } }));
  fireEvent.change(screen.getByTestId("select-subject-31"), { target: { value: "8" } });
  await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "setSubjectTeacher", classId: 1, subjectId: 31, teacherId: 8 } }));
});

it("removes a teacher only after confirming", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  render(wrap(<ClassesView data={data} />));
  fireEvent.click(screen.getByTestId("button-remove-1-7"));
  expect(api.manage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("button-remove-1-7"));
  await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "remove", classId: 1, teacherId: 7 } }));
  confirm.mockRestore();
});

it("lists this school's teachers with their classes and flags anyone without a class", () => {
  render(wrap(<TeachersView data={data} />));
  expect(within(screen.getByTestId("principal-teacher-7")).getByText("JSS 1")).toBeTruthy();
  expect(within(screen.getByTestId("principal-teacher-8")).getByText("No class")).toBeTruthy();
  // A new teacher not yet in any class is shown so the principal can take them on.
  expect(within(screen.getByTestId("principal-teacher-9")).getByText("No class")).toBeTruthy();
});

it("offers only this school's teachers, then new teachers not yet in a class (never the other school's)", () => {
  render(wrap(<ClassesView data={data} />));
  expect(screen.getByText("Teachers").nextElementSibling?.textContent).toBe("2");
  const groups = [...screen.getByTestId("select-assign-2").querySelectorAll("optgroup")].map((g) => [g.label, [...g.querySelectorAll("option")].map((o) => o.textContent)]);
  expect(groups).toEqual([["Teachers in this school", ["Mr Musa", "Mrs Ngozi"]], ["New, not yet in a class", ["Miss Bisi"]]]);
});

it("names the primary school's classes when it has none yet, and asks for the primary school's activity", () => {
  render(wrap(<ClassesView data={{ ...data, classes: [] }} classes="Year 1 to Year 6" />));
  expect(screen.getByText(/Classes Year 1 to Year 6 appear here/)).toBeTruthy();
  api.activity = { date: "2026-11-04", today: "2026-11-04", teachers: [] };
  render(wrap(<ActivityView today="2026-11-04" section="primary" />));
  expect(api.activityParams).toHaveBeenCalledWith({ date: "2026-11-04", section: "primary" });
});

it("shows each teacher's day: active times, what they did, and who did nothing", () => {
  api.activity = {
    date: "2026-11-04", today: "2026-11-04",
    teachers: [
      { id: 8, name: "Mrs Ngozi", email: "n@x", classes: [], firstSeen: null, lastSeen: null, counts: zero, actions: [] },
      { id: 7, name: "Mr Musa", email: "m@x", classes: ["JSS 1"], firstSeen: "2026-11-04T06:50:00Z", lastSeen: "2026-11-04T13:10:00Z", counts: { ...zero, register: 1, scores: 1 },
        actions: [{ at: "2026-11-04T07:05:00Z", kind: "register", label: "Took the class register" }, { at: "2026-11-04T10:20:00Z", kind: "scores", label: "Entered report card scores and comments" }] },
    ],
  };
  render(wrap(<ActivityView today="2026-11-04" />));
  const cards = screen.getAllByTestId(/^teacher-day-/);
  expect(cards[0].getAttribute("data-testid")).toBe("teacher-day-7");
  expect(within(cards[0]).getByText("Active 07:50 – 14:10")).toBeTruthy();
  expect(within(cards[0]).getByText("Register · 1")).toBeTruthy();
  expect(within(cards[0]).getByText("Took the class register")).toBeTruthy();
  expect(within(cards[1]).getByText("No activity")).toBeTruthy();
  expect(screen.getByText("Teachers active").nextElementSibling?.textContent).toBe("1 of 2");
  expect((screen.getByTestId("button-next-day") as HTMLButtonElement).disabled).toBe(true);
});
