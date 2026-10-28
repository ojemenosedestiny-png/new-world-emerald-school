import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReportWorkspace, StudentReports as StudentReportsData } from "@workspace/api-client-react";
import { getGetStudentReportsQueryKey } from "@workspace/api-client-react";
import { ordinal, reportCardsHtml } from "../src/portal/reports/reportCard";
import { parseScoreCsv, parseScorePart, previewGrade, suggestedRemarks } from "../src/portal/reports/scoreSheet";
import { ScoresEditor } from "../src/portal/reports/ScoresEditor";
import { StudentReports } from "../src/portal/reports/StudentReports";
import { clearStudentQueries } from "../src/portal/lib";

const mocks = vi.hoisted(() => ({ manage: vi.fn(), reports: { data: undefined as unknown, isLoading: false, isError: false } }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useManageReports: () => ({ mutateAsync: mocks.manage, isPending: false }),
  useGetStudentReports: () => ({ ...mocks.reports, refetch: vi.fn() }),
}));

function wrap(children: ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const term = { id: 3, session: "2026/2027", term: "First Term", caMax: 40, examMax: 60, nextTermBegins: "12 January 2027" };
const workspace = {
  terms: [term], classes: [{ id: 7, name: "JSS 1" }], canAdmin: true, termId: 3, classId: 7,
  subjects: [{ id: 10, classId: 7, name: "Mathematics", sortOrder: 0 }, { id: 20, classId: 7, name: "English", sortOrder: 1 }],
  students: [{ id: 1, studentId: "NWE-1", name: "Ada Obi" }, { id: 2, studentId: "NWE-2", name: "Bayo Ade" }],
  scores: [{ studentId: 1, subjectId: 10, ca: 35, exam: 50 }],
  cards: [], results: [], subjectStats: [], ranked: 1, released: false,
  gradingScale: [{ min: 70, grade: "A", remark: "Excellent" }, { min: 60, grade: "B", remark: "Very good" }, { min: 50, grade: "C", remark: "Good" }, { min: 45, grade: "D", remark: "Fair" }, { min: 40, grade: "E", remark: "Pass" }, { min: 0, grade: "F", remark: "Fail" }],
  workflow: { status: "draft", mode: "automatic", teacherName: "", teacherSignature: null, submittedAt: null, approvedBy: "", approvedAt: null, returnNote: "" },
  principalName: "", principalSignature: null, mySignature: null,
} as unknown as ReportWorkspace;

describe("report card helpers", () => {
  it("writes positions as ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th", "112th"]);
  });
  it("previews the same grade boundaries the server uses", () => {
    expect([100, 70, 69.9, 60, 50, 49, 45, 44, 40, 39.9, 0].map(previewGrade)).toEqual(["A", "A", "B", "B", "C", "D", "D", "E", "E", "F", "F"]);
  });
  it("validates score parts", () => {
    expect(parseScorePart("", 40)).toEqual({ value: null });
    expect(parseScorePart(" 12.5 ", 40)).toEqual({ value: 12.5 });
    expect(parseScorePart("41", 40).error).toBe("0 to 40");
    expect(parseScorePart("12.3", 40).error).toBe("Use whole or half marks");
    expect(parseScorePart("abc", 40).error).toBe("Not a number");
  });
  it("imports scores by student ID and explains rejected lines", () => {
    const rows = parseScoreCsv("Student ID, CA, Exam\nnwe-1, 32, 51\nNWE-2\t20\t70\nNWE-9, 10, 10\nNWE-1, 1, 1\nNWE-2, , ", workspace.students, term);
    expect(rows.map((r) => [r.studentId, r.ca, r.exam, r.error ?? "ok"])).toEqual([
      ["NWE-1", 32, 51, "ok"], ["NWE-2", 20, null, "Exam: 0 to 60"], ["NWE-9", 10, 10, "Student ID not in this class"],
      ["NWE-1", 1, 1, "Student listed twice"], ["NWE-2", null, null, "Student listed twice"],
    ]);
  });
  it("suggests remarks that match the result band", () => {
    expect(suggestedRemarks(null)).toEqual([]);
    expect(suggestedRemarks(82)[0]).toMatch(/excellent/i);
    expect(suggestedRemarks(30)[0]).toMatch(/below expectation/i);
  });
  it("builds an escaped, complete printable report card", () => {
    const html = reportCardsHtml([{
      studentName: "<b>Ada</b>", studentId: "NWE-1", className: "JSS 1", term, subjects: workspace.subjects,
      result: { studentId: 1, subjects: [{ subjectId: 10, ca: 35, exam: 50, total: 85, percent: 85, grade: "A", remark: "Excellent", position: 1 }], total: 85, average: 85, grade: "A", position: 2, subjectsTaken: 1 },
      subjectStats: [{ subjectId: 10, average: 70, highest: 85, lowest: 55, entries: 3 }], classSize: 30,
      card: { studentId: 1, teacherRemark: "Brilliant & focused", principalRemark: "<script>x</script>", daysPresent: 58, daysOpen: 60 },
    }]);
    expect(html).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("Brilliant &amp; focused");
    expect(html).toContain("2nd of 30");
    expect(html).toContain("58 of 60 days");
    expect(html).toContain("Next term begins: <b>12 January 2027</b>");
    expect(html).toContain("Mathematics");
  });
  it("forgets cached report cards when a different student signs in", async () => {
    const client = new QueryClient();
    client.setQueryData(getGetStudentReportsQueryKey(), { studentName: "Previous student" });
    await clearStudentQueries(client);
    expect(client.getQueryData(getGetStudentReportsQueryKey())).toBeUndefined();
  });
});

describe("staff score entry", () => {
  it("saves only changed rows and blocks invalid scores", async () => {
    mocks.manage.mockResolvedValue({ message: "Saved successfully." });
    render(wrap(<ScoresEditor ws={workspace} term={term} locked={false} />));
    const save = screen.getByTestId("button-save-scores") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-ca-2"), { target: { value: "45" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-ca-2"), { target: { value: "20" } });
    fireEvent.change(screen.getByTestId("input-exam-2"), { target: { value: "30.5" } });
    expect(screen.getByTestId("score-row-2").textContent).toContain("50.5");
    fireEvent.click(save);
    await waitFor(() => expect(mocks.manage).toHaveBeenCalledWith({ data: { action: "saveScores", scores: { termId: 3, entries: [{ studentId: 2, subjectId: 10, ca: 20, exam: 30.5, total: null, grade: null }] } } }));
  });
  it("locks inputs once results are released", () => {
    render(wrap(<ScoresEditor ws={workspace} term={term} locked />));
    expect((screen.getByTestId("input-ca-1") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId("button-import-scores") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("student report cards", () => {
  it("explains when nothing has been released", () => {
    mocks.reports = { data: { studentName: "Ada", studentId: "NWE-1", className: "JSS 1", reports: [] } satisfies StudentReportsData, isLoading: false, isError: false };
    render(wrap(<StudentReports />));
    expect(screen.getByText("No report cards yet")).toBeTruthy();
  });
  it("shows the latest released term with grades, positions and remarks", () => {
    mocks.reports = {
      data: {
        studentName: "Ada", studentId: "NWE-1", className: "JSS 1",
        reports: [{
          term, subjects: workspace.subjects, classSize: 30, releasedAt: new Date().toISOString(),
          result: { studentId: 1, subjects: [{ subjectId: 10, ca: 35, exam: 50, total: 85, percent: 85, grade: "A", remark: "Excellent", position: 1 }], total: 85, average: 85, grade: "A", position: 2, subjectsTaken: 1 },
          subjectStats: [{ subjectId: 10, average: 70, highest: 85, lowest: 55, entries: 3 }],
          card: { studentId: 1, teacherRemark: "A focused pupil.", principalRemark: "Well done.", daysPresent: 58, daysOpen: 60 },
        }],
      } satisfies StudentReportsData, isLoading: false, isError: false,
    };
    render(wrap(<StudentReports />));
    const card = screen.getByTestId("report-term-3");
    expect(card.textContent).toContain("2nd of 30");
    expect(card.textContent).toContain("Mathematics");
    expect(card.textContent).toContain("A focused pupil.");
    expect(card.textContent).toContain("12 January 2027");
    expect(screen.getByTestId("button-print-report-3")).toBeTruthy();
  });
});
