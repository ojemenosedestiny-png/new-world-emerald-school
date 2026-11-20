import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ExamOfficerExam, ExamOfficerOverview, PortalManagement } from "@workspace/api-client-react";
import { examFolder, examFolders } from "../src/portal/lib";
import { ExamsPanel } from "../src/portal/manage/ExamsPanel";
import { AllExamsView } from "../src/portal/exam-officer/OfficerViews";

vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useManagePortal: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRecordExamAccess: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => cleanup());

it("files every arm of a year in one folder, in school order", () => {
  expect(["JSS 1A", "JSS 1 B", "JSS1C", "jss 1 gold"].map((n) => examFolder(n).key)).toEqual(["jss-1", "jss-1", "jss-1", "jss-1"]);
  expect(examFolder("Year 3 Gold").label).toBe("Year 3");
  const names: Record<number, string> = { 1: "SS 2A", 2: "Year 10", 3: "JSS 1A", 4: "Year 2", 5: "JSS 1B", 6: "Nursery 1", 7: "Year 1", 8: "Clubs", 9: "SS 1" };
  const at = new Date(Date.now() + 86_400_000).toISOString(), to = new Date(Date.now() + 90_000_000).toISOString();
  const exams = Object.keys(names).map((k) => ({ classId: Number(k), startsAt: at, endsAt: to }));
  const folders = examFolders(exams, (id) => names[id]);
  expect(folders.map((f) => f.label)).toEqual(["Nursery 1", "Year 1", "Year 2", "Year 10", "JSS 1", "SS 1", "SS 2", "Clubs"]);
  expect(folders.find((f) => f.key === "jss-1")).toMatchObject({ arms: ["JSS 1A", "JSS 1B"], upcoming: 2 });
});

const classes = [{ id: 1, name: "Year 1A" }, { id: 2, name: "Year 1B" }, { id: 3, name: "Year 2A" }, { id: 4, name: "JSS 1A" }];
const exam = (id: number, classId: number, title: string, hours: number) => ({
  id, title, subject: "Maths", classId, durationMinutes: 30, mode: "interactive", fileId: null, instructions: "", published: true, resultsReleased: false,
  startsAt: new Date(Date.now() + hours * 3_600_000).toISOString(), endsAt: new Date(Date.now() + (hours + 2) * 3_600_000).toISOString(),
  questions: [{ id: "q1", type: "mcq", text: "?", options: ["a", "b"], correctAnswer: 0, marks: 1 }], reviewStatus: "approved",
});

it("opens one year's folder on the exams page, still in date and time order", () => {
  const data = { classes, examClasses: classes, students: [], teachers: [], attempts: [], materials: [], notices: [],
    exams: [exam(1, 3, "Year 2 Science", 30), exam(2, 1, "Year 1 Maths B", 50), exam(3, 2, "Year 1 Maths A", 26), exam(4, 4, "JSS 1 English", 28)] } as unknown as PortalManagement;
  render(wrap(<ExamsPanel data={data} />));
  const shelf = screen.getByTestId("exam-folders");
  expect(within(shelf).getAllByRole("button").map((b) => b.getAttribute("data-testid"))).toEqual(["folder-all", "folder-year-1", "folder-year-2", "folder-jss-1"]);
  expect(screen.getByTestId("folder-year-1").textContent).toContain("Year 1A · Year 1B");
  expect(screen.getByTestId("folder-all").getAttribute("aria-pressed")).toBe("true");
  expect(screen.getAllByTestId(/^card-exam-/)).toHaveLength(4);

  fireEvent.click(screen.getByTestId("folder-year-1"));
  expect(screen.getByTestId("folder-year-1").getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByTestId("exam-folder-heading").textContent).toContain("Year 1 exams");
  expect(screen.getAllByTestId(/^card-exam-/).map((c) => c.getAttribute("data-testid"))).toEqual(["card-exam-3", "card-exam-2"]);
  fireEvent.click(screen.getByTestId("folder-all"));
  expect(screen.getAllByTestId(/^card-exam-/)).toHaveLength(4);
});

it("lets the exam officer pick one year", () => {
  const officerExam = (id: number, className: string): ExamOfficerExam => ({
    id, title: `Exam ${id}`, subject: "Maths", classId: id, className, section: "secondary", setBy: "", startsAt: new Date(Date.now() + id * 3_600_000).toISOString(), endsAt: new Date(Date.now() + 99 * 3_600_000).toISOString(),
    durationMinutes: 30, mode: "interactive", questionCount: 1, totalMarks: 1, status: "awaiting", reviewNote: "", submittedBy: "", submittedAt: null, reviewedBy: "", reviewedAt: null, students: 0, sat: 0, marked: 0, opened: 0,
  });
  const data: ExamOfficerOverview = { configured: true, today: "2026-11-20", term: "2026-1", terms: [{ key: "2026-1", label: "Autumn Term", count: 3 }], sections: [],
    exams: [officerExam(1, "SS 1A"), officerExam(2, "JSS 2A"), officerExam(3, "JSS 2B")] };
  render(wrap(<AllExamsView data={data} onTerm={() => {}} onView={() => {}} />));
  const select = screen.getByTestId("select-officer-year") as HTMLSelectElement;
  expect([...select.options].map((o) => o.textContent)).toEqual(["All years", "JSS 2 (2)", "SS 1 (1)"]);
  fireEvent.change(select, { target: { value: "jss-2" } });
  expect(screen.queryByTestId("officer-exam-1")).toBeNull();
  expect(screen.getByTestId("officer-exam-2")).toBeTruthy();
  expect(screen.getByTestId("officer-exam-3")).toBeTruthy();
});
