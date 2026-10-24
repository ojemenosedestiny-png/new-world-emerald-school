import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortalDashboard, PortalEvent } from "@workspace/api-client-react";
import { calendarItems, monthGrid, onDay, upcomingItems } from "../src/portal/events";
import { StudentEvents } from "../src/portal/StudentEvents";
import { StaffDirectory } from "../src/portal/StaffDirectory";
import { fromLocalInput, toLocalInput } from "../src/portal/manage/EventsPanel";

const today = new Date();
const at = (dayOffset: number, hour = 9) => { const d = new Date(today); d.setDate(d.getDate() + dayOffset); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
const event = (over: Partial<PortalEvent>): PortalEvent => ({ id: 1, title: "Event", details: "", venue: "", category: "general", startsAt: at(1), endsAt: null, allDay: false, classId: null, className: null, published: true, ...over });
const events = [
  event({ id: 1, title: "PTA meeting", category: "meeting", venue: "Hall", startsAt: at(0, 14), endsAt: at(0, 16) }),
  event({ id: 2, title: "Mid-term break", category: "holiday", allDay: true, startsAt: at(3, 0), endsAt: at(5, 0) }),
  event({ id: 3, title: "Old fair", startsAt: at(-10) }),
];
const exams = [{ id: 7, title: "Maths test", subject: "Mathematics", durationMinutes: 40, startsAt: at(0, 15), endsAt: at(0, 17), mode: "interactive", instructions: "", questionCount: 5, totalMarks: 10 }] as PortalDashboard["exams"];

vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useListPortalEvents: () => ({ data: events, isLoading: false, isError: false }),
  useGetStaffDirectory: () => ({ isLoading: false, isError: false, data: [
    { id: 1, name: "Mrs Funke Bello", title: "Class Teacher", subjects: ["Mathematics"], classNames: ["JSS 1"] },
    { id: 2, name: "Mr Chidi Okeke", title: "", subjects: ["English Language"], classNames: [] },
  ] }),
}));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(cleanup);

describe("calendar helpers", () => {
  it("builds Monday-first month grids", () => {
    const weeks = monthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(weeks[0].slice(0, 3)).toEqual([null, null, null]);
    expect(weeks[0][3]?.getDate()).toBe(1);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
  it("merges events and exams, spans multi-day events and drops past ones from upcoming", () => {
    const items = calendarItems(events, exams);
    expect(items.map((i) => i.key)).toEqual(["event:3", "event:1", "exam:7", "event:2"]);
    const brk = items.find((i) => i.key === "event:2")!;
    expect([2, 3, 4, 5, 6].map((d) => onDay(brk, new Date(at(d))))).toEqual([false, true, true, true, false]);
    expect(upcomingItems(items, Date.now(), 10).map((i) => i.key)).not.toContain("event:3");
  });
  it("converts event times to and from form inputs", () => {
    const iso = at(2, 13);
    expect(fromLocalInput(toLocalInput(iso, false), false)).toBe(iso);
    expect(toLocalInput(iso, true)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(fromLocalInput(toLocalInput(iso, true), true)!).getHours()).toBe(0);
    expect(fromLocalInput("", false)).toBeNull();
  });
});

describe("student calendar", () => {
  it("shows today's items, upcoming events, and a chosen day", () => {
    const onGo = vi.fn();
    render(wrap(<StudentEvents data={{ className: "JSS 1", exams, attempts: [], materials: [], notices: [] } as unknown as PortalDashboard} onGo={onGo} />));
    const day = screen.getByTestId("list-day");
    expect(day.textContent).toContain("PTA meeting");
    expect(day.textContent).toContain("Maths test");
    expect(screen.getByTestId("list-upcoming").textContent).toContain("Mid-term break");
    expect(screen.getByTestId("list-upcoming").textContent).not.toContain("Old fair");
    fireEvent.click(screen.getAllByTestId("cal-item-exam:7")[0]);
    expect(onGo).toHaveBeenCalledWith("exams");
    fireEvent.click(screen.getByTestId("button-next-month"));
    fireEvent.click(screen.getByTestId("button-prev-month"));
    expect(screen.getByTestId("text-month").textContent).toContain(String(today.getFullYear()));
  });
});

describe("staff directory", () => {
  it("lists staff without contact details and filters by subject", () => {
    render(wrap(<StaffDirectory />));
    expect(screen.getByTestId("staff-1").textContent).toContain("Class Teacher");
    expect(screen.getByTestId("staff-1").textContent).toContain("FB");
    expect(screen.getByTestId("staff-2").textContent).toContain("Teacher");
    fireEvent.change(screen.getByTestId("input-staff-search"), { target: { value: "english" } });
    expect(screen.queryByTestId("staff-1")).toBeNull();
    expect(screen.getByTestId("staff-2")).toBeTruthy();
    fireEvent.change(screen.getByTestId("input-staff-search"), { target: { value: "physics" } });
    expect(screen.getByText(/No one matches/)).toBeTruthy();
  });
});
