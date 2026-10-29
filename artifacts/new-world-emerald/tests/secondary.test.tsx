import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PortalManagement, ReportWorkspace } from "@workspace/api-client-react";
import { ClassesPanel } from "../src/portal/manage/PeoplePanels";
import { ScoresEditor } from "../src/portal/reports/ScoresEditor";

const api = vi.hoisted(() => ({ manage: vi.fn(async () => ({ message: "ok" })) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useManagePortal: () => ({ mutateAsync: api.manage, isPending: false }),
  useManageReports: () => ({ mutateAsync: api.manage, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("adds the missing secondary classes, JSS 1 to SS 3, in one click", async () => {
  const data = { classes: [{ id: 1, name: "Primary 6" }, { id: 2, name: "jss1" }, { id: 3, name: "SS 2" }], students: [], teachers: [], exams: [], attempts: [], materials: [], notices: [] } as unknown as PortalManagement;
  render(wrap(<ClassesPanel data={data} />));
  expect(screen.getByTestId("button-add-secondary").textContent).toContain("(4)");
  fireEvent.click(screen.getByTestId("button-add-secondary"));
  await waitFor(() => expect(api.manage).toHaveBeenCalledTimes(4));
  expect(api.manage.mock.calls.map((c) => (c as unknown as [{ data: { schoolClass: { name: string } } }])[0].data.schoolClass.name)).toEqual(["JSS 2", "JSS 3", "SS 1", "SS 3"]);
});

it("a subject teacher enters scores only for their own subject; the others are view only", () => {
  const term = { id: 3, session: "2026/2027", term: "First Term", caMax: 40, examMax: 60, nextTermBegins: null };
  const ws = {
    terms: [term], classes: [{ id: 7, name: "SS 1" }], canAdmin: false, termId: 3, classId: 7,
    subjects: [{ id: 10, classId: 7, name: "Mathematics", sortOrder: 0, teacherId: 5 }, { id: 20, classId: 7, name: "English", sortOrder: 1, teacherId: null }],
    students: [{ id: 1, studentId: "NWE-1", name: "Ada Obi" }], scores: [], cards: [], results: [], subjectStats: [], ranked: 0, released: false,
    gradingScale: [{ min: 50, grade: "P", remark: "Pass" }, { min: 0, grade: "F", remark: "Fail" }], principalName: "", principalSignature: null, mySignature: null,
    workflow: { status: "draft", mode: "automatic", teacherName: "", teacherSignature: null, submittedAt: null, approvedBy: "", approvedAt: null, returnNote: "" },
    isClassTeacher: false, editableSubjectIds: [10], teachers: [],
  } as unknown as ReportWorkspace;
  render(wrap(<ScoresEditor ws={ws} term={term} locked={false} />));
  expect((screen.getByTestId("input-ca-1") as HTMLInputElement).disabled).toBe(false);
  fireEvent.click(screen.getByTestId("subject-tab-20"));
  expect(screen.getByTestId("subject-tab-20").textContent).toContain("view only");
  expect((screen.getByTestId("input-ca-1") as HTMLInputElement).disabled).toBe(true);
});
