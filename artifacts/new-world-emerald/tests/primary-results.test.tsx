import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReportWorkspace } from "@workspace/api-client-react";
import { reportCardsHtml } from "../src/portal/reports/reportCard";
import { ScoresEditor } from "../src/portal/reports/ScoresEditor";
import { Broadsheet, printableFor } from "../src/portal/reports/RemarksBroadsheet";
import { schemePossible, schemeTerm, schemeTotal } from "../src/portal/reports/scheme";

vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useManageReports: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => cleanup());

// The term is set up for secondary (CA 20 + CA 2 20 + exam 60); a primary class uses 100 and 100 instead.
const rawTerm = { id: 3, session: "2026/2027", term: "First Term", caMax: 20, ca2Max: 20, examMax: 60, nextTermBegins: "12 January 2027" };
const term = schemeTerm(rawTerm, "primary");
const scale = [{ min: 80, grade: "A", remark: "Excellent" }, { min: 65, grade: "B", remark: "Very good" }, { min: 55, grade: "C", remark: "Good" }, { min: 50, grade: "D", remark: "Pass" }, { min: 0, grade: "U", remark: "Ungraded" }];
const results = [
  { studentId: 1, subjects: [{ subjectId: 10, ca: 80, ca2: null, exam: 90, total: 85, percent: 85, grade: "A", remark: "Excellent", position: 0, comment: "Well done" }], total: 85, average: 85, grade: "A", position: null, subjectsTaken: 1 },
  { studentId: 2, subjects: [{ subjectId: 10, ca: 60, ca2: null, exam: 71, total: 65.5, percent: 65.5, grade: "B", remark: "Very good", position: 0, comment: "" }], total: 65.5, average: 65.5, grade: "B", position: null, subjectsTaken: 1 },
];
const ws = {
  scheme: "primary", terms: [rawTerm], classes: [{ id: 7, name: "Year 3" }], canAdmin: true, termId: 3, classId: 7,
  subjects: [{ id: 10, classId: 7, name: "Mathematics", sortOrder: 0, teacherId: null, teacherName: "Mrs Bisi" }],
  students: [{ id: 2, studentId: "NWE-2", name: "Zainab Bello" }, { id: 1, studentId: "NWE-1", name: "Ada Obi" }],
  scores: [{ studentId: 1, subjectId: 10, ca: 80, ca2: null, exam: 90, comment: "Well done", total: null, grade: null }],
  cards: [], results, subjectStats: [{ subjectId: 10, average: 75.3, highest: 85, lowest: 65.5, entries: 2 }], ranked: 2, released: false, gradingScale: scale,
  workflow: { status: "approved", mode: "automatic", teacherName: "Mrs Bisi", teacherSignature: null, submittedAt: null, approvedBy: "", approvedAt: null, returnNote: "" },
  principalName: "", principalSignature: null, cardPrincipalName: "Mrs Okafor", cardPrincipalSignature: null, mySignature: null, isClassTeacher: true, editableSubjectIds: null, teachers: [],
} as unknown as ReportWorkspace;

describe("primary results (Year 1 to 6)", () => {
  it("uses Mid-term and End-term out of 100 whatever the term's maxima, and averages them", () => {
    expect([term.caMax, term.ca2Max, term.examMax]).toEqual([100, 0, 100]);
    expect(schemeTerm(rawTerm, "secondary")).toBe(rawTerm);
    expect(schemePossible(rawTerm, "primary")).toBe(100);
    expect(schemePossible(rawTerm, "secondary")).toBe(100);
    expect(schemeTotal("primary", 60, null, 71)).toBe(65.5);
    expect(schemeTotal("secondary", 15, 18, 50)).toBe(83);
  });

  it("enters Mid-term and End-term marks and shows the final score as their average", () => {
    render(wrap(<ScoresEditor ws={ws} term={term} locked={false} />));
    expect(screen.getByText("First Half Term /100")).toBeTruthy();
    expect(screen.getByText("Second Half Term /100")).toBeTruthy();
    expect(screen.getByText("Final /100")).toBeTruthy();
    expect(screen.queryByText(/CA 2/)).toBeNull();
    const ada = screen.getByTestId("score-row-1");
    expect(within(ada).getByText("85")).toBeTruthy();
    fireEvent.change(screen.getByTestId("input-ca-2"), { target: { value: "60" } });
    fireEvent.change(screen.getByTestId("input-exam-2"), { target: { value: "71" } });
    expect(within(screen.getByTestId("score-row-2")).getByText("65.5")).toBeTruthy();
    // 95 is allowed for primary even though the term's CA is out of 20.
    fireEvent.change(screen.getByTestId("input-ca-2"), { target: { value: "95" } });
    expect(screen.getByTestId("input-ca-2").getAttribute("aria-invalid")).toBe("false");
  });

  it("prints a primary card: Mid-term, End-term, final, percentage and average, and no position", () => {
    const html = reportCardsHtml(printableFor(ws, rawTerm, "Year 3"));
    expect(html).toContain('class="card primary"');
    expect(html).toContain("FIRST HALF TERM");
    expect(html).toContain("SECOND HALF TERM");
    expect(html).toContain("FINAL SCORE");
    expect(html).toContain("Final score = (First Half Term + Second Half Term) &divide; 2");
    expect(html).toContain("Primary section &middot; Year 1 to Year 6");
    expect(html).toMatch(/<span>Percentage<\/span><b>85%<\/b>/);
    expect(html).toMatch(/<span>Average<\/span><b>85<\/b>/);
    expect(html).not.toMatch(/CA 1|EXAM<br>|>HC<|Position|1st/);
  });

  it("keeps the secondary card as it was", () => {
    const html = reportCardsHtml(printableFor({ ...ws, scheme: "secondary" } as ReportWorkspace, rawTerm, "JSS 1"));
    expect(html).not.toContain("card primary");
    expect(html).toContain("CA 1");
    expect(html).toContain("SUB.AVE");
  });

  it("lists the primary broadsheet by name with no position column", () => {
    render(wrap(<Broadsheet ws={ws} term={term} className="Year 3" />));
    const table = screen.getByTestId("table-broadsheet");
    expect(within(table).queryByText("Pos.")).toBeNull();
    const names = within(table).getAllByText(/Ada Obi|Zainab Bello/).map((n) => n.textContent);
    expect(names).toEqual(["Ada Obi", "Zainab Bello"]);
    expect(screen.getByText(/Final scores are \(First Half Term \+ Second Half Term\) ÷ 2/)).toBeTruthy();
  });
});
