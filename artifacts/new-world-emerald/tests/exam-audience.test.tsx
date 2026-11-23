import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PortalManagement } from "@workspace/api-client-react";
import { ExamsPanel } from "../src/portal/manage/ExamsPanel";

const api = vi.hoisted(() => ({ run: vi.fn(async () => true) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useImportPortalPdf: () => ({ isPending: false, mutate: vi.fn() }),
  useRecordExamAccess: () => ({ mutate: vi.fn() }),
  useListClassStudents: (classId: number) => ({ isLoading: false, isError: false, data: classId === 8 ? [
    { id: 81, name: "Adaeze Okafor", studentId: "NW/SEC/26/00081" }, { id: 82, name: "Bolu Adeyemi", studentId: "NW/SEC/26/00082" }, { id: 83, name: "Chinedu Eze", studentId: "NW/SEC/26/00083" },
  ] : [] }),
}));
vi.mock("../src/portal/manage/useCommand", async (original) => ({ ...await original<typeof import("../src/portal/manage/useCommand")>(), useCommand: () => ({ run: api.run, pending: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const classes = [{ id: 8, name: "Year 8 Gold" }, { id: 9, name: "Year 8 Ruby" }];
const exam = {
  id: 50, title: "Year 8 Maths", subject: "Maths", classId: 8, durationMinutes: 40, mode: "interactive", fileId: null, instructions: "", published: true, resultsReleased: false, reviewStatus: "approved",
  startsAt: new Date(Date.now() - 86_400_000).toISOString(), endsAt: new Date(Date.now() - 80_000_000).toISOString(),
  questions: [{ id: "q1", type: "mcq", text: "2 + 2?", options: ["3", "4"], correctAnswer: 1, marks: 1 }],
};
const data = { classes, examClasses: classes, students: [], teachers: [], attempts: [], materials: [], notices: [], exams: [exam] } as unknown as PortalManagement;

it("copies an exam for one child: search their name in the class and only they get it", async () => {
  render(wrap(<ExamsPanel data={data} />));
  fireEvent.click(screen.getByTestId("button-duplicate-student-50"));
  expect(screen.getByTestId("audience-particular").getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByTestId("fieldset-also-classes")).toBeNull();
  fireEvent.change(screen.getByTestId("input-audience-search"), { target: { value: "chin" } });
  expect(screen.queryByTestId("audience-student-81")).toBeNull();
  fireEvent.click(screen.getByTestId("audience-student-83"));
  expect(screen.getByTestId("audience-chosen").textContent).toContain("Chinedu Eze");
  fireEvent.click(screen.getByTestId("button-save-exam"));
  await waitFor(() => expect(api.run).toHaveBeenCalledTimes(1));
  const [cmd] = api.run.mock.calls[0] as unknown as [{ action: string; exam: { title: string; onlyStudentIds: number[] | null; published: boolean }; alsoClassIds?: number[] }];
  expect([cmd.action, cmd.exam.title, cmd.exam.onlyStudentIds, cmd.exam.published, cmd.alsoClassIds]).toEqual(["saveExam", "Year 8 Maths (copy)", [83], false, undefined]);
});

it("asks for a student before saving, and the whole class needs nobody chosen", async () => {
  render(wrap(<ExamsPanel data={data} />));
  fireEvent.click(screen.getByTestId("button-duplicate-student-50"));
  fireEvent.click(screen.getByTestId("button-save-exam"));
  expect(screen.getByRole("alert").textContent).toContain("Choose at least one student");
  expect(api.run).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("audience-whole-class"));
  expect(screen.getByTestId("fieldset-also-classes")).toBeTruthy();
  fireEvent.click(screen.getByTestId("button-save-exam"));
  await waitFor(() => expect(api.run).toHaveBeenCalledTimes(1));
  const [cmd] = api.run.mock.calls[0] as unknown as [{ exam: { onlyStudentIds: number[] | null }; alsoClassIds?: number[] }];
  expect([cmd.exam.onlyStudentIds, cmd.alsoClassIds]).toEqual([null, [9]]);
});
