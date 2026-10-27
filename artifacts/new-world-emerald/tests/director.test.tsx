import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { DirectorReport } from "@workspace/api-client-react";
import { DirectorDashboard } from "../src/pages/Director";

afterEach(cleanup);

const report: DirectorReport = {
  days: 7,
  from: "2026-10-19T06:00:00.000Z", to: "2026-10-26T06:00:00.000Z", generatedAt: "2026-10-26T06:00:00.000Z",
  admissions: { newThisWeek: 2, awaitingReview: 3, total: 40 },
  students: { active: 120, pendingActivation: 4, activatedThisWeek: 6, byClass: [{ className: "JSS 1", students: 30 }, { className: "JSS 2", students: 28 }, { className: "Primary 4", students: 25 }] },
  staff: { activeTeachers: 12 },
  attendance: { rate: 90, recorded: 290, absentToday: 5, byClass: [{ className: "JSS 1", rate: 80, recorded: 150 }, { className: "JSS 2", rate: null, recorded: 0 }, { className: "Primary 4", rate: 97, recorded: 140 }] },
  learning: { examsHeld: 2, attemptsSubmitted: 55, averageScore: 68, assignmentsSet: 7, submissions: 160 },
  money: { confirmedKobo: 125_000_000, confirmedCount: 1, awaitingKobo: 50_000_000, awaitingCount: 2, storeOrders: 3, storeOrdersKobo: 4_500_000 },
  messages: { thisWeek: 14, unanswered: 2 },
  website: { liveUpdates: 1 },
  security: { failedSignIns: 3, deniedActions: 0 },
  highlights: ["3 admission applications waiting for review (2 new this week).", "No register taken this week for JSS 2."],
};

it("shows what needs attention with a link to deal with each item", () => {
  render(<DirectorDashboard r={report} />);
  const panel = screen.getByTestId("panel-highlights");
  expect(panel.textContent).toContain("3 admission applications waiting for review");
  expect(within(panel).getByText(/Review admissions/).closest("a")?.getAttribute("href")).toContain("/admin");
  expect(within(panel).getByText(/See attendance/).closest("a")?.getAttribute("href")).toContain("/portal/manage");
});

it("shows the period's figures and fees, colouring only what needs action", () => {
  render(<DirectorDashboard r={report} />);
  expect(screen.getByTestId("stat-attendance").textContent).toContain("90%");
  expect(screen.getByTestId("stat-attendance").textContent).toContain("5 absent today");
  expect(screen.getByTestId("stat-fees-confirmed").textContent).toMatch(/1,250,000/);
  expect(screen.getByTestId("stat-fees-confirmed").textContent).toMatch(/Awaiting confirmation.*500,000 \(2\)/);
  expect(screen.getByTestId("stat-exams").textContent).toContain("Average 68%");
  expect(screen.getByTestId("stat-messages").textContent).toContain("2 waiting for a staff reply");
});

it("sorts attendance by lowest rate first, or by class", () => {
  render(<DirectorDashboard r={report} />);
  const names = () => screen.getAllByTestId("row-attendance-class").map((r) => r.querySelector("span span")?.textContent);
  expect(names()).toEqual(["JSS 2", "JSS 1", "Primary 4"]);
  expect(screen.getByTestId("table-attendance-by-class").textContent).toContain("No register");
  fireEvent.click(screen.getByTestId("sort-attendance-name"));
  expect(names()).toEqual(["JSS 1", "JSS 2", "Primary 4"]);
});
