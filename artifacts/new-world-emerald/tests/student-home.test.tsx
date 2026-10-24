import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Award, Home, LayoutGrid } from "lucide-react";
import type { PortalDashboard } from "@workspace/api-client-react";
import { markSeen, readSeen, searchPortal, studentNotifications } from "../src/portal/notifications";
import { StudentHome } from "../src/portal/StudentHome";
import { AppShell } from "../src/portal/shell/AppShell";

vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useGetStudentReports: () => ({ data: { studentName: "Ada", studentId: "S1", className: "JSS 1", reports: [{ term: { id: 4, session: "2026/2027", term: "First Term", caMax: 40, examMax: 60, nextTermBegins: null } }] } }),
  useGetMyPhoto: () => ({ data: { photoId: null, pendingPhotoId: null, uploadsEnabled: true } }),
  useListMyAssignments: () => ({ data: [{ id: 21, subject: "Mathematics", title: "Fractions homework", instructions: "", dueAt: new Date(Date.now() + 86_400_000).toISOString(), maxScore: 10, submission: null }] }),
  useListPortalEvents: () => ({ data: [{ id: 11, title: "Inter-house sports", details: "Bring water", venue: "Sports field", category: "sports", startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), endsAt: null, allDay: false, classId: null, className: null, published: true }] }),
}));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); localStorage.clear(); });

const now = Date.now();
const iso = (m: number) => new Date(now + m * 60_000).toISOString();
const data = {
  className: "JSS 1",
  exams: [
    { id: 1, title: "Mid-term Maths", subject: "Mathematics", durationMinutes: 40, startsAt: iso(-10), endsAt: iso(50), mode: "interactive", instructions: "", questionCount: 5, totalMarks: 10 },
    { id: 2, title: "English Test", subject: "English", durationMinutes: 30, startsAt: iso(60 * 24), endsAt: iso(60 * 25), mode: "interactive", instructions: "", questionCount: 5, totalMarks: 10 },
    { id: 3, title: "Old Quiz", subject: "Civic", durationMinutes: 30, startsAt: iso(-600), endsAt: iso(-500), mode: "interactive", instructions: "", questionCount: 5, totalMarks: 10 },
  ],
  attempts: [{ id: 9, examId: 3, title: "Old Quiz", subject: "Civic", status: "marked", resultsReleased: true, score: 8, totalMarks: 10 }],
  materials: [{ id: 5, title: "Fractions notes", subject: "Mathematics", body: "Adding fractions", classId: 1, fileId: null, published: true }],
  notices: [{ id: 7, title: "Sports day", body: "Wear house colours on Friday", classId: 1, published: true }],
} as unknown as PortalDashboard;

describe("notifications and search", () => {
  it("lists open exams, released results, report cards and notices; seen items stop counting", () => {
    const list = studentNotifications(data, { studentName: "", studentId: "", className: "", reports: [{ term: { id: 4, session: "2026/2027", term: "First Term" } }] } as never, {}, now);
    expect(list.map((n) => n.key).sort()).toEqual(["exam:1", "notice:7", "report:4", "result:9"]);
    expect(list.every((n) => n.unseen)).toBe(true);
    markSeen("S1", ["exam:1", "notice:7"]);
    const after = studentNotifications(data, undefined, readSeen("S1"), now);
    expect(after.filter((n) => n.unseen).map((n) => n.key)).toEqual(["result:9"]);
    expect(after[0].key).toBe("result:9", "unseen first");
  });
  it("searches features and the student's own content", () => {
    const features = [{ label: "Library", detail: "Notes and resources", section: "revision" as const }];
    expect(searchPortal("f", data, features)).toEqual([]);
    expect(searchPortal("fraction", data, features).map((h) => [h.label, h.section])).toEqual([["Fractions notes", "revision"]]);
    expect(searchPortal("maths", data, features).map((h) => h.section)).toContain("exams");
    expect(searchPortal("house", data, features).map((h) => h.label)).toEqual(["Sports day"]);
    expect(searchPortal("library", data, features)[0].label).toBe("Library");
  });
});

describe("phone-style home", () => {
  it("greets the student, opens sections from tiles and search, and clears the bell once read", async () => {
    const onGo = vi.fn();
    render(wrap(<StudentHome data={data} name="Ada Obi" studentId="S1" onGo={onGo} />));
    expect(screen.getByTestId("text-student-name").textContent).toContain("Hello, Ada");
    expect(screen.getByTestId("button-avatar").textContent).toBe("AO");
    expect(screen.getByTestId("badge-notifications").textContent).toBe("6");
    expect(screen.getByTestId("tile-assignments").textContent).toContain("1");
    expect(screen.getByTestId("tile-exams").textContent).toContain("1");
    fireEvent.click(screen.getByTestId("tile-reports"));
    expect(onGo).toHaveBeenLastCalledWith("reports");
    fireEvent.change(screen.getByTestId("input-home-search"), { target: { value: "fraction" } });
    fireEvent.click(screen.getByText("Fractions notes"));
    expect(onGo).toHaveBeenLastCalledWith("revision");
    expect(screen.getByTestId("upcoming-exam:1").textContent).toContain("Open now");
    expect(screen.getByTestId("upcoming-exam:2").textContent).toContain("Exam");
    expect(screen.getByTestId("upcoming-event:11").textContent).toContain("Sports field");
    expect(screen.queryByTestId("upcoming-exam:3")).toBeNull();
    fireEvent.click(screen.getByTestId("upcoming-event:11"));
    expect(onGo).toHaveBeenLastCalledWith("events");
    fireEvent.click(screen.getByTestId("tile-staff"));
    expect(onGo).toHaveBeenLastCalledWith("staff");
    fireEvent.click(screen.getByTestId("button-notifications"));
    expect(await screen.findByTestId("panel-notifications")).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("badge-notifications")).toBeNull());
  });
});

describe("phone bottom bar", () => {
  it("navigates and opens the full menu from More", async () => {
    const onNavigate = vi.fn();
    render(
      <AppShell<"home" | "results" | "__menu"> subtitle="Student Portal" active="home" onNavigate={onNavigate} title="Home"
        groups={[{ items: [{ key: "home", label: "Home", icon: Home }, { key: "results", label: "Results", icon: Award }] }]}
        bottomNav={[{ key: "home", label: "Home", icon: Home }, { key: "results", label: "Results", icon: Award, badge: 2 }, { key: "__menu", label: "More", icon: LayoutGrid }]}
        user={{ name: "Ada Obi", detail: "S1" }} theme="system" onTheme={() => {}} onSignOut={() => {}}>
        <p>Body</p>
      </AppShell>,
    );
    expect(screen.getByTestId("bottom-home").getAttribute("aria-current")).toBe("page");
    expect(screen.getByLabelText("2 new")).toBeTruthy();
    fireEvent.click(screen.getByTestId("bottom-results"));
    expect(onNavigate).toHaveBeenCalledWith("results");
    fireEvent.click(screen.getByTestId("bottom-__menu"));
    expect(await screen.findByText("Portal sections")).toBeTruthy();
  });
});
