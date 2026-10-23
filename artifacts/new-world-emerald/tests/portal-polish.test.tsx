import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortalExam, PortalManagement } from "@workspace/api-client-react";
import { sortStudentExams } from "../src/portal/lib";
import { QuestionNavigator, unansweredNumbers } from "../src/portal/exam/QuestionNavigator";
import { loginSlipsHtml, loginsCsv, parseEnrolList } from "../src/portal/manage/enrol";
import { BulkEnrol } from "../src/portal/manage/BulkEnrol";
import { overviewCounts } from "../src/portal/manage/Overview";
import { duplicateExam } from "../src/portal/manage/ExamsPanel";

const mocks = vi.hoisted(() => ({ manage: vi.fn() }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useManagePortal: () => ({ mutateAsync: mocks.manage, isPending: false }),
}));

const now = Date.UTC(2026, 9, 23, 12);
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("student exam list and navigation", () => {
  it("orders exams: writing, open, upcoming, submitted, closed", () => {
    const exams = [
      { id: 1, startsAt: at(-600), endsAt: at(-500) },  // closed
      { id: 2, startsAt: at(60), endsAt: at(120) },     // upcoming later
      { id: 3, startsAt: at(-30), endsAt: at(90) },     // open, closes later
      { id: 4, startsAt: at(-30), endsAt: at(30) },     // open, closes sooner
      { id: 5, startsAt: at(10), endsAt: at(70) },      // upcoming sooner
      { id: 6, startsAt: at(-60), endsAt: at(60) },     // in progress
      { id: 7, startsAt: at(-90), endsAt: at(60) },     // submitted
    ];
    const attempts = [{ examId: 6, status: "in_progress" }, { examId: 7, status: "submitted" }];
    expect(sortStudentExams(exams, attempts, now).map((e) => e.id)).toEqual([6, 4, 3, 5, 2, 7, 1]);
  });
  it("marks answered questions and jumps to a question", () => {
    const scroll = vi.fn();
    const target = document.createElement("section");
    target.id = "question-b";
    target.scrollIntoView = scroll;
    document.body.appendChild(target);
    const onJump = vi.fn();
    const questions = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const answers = { a: "1", b: "   ", c: "An answer" };
    render(<QuestionNavigator questions={questions} answers={answers} onJump={onJump} />);
    expect(screen.getByTestId("nav-question-1").getAttribute("aria-label")).toBe("Question 1, answered");
    expect(screen.getByTestId("nav-question-2").getAttribute("aria-label")).toBe("Question 2, not answered");
    fireEvent.click(screen.getByTestId("nav-question-2"));
    expect(onJump).toHaveBeenCalled();
    expect(scroll).toHaveBeenCalled();
    expect(unansweredNumbers(questions, answers)).toEqual([{ id: "b", number: 2 }]);
    target.remove();
  });
});

describe("bulk enrolment", () => {
  it("parses spreadsheet and CSV lines and explains every rejected line", () => {
    const rows = parseEnrolList([
      "Student ID,Full name",
      "nwe/2026/001, Adaeze  Okafor",
      "NWE/2026/002\tTunde Bello",
      '"NWE/2026/003","Ngozi ""Ada"" Eze"',
      "",
      "bad id!, Someone",
      "NWE/2026/004",
      "NWE/2026/001, Duplicate Person",
      "OLD-1, Already Here",
    ].join("\n"), ["old-1"]);
    expect(rows.map((r) => [r.line, r.studentId, r.name, r.error ?? "ok"])).toEqual([
      [2, "NWE/2026/001", "Adaeze Okafor", "ok"],
      [3, "NWE/2026/002", "Tunde Bello", "ok"],
      [4, "NWE/2026/003", 'Ngozi "Ada" Eze', "ok"],
      [6, "BAD ID!", "Someone", "ID may use only letters, numbers, - / _"],
      [7, "NWE/2026/004", "", "Missing name"],
      [8, "NWE/2026/001", "Duplicate Person", "ID repeated in this list"],
      [9, "OLD-1", "Already Here", "ID already enrolled"],
    ]);
  });
  it("escapes login exports for spreadsheets and the print sheet", () => {
    const logins = [{ studentId: "S-1", name: "=HYPERLINK(\"x\")", className: "JSS 1", password: "Abc-123!xyz" }];
    expect(loginsCsv(logins)).toContain(`S-1,"'=HYPERLINK(""x"")",JSS 1,Abc-123!xyz`);
    const html = loginSlipsHtml([{ ...logins[0], name: "<script>alert(1)</script>" }], "https://school.example/portal");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Abc-123!xyz");
  });
  it("enrols each valid student with its own password and reports failures", async () => {
    mocks.manage.mockImplementation(async ({ data }: { data: { student: { studentId: string } } }) => {
      if (data.student.studentId === "NWE-2") throw new Error("That student ID, email address or class name already exists.");
      return { message: "Saved successfully." };
    });
    const data = { classes: [{ id: 7, name: "JSS 1" }], students: [], teachers: [], exams: [], attempts: [], materials: [], notices: [] } as unknown as PortalManagement;
    render(wrap(<BulkEnrol data={data} onClose={() => {}} />));
    fireEvent.change(screen.getByTestId("input-bulk-list"), { target: { value: "NWE-1, Ada Obi\nNWE-2, Bayo Ade\nbad id, Nope" } });
    expect(screen.getByTestId("text-bulk-summary").textContent).toContain("2 ready");
    fireEvent.click(screen.getByTestId("button-run-bulk"));
    await waitFor(() => expect(screen.getByTestId("text-bulk-enrolled").textContent).toBe("1"));
    expect(mocks.manage).toHaveBeenCalledTimes(2);
    const sent = mocks.manage.mock.calls.map(([arg]) => arg.data.student);
    expect(sent.map((s: { studentId: string; classId: number; active: boolean }) => [s.studentId, s.classId, s.active])).toEqual([["NWE-1", 7, true], ["NWE-2", 7, true]]);
    expect(sent[0].password).not.toBe(sent[1].password);
    expect(sent[0].password.length).toBeGreaterThanOrEqual(16);
    expect(screen.getByText(/already exists/)).toBeTruthy();
    expect(screen.getByTestId("button-print-slips")).toBeTruthy();
  });
});

describe("staff overview and exam reuse", () => {
  it("counts active students, open exams, live writers and scripts to mark", () => {
    const data = {
      classes: [], teachers: [], materials: [], notices: [],
      students: [{ active: true }, { active: true }, { active: false }],
      exams: [
        { published: true, startsAt: at(-10), endsAt: at(50) },
        { published: false, startsAt: at(-10), endsAt: at(50) },
        { published: true, startsAt: at(60), endsAt: at(120) },
      ],
      attempts: [
        { status: "in_progress", deadline: at(20) },
        { status: "in_progress", deadline: at(-1) },
        { status: "submitted", deadline: at(-5) },
        { status: "marked", deadline: at(-5) },
      ],
    } as unknown as PortalManagement;
    expect(overviewCounts(data, now)).toEqual({ students: 2, openExams: 1, writing: 1, toMark: 1 });
  });
  it("duplicates an exam as a fresh unpublished draft with independent questions", () => {
    const exam: PortalExam = {
      id: 9, title: "Mid-term Maths", subject: "Maths", classId: 7, durationMinutes: 40, startsAt: at(-120), endsAt: at(-60),
      mode: "interactive", fileId: null, instructions: "Answer all", published: true, resultsReleased: true,
      questions: [{ id: "q1", type: "mcq", text: "2 + 2?", options: ["3", "4"], correctAnswer: 1, marks: 2 }],
    };
    const copy = duplicateExam(exam);
    expect(copy.id).toBeUndefined();
    expect(copy).toMatchObject({ title: "Mid-term Maths (copy)", published: false, resultsReleased: false, classId: 7, durationMinutes: 40, instructions: "Answer all" });
    expect(new Date(copy.startsAt).getTime()).toBeGreaterThan(Date.now());
    copy.questions[0].options[0] = "changed";
    expect(exam.questions[0].options[0]).toBe("3");
  });
});
