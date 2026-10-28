import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReportWorkspace } from "@workspace/api-client-react";
import { WorkflowBar, resultsLocked } from "../src/portal/reports/ResultWorkflow";
import { ResultSettings } from "../src/portal/reports/ResultSettings";
import { ScoresEditor } from "../src/portal/reports/ScoresEditor";
import { reportCardsHtml, scaleKey } from "../src/portal/reports/reportCard";

const mocks = vi.hoisted(() => ({ manage: vi.fn(async () => ({ message: "ok" })) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useManageReports: () => ({ mutateAsync: mocks.manage, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const term = { id: 3, session: "2026/2027", term: "First Term", caMax: 40, examMax: 60, nextTermBegins: null };
const SIG = "data:image/png;base64,iVBORw0KGgo=";
const scale = [{ min: 75, grade: "A1", remark: "Excellent" }, { min: 50, grade: "C4", remark: "Credit" }, { min: 0, grade: "F9", remark: "Fail" }];
const ws = (over: Partial<ReportWorkspace> = {}, workflow: Partial<ReportWorkspace["workflow"]> = {}) => ({
  terms: [term], classes: [{ id: 7, name: "SS 1" }], canAdmin: false, termId: 3, classId: 7,
  subjects: [{ id: 10, classId: 7, name: "Mathematics", sortOrder: 0 }], students: [{ id: 1, studentId: "NWE-1", name: "Ada Obi" }],
  scores: [{ studentId: 1, subjectId: 10, ca: 30, exam: 30, total: null, grade: null }], cards: [], results: [], subjectStats: [], ranked: 1, released: false,
  gradingScale: scale, principalName: "Mrs P. Principal", principalSignature: SIG, mySignature: SIG,
  workflow: { status: "draft", mode: "automatic", teacherName: "", teacherSignature: null, submittedAt: null, approvedBy: "", approvedAt: null, returnNote: "", ...workflow },
  ...over,
}) as ReportWorkspace;

describe("result workflow", () => {
  it("a teacher signs and sends a draft; the office approves, publishes and returns", async () => {
    render(wrap(<WorkflowBar ws={ws()} term={term} className="SS 1" missing={0} onOpenSettings={() => {}} />));
    expect(screen.getByTestId("workflow-step-draft").getAttribute("aria-current")).toBe("step");
    fireEvent.click(screen.getByTestId("button-workflow-submit"));
    fireEvent.click(screen.getByTestId("button-confirm-workflow"));
    await waitFor(() => expect(mocks.manage).toHaveBeenCalledWith({ data: { action: "workflow", workflow: { termId: 3, classId: 7, action: "submit" } } }));
    cleanup();

    render(wrap(<WorkflowBar ws={ws({}, { status: "review" })} term={term} className="SS 1" missing={0} onOpenSettings={() => {}} />));
    expect(screen.queryByTestId("button-workflow-approve")).toBeNull();
    expect(screen.getByTestId("button-workflow-withdraw")).toBeTruthy();
    cleanup();

    render(wrap(<WorkflowBar ws={ws({ canAdmin: true }, { status: "review", teacherName: "Mr Bayo" })} term={term} className="SS 1" missing={0} onOpenSettings={() => {}} />));
    expect(screen.getByTestId("bar-workflow").textContent).toContain("Signed by Mr Bayo");
    fireEvent.click(screen.getByTestId("button-workflow-return"));
    fireEvent.change(screen.getByTestId("input-return-note"), { target: { value: "Check Maths" } });
    fireEvent.click(screen.getByTestId("button-confirm-workflow"));
    await waitFor(() => expect(mocks.manage).toHaveBeenLastCalledWith({ data: { action: "workflow", workflow: { termId: 3, classId: 7, action: "return", note: "Check Maths" } } }));
    cleanup();

    render(wrap(<WorkflowBar ws={ws({ canAdmin: true }, { status: "approved" })} term={term} className="SS 1" missing={0} onOpenSettings={() => {}} />));
    expect(screen.getByTestId("button-workflow-publish")).toBeTruthy();
  });

  it("a teacher without a signature is sent to add one first, and returned results show the note", () => {
    const open = vi.fn();
    render(wrap(<WorkflowBar ws={ws({ mySignature: null }, { returnNote: "Add remarks" })} term={term} className="SS 1" missing={2} onOpenSettings={open} />));
    expect(screen.getByTestId("text-return-note").textContent).toContain("Add remarks");
    fireEvent.click(screen.getByTestId("button-workflow-submit"));
    expect(open).toHaveBeenCalled();
  });

  it("editing locks after review for teachers, and after approval for everyone", () => {
    expect(resultsLocked(ws())).toBe(false);
    expect(resultsLocked(ws({}, { status: "review" }))).toBe(true);
    expect(resultsLocked(ws({ canAdmin: true }, { status: "review" }))).toBe(false);
    expect(resultsLocked(ws({ canAdmin: true }, { status: "approved" }))).toBe(true);
  });
});

describe("manual results and settings", () => {
  it("manual mode lets the teacher type a total and a grade from the scale", async () => {
    render(wrap(<ScoresEditor ws={ws({}, { mode: "manual" })} term={term} locked={false} />));
    fireEvent.change(screen.getByTestId("input-total-1"), { target: { value: "82" } });
    fireEvent.change(screen.getByTestId("input-grade-1"), { target: { value: "zz" } });
    expect((screen.getByTestId("button-save-scores") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-grade-1"), { target: { value: "a1" } });
    fireEvent.click(screen.getByTestId("button-save-scores"));
    await waitFor(() => expect(mocks.manage).toHaveBeenCalledWith({ data: { action: "saveScores", scores: { termId: 3, entries: [{ studentId: 1, subjectId: 10, ca: 30, exam: 30, total: 82, grade: "A1" }] } } }));
  });

  it("the office edits the grading scale and principal; a teacher only sees their signature", async () => {
    render(wrap(<ResultSettings ws={ws({ canAdmin: true })} />));
    fireEvent.change(screen.getByTestId("scale-min-1"), { target: { value: "90" } });
    expect(screen.getByTestId("panel-grading-scale").textContent).toContain("must go down");
    expect((screen.getByTestId("button-save-result-settings") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("scale-min-1"), { target: { value: "55" } });
    fireEvent.click(screen.getByTestId("button-save-result-settings"));
    await waitFor(() => expect(mocks.manage).toHaveBeenCalledWith({ data: { action: "saveSettings", settings: { gradingScale: [scale[0], { ...scale[1], min: 55 }, scale[2]], principalName: "Mrs P. Principal", principalSignature: SIG } } }));
    cleanup();
    render(wrap(<ResultSettings ws={ws()} />));
    expect(screen.getByTestId("panel-my-signature")).toBeTruthy();
    expect(screen.queryByTestId("panel-grading-scale")).toBeNull();
  });

  it("the printed result shows both signatures, names and the school's own grade key", () => {
    expect(scaleKey(scale).map((k) => k.range)).toEqual(["75 - 100", "50 - 74", "0 - 49"]);
    const html = reportCardsHtml([{
      studentName: "Ada Obi", studentId: "NWE-1", className: "SS 1", term, subjects: [{ id: 10, classId: 7, name: "Mathematics", sortOrder: 0 }],
      result: { studentId: 1, subjects: [], total: 0, average: null, grade: null, position: null, subjectsTaken: 0 }, subjectStats: [], classSize: 1, card: null,
      gradingScale: scale, teacherName: "Mr Bayo", teacherSignature: SIG, principalName: "Mrs P. Principal", principalSignature: "javascript:alert(1)",
    }]);
    expect(html).toContain(`<img class="sigimg" src="${SIG}"`);
    expect(html).toContain("Mr Bayo");
    expect(html).toContain("Mrs P. Principal");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<b>A1</b> 75 - 100");
  });
});
