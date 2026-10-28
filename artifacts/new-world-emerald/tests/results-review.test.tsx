import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PortalExam, ReportWorkspace } from "@workspace/api-client-react";
import { ResultsReviewBody } from "../src/portal/reports/ResultsReview";
import { ExamEditor, blankExam } from "../src/portal/manage/ExamEditor";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(cleanup);

const term = { id: 3, session: "2026/2027", term: "First Term", caMax: 40, examMax: 60, nextTermBegins: null };
const scale = [{ min: 70, grade: "A", remark: "Excellent" }, { min: 40, grade: "C", remark: "Pass" }, { min: 0, grade: "F", remark: "Fail" }];
const result = (studentId: number, total: number, position: number) => ({
  studentId, total, average: total, grade: total >= 70 ? "A" : total >= 40 ? "C" : "F", position, subjectsTaken: 1,
  subjects: [{ subjectId: 10, ca: 30, exam: total - 30, total, percent: total, grade: total >= 70 ? "A" : "C", remark: "", position }],
});
const ws = {
  terms: [term], classes: [{ id: 7, name: "JSS 2" }], canAdmin: true, termId: 3, classId: 7,
  subjects: [{ id: 10, classId: 7, name: "Mathematics", sortOrder: 0 }],
  students: [{ id: 1, studentId: "NWE-1", name: "Ada Obi" }, { id: 2, studentId: "NWE-2", name: "Bayo Ade" }, { id: 3, studentId: "NWE-3", name: "Chi Eze" }],
  scores: [], cards: [], results: [result(2, 64, 2), result(1, 85, 1), result(3, 30, 3)], ranked: 3, released: false,
  subjectStats: [{ subjectId: 10, average: 59.7, highest: 85, lowest: 30, entries: 3 }],
  gradingScale: scale, principalName: "Mrs P.", principalSignature: null, mySignature: null,
  workflow: { status: "review", mode: "automatic", teacherName: "Mr T.", teacherSignature: null, submittedAt: null, approvedBy: "", approvedAt: null, returnNote: "" },
} as unknown as ReportWorkspace;

it("reviews a class's totals, ranking and grades, and previews each student's result as it prints", () => {
  render(wrap(<ResultsReviewBody ws={ws} term={term} className="JSS 2" />));
  expect(screen.getByTestId("review-average").textContent).toContain("59.7%");
  expect(screen.getByTestId("review-highest").textContent).toContain("Ada Obi");
  expect(screen.getByTestId("review-passed").textContent).toContain("67%");
  expect(screen.getByTestId("review-passed").textContent).toContain("2 of 3, 40% and above");
  const rows = screen.getAllByTestId(/^review-row-/).map((r) => r.textContent);
  expect(rows[0]).toContain("1st"); expect(rows[0]).toContain("Ada Obi"); expect(rows[0]).toContain("85");
  expect(rows[2]).toContain("Chi Eze");
  expect(screen.getByTestId("list-review-grades").textContent).toMatch(/A.*1.*C.*1.*F.*1/);
  expect((screen.getByTestId("frame-result-preview") as HTMLIFrameElement).srcdoc).toContain("Ada Obi");
  expect(screen.getByTestId("frame-result-preview").getAttribute("sandbox")).toBe("");
  fireEvent.click(screen.getByTestId("review-row-3"));
  expect((screen.getByTestId("frame-result-preview") as HTMLIFrameElement).srcdoc).toContain("Chi Eze");
});

it("new exams show each student's result as soon as it is marked unless the teacher unticks it", () => {
  const data = { classes: [{ id: 1, name: "JSS 1" }], students: [], teachers: [], exams: [], attempts: [], materials: [], notices: [] };
  render(wrap(<ExamEditor data={data as never} initial={{ ...blankExam(1) } as PortalExam} onClose={() => {}} />));
  expect((screen.getByTestId("checkbox-instant-results") as HTMLInputElement).checked).toBe(true);
});
