import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { DirectorReport } from "@workspace/api-client-react";
import { DirectorDashboard } from "../src/pages/Director";

afterEach(cleanup);

const report: DirectorReport = {
  from: "2026-10-19T06:00:00.000Z", to: "2026-10-26T06:00:00.000Z", generatedAt: "2026-10-26T06:00:00.000Z",
  admissions: { newThisWeek: 2, awaitingReview: 3, total: 40 },
  students: { active: 120, pendingActivation: 4, activatedThisWeek: 6, byClass: [{ className: "JSS 1", students: 30 }, { className: "JSS 2", students: 28 }] },
  staff: { activeTeachers: 12 },
  attendance: { rate: 90, recorded: 290, absentToday: 5, byClass: [{ className: "JSS 1", rate: 80, recorded: 150 }, { className: "JSS 2", rate: null, recorded: 0 }] },
  learning: { examsHeld: 2, attemptsSubmitted: 55, averageScore: 68, assignmentsSet: 7, submissions: 160 },
  money: { confirmedKobo: 125_000_000, confirmedCount: 1, awaitingKobo: 50_000_000, awaitingCount: 2, storeOrders: 3, storeOrdersKobo: 4_500_000 },
  messages: { thisWeek: 14, unanswered: 2 },
  website: { liveUpdates: 1 },
  security: { failedSignIns: 3, deniedActions: 0 },
  highlights: ["3 admission applications waiting for review (2 new this week).", "No register taken this week for JSS 2."],
};

it("shows what needs attention, the week's figures and attendance by class", () => {
  render(<DirectorDashboard r={report} />);
  expect(screen.getByTestId("panel-highlights").textContent).toContain("3 admission applications waiting for review");
  expect(screen.getByTestId("stat-attendance").textContent).toContain("90%");
  expect(screen.getByTestId("stat-attendance").textContent).toContain("5 absent today");
  expect(screen.getByTestId("stat-fees-confirmed").textContent).toMatch(/1,250,000/);
  expect(screen.getByTestId("stat-exams").textContent).toContain("average 68%");
  const table = screen.getByTestId("table-attendance-by-class").textContent ?? "";
  expect(table).toContain("JSS 1");
  expect(table).toContain("80%");
  expect(table).toContain("No register");
});
