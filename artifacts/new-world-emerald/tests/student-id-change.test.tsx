import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PortalManagement, StudentIdPlan } from "@workspace/api-client-react";
import { StudentIdChangeDialog } from "../src/portal/manage/StudentIdChange";

const api = vi.hoisted(() => ({ preview: vi.fn(async (_v: unknown) => ({}) as unknown), apply: vi.fn(async (_v: unknown) => ({ changed: 2, message: "2 students now sign in with the new admission number." })) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  usePreviewStudentIdChange: () => ({ mutateAsync: api.preview, isPending: false }),
  useApplyStudentIdChange: () => ({ mutateAsync: api.apply, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const data = {
  classes: [{ id: 1, name: "JSS 1" }, { id: 2, name: "Year 3" }],
  students: [
    { id: 11, name: "Abdulkarim Salami", studentId: "NWE/2026/00011", classId: 1, active: true },
    { id: 12, name: "Annabel Igwe", studentId: "NWE/2026/00012", classId: 1, active: true },
    { id: 13, name: "Chimamanda Chinedu", studentId: "NWE/2026/00013", classId: 2, active: true },
  ],
  teachers: [], exams: [], attempts: [], materials: [], notices: [],
} as unknown as PortalManagement;
const st = (id: number) => { const s = data.students.find((x) => x.id === id)!; return { id, studentId: s.studentId, name: s.name, className: "JSS 1", active: true }; };
const plan: StudentIdPlan = {
  rows: [
    { line: 3, newId: "NW/SEC/26/00001", name: "Abdulkarim Salami", status: "match", student: st(11), message: "" },
    { line: 4, newId: "NW/SEC/26/00002", name: "Annabel Igwe", status: "unmatched", student: null, message: "No student in the portal has this name." },
    { line: 5, newId: "NW/PRY/26/00001", name: "Chimamanda Chinedu", status: "already", student: st(13), message: "Already has this admission number." },
  ],
  notInList: [],
};

it("checks the pasted list, lets the office choose a student for an unmatched line, then applies", async () => {
  api.preview.mockResolvedValueOnce(plan);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(wrap(<StudentIdChangeDialog open onClose={vi.fn()} data={data} />));
  fireEvent.change(screen.getByTestId("input-id-list"), { target: { value: "1 NW/SEC/26/00001 Abdulkarim Salami" } });
  fireEvent.click(screen.getByTestId("button-check-id-list"));
  await waitFor(() => expect(screen.getByTestId("text-id-ready").textContent).toBe("1"));
  expect(screen.getByTestId("text-id-open").textContent).toBe("1");
  fireEvent.change(screen.getByTestId("select-id-student-4"), { target: { value: "12" } });
  expect(screen.getByTestId("text-id-ready").textContent).toBe("2");
  fireEvent.click(screen.getByTestId("button-apply-ids"));
  await waitFor(() => expect(api.apply).toHaveBeenCalledWith({ data: { changes: [{ id: 11, newId: "NW/SEC/26/00001" }, { id: 12, newId: "NW/SEC/26/00002" }] } }));
  confirm.mockRestore();
});

it("will not apply when the same student is chosen on two lines", async () => {
  api.preview.mockResolvedValueOnce(plan);
  render(wrap(<StudentIdChangeDialog open onClose={vi.fn()} data={data} />));
  fireEvent.change(screen.getByTestId("input-id-list"), { target: { value: "x" } });
  fireEvent.click(screen.getByTestId("button-check-id-list"));
  await screen.findByTestId("select-id-student-4");
  fireEvent.change(screen.getByTestId("select-id-student-4"), { target: { value: "11" } });
  expect((screen.getByTestId("button-apply-ids") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/same student is chosen on two lines/)).toBeTruthy();
});
