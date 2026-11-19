import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PortalManagement } from "@workspace/api-client-react";
import { dayHeading, examTimeline } from "../src/portal/lib";
import { ExamsPanel } from "../src/portal/manage/ExamsPanel";

vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useManagePortal: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
afterEach(cleanup);

// Wednesday 18 November 2026, 10:00 local time.
const now = new Date(2026, 10, 18, 10, 0).getTime();
const t = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).toISOString();
const ex = (id: number, startsAt: string, endsAt: string) => ({ id, title: "Exam " + id, startsAt, endsAt });

it("orders exams by date and time: open now, coming up (soonest first), finished (latest first), grouped by day", () => {
  const exams = [
    ex(1, t(20, 9), t(20, 10)), // Friday 9:00
    ex(2, t(16, 8), t(16, 9)), // Monday, finished
    ex(3, t(18, 9), t(18, 12)), // open, closes 12:00
    ex(4, t(19, 13), t(19, 14)), // Thursday 13:00
    ex(5, t(19, 8, 30), t(19, 9, 30)), // Thursday 8:30
    ex(6, t(18, 9, 30), t(18, 11)), // open, closes 11:00
    ex(7, t(17, 14), t(17, 15)), // Tuesday, finished
  ];
  const groups = examTimeline(exams, now);
  expect(groups.map((g) => [g.key, g.count])).toEqual([["open", 2], ["upcoming", 3], ["finished", 2]]);
  expect(groups[0].days.flatMap((d) => d.exams.map((e) => e.id))).toEqual([6, 3]);
  expect(groups[1].days.map((d) => [d.heading, d.exams.map((e) => e.id)])).toEqual([["Tomorrow, Thursday 19 November", [5, 4]], ["Friday 20 November", [1]]]);
  expect(groups[2].days.map((d) => [d.heading, d.exams.map((e) => e.id)])).toEqual([["Yesterday, Tuesday 17 November", [7]], ["Monday 16 November", [2]]]);
  expect(examTimeline([], now)).toEqual([]);
});

it("names days plainly, with the year only when it is not this year", () => {
  expect(dayHeading(t(18, 15), now)).toBe("Today, Wednesday 18 November");
  expect(dayHeading(new Date(2027, 0, 8, 9).toISOString(), now)).toBe("Friday 8 January 2027");
  expect(dayHeading("not a date", now)).toBe("Date not set");
});

it("the staff Exams list shows the groups and days in order", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const exam = (id: number, startsAt: string, endsAt: string) => ({ id, title: "Exam " + id, subject: "Maths", classId: 7, durationMinutes: 30, mode: "interactive", startsAt, endsAt, instructions: "", fileId: null, questions: [], published: true, resultsReleased: false });
  const data = { classes: [{ id: 7, name: "JSS 1" }], students: [], teachers: [], attempts: [], materials: [], notices: [],
    exams: [exam(1, t(20, 9), t(20, 10)), exam(2, t(16, 8), t(16, 9)), exam(3, t(18, 9), t(18, 12)), exam(4, t(19, 8), t(19, 9))] } as unknown as PortalManagement;
  const client = new QueryClient();
  const wrap = (c: ReactNode) => <QueryClientProvider client={client}>{c}</QueryClientProvider>;
  render(wrap(<ExamsPanel data={data} />));
  const order = screen.getAllByTestId(/^card-exam-/).map((c) => c.getAttribute("data-testid"));
  expect(order).toEqual(["card-exam-3", "card-exam-4", "card-exam-1", "card-exam-2"]);
  expect(within(screen.getByTestId("exam-group-upcoming")).getAllByTestId("exam-day-heading").map((h) => h.textContent)).toEqual(["Tomorrow, Thursday 19 November", "Friday 20 November"]);
  expect(screen.getByTestId("exam-group-open").textContent).toContain("Open now");
  vi.useRealTimers();
});
