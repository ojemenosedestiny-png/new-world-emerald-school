import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClipboardList, Home } from "lucide-react";
import type { PortalManagement } from "@workspace/api-client-react";
import { AppShell } from "../src/portal/shell/AppShell";
import { usePortalTheme } from "../src/portal/shell/theme";
import { dashboardData } from "../src/portal/manage/dashboardData";

afterEach(() => { cleanup(); localStorage.clear(); delete document.documentElement.dataset.portalTheme; });

describe("portal theme", () => {
  it("applies the chosen theme to the page, remembers it, and removes it on leaving", () => {
    const { result, unmount } = renderHook(() => usePortalTheme());
    expect(result.current.theme).toBe("system");
    act(() => result.current.setTheme("dark"));
    expect(document.documentElement.dataset.portalTheme).toBe("dark");
    expect(localStorage.getItem("nwe-portal-theme")).toBe("dark");
    act(() => result.current.setTheme("light"));
    expect(document.documentElement.dataset.portalTheme).toBe("light");
    unmount();
    expect(document.documentElement.dataset.portalTheme).toBeUndefined();
    const again = renderHook(() => usePortalTheme());
    expect(again.result.current.theme).toBe("light");
    act(() => again.result.current.setTheme("system"));
    expect(localStorage.getItem("nwe-portal-theme")).toBeNull();
  });
});

describe("app shell", () => {
  it("marks the current section, shows badges, and navigates", () => {
    const onNavigate = vi.fn();
    const onSignOut = vi.fn();
    render(
      <AppShell<"home" | "exams">
        subtitle="Student Portal" active="home" onNavigate={onNavigate} title="Home" eyebrow="JSS 1"
        groups={[{ items: [{ key: "home", label: "Home", icon: Home }] }, { label: "Learning", items: [{ key: "exams", label: "Exams", icon: ClipboardList, badge: 2 }] }]}
        user={{ name: "Ada Obi", detail: "NWE-1" }} theme="system" onTheme={() => {}} onSignOut={onSignOut}
      ><p>Content</p></AppShell>,
    );
    expect(screen.getByTestId("text-page-title").textContent).toBe("Home");
    const home = screen.getAllByTestId("nav-home")[0];
    expect(home.getAttribute("aria-current")).toBe("page");
    expect(screen.getAllByTestId("nav-exams")[0].getAttribute("aria-current")).toBeNull();
    expect(screen.getAllByLabelText("2 need attention").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AO").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByTestId("nav-exams")[0]);
    expect(onNavigate).toHaveBeenCalledWith("exams");
    fireEvent.click(screen.getAllByTestId("button-shell-signout")[0]);
    expect(onSignOut).toHaveBeenCalled();
    expect(screen.getByTestId("button-open-menu").getAttribute("aria-label")).toBe("Open menu");
  });
});

describe("staff dashboard data", () => {
  it("summarises exam averages, daily submissions, class sizes and what needs attention", () => {
    const now = new Date(2026, 9, 23, 12).getTime();
    const day = (offset: number, h = 10) => new Date(2026, 9, 23 + offset, h).toISOString();
    const q = [{ id: "q", type: "mcq", text: "x", options: ["a", "b"], correctAnswer: 0, marks: 10 }];
    const data = {
      classes: [{ id: 1, name: "JSS 1" }, { id: 2, name: "JSS 2" }], teachers: [], materials: [], notices: [],
      students: [{ id: 1, studentId: "A", name: "A", classId: 1, active: true }, { id: 2, studentId: "B", name: "B", classId: 1, active: true }, { id: 3, studentId: "C", name: "C", classId: 2, active: true }, { id: 4, studentId: "D", name: "D", classId: 2, active: false }],
      exams: [
        { id: 10, title: "Maths", subject: "Maths", classId: 1, startsAt: day(-3, 8), endsAt: day(-3, 12), questions: q, published: true, resultsReleased: false, durationMinutes: 30, mode: "interactive", instructions: "" },
        { id: 11, title: "English", subject: "English", classId: 1, startsAt: day(0, 9), endsAt: day(0, 15), questions: q, published: true, resultsReleased: false, durationMinutes: 30, mode: "interactive", instructions: "" },
        { id: 12, title: "Science", subject: "Science", classId: 2, startsAt: day(2, 9), endsAt: day(2, 11), questions: q, published: true, resultsReleased: false, durationMinutes: 30, mode: "interactive", instructions: "" },
      ],
      attempts: [
        { id: 1, examId: 10, status: "marked", score: 8, totalMarks: 10, savedAt: day(-3), deadline: day(-3, 11) },
        { id: 2, examId: 10, status: "marked", score: 5, totalMarks: 10, savedAt: day(-3), deadline: day(-3, 11) },
        { id: 3, examId: 11, status: "submitted", totalMarks: 10, savedAt: day(0, 11), deadline: day(0, 12) },
        { id: 4, examId: 11, status: "in_progress", totalMarks: 10, savedAt: day(0, 11), deadline: day(0, 13) },
      ],
    } as unknown as PortalManagement;
    const d = dashboardData(data, now);
    expect(d.examAverages).toEqual([{ id: 10, title: "Maths", className: "JSS 1", average: 65, marked: 2 }]);
    expect(d.days).toHaveLength(14);
    expect(d.days.reduce((s, x) => s + x.count, 0)).toBe(3);
    expect(d.days[13].count).toBe(1);
    expect(d.studentsByClass).toEqual([{ name: "JSS 1", students: 2 }, { name: "JSS 2", students: 1 }]);
    expect(d.attention.map((a) => [a.kind, a.examId, a.count])).toEqual([["live", 11, 1], ["mark", 11, 1], ["release", 10, 2]]);
    expect(d.upcoming.map((e) => [e.id, e.open])).toEqual([[11, true], [12, false]]);
  });
});
