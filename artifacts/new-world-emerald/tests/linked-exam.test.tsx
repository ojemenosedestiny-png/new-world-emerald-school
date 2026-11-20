import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PortalManagement } from "@workspace/api-client-react";
import { ExamEditor, blankExam } from "../src/portal/manage/ExamEditor";

const api = vi.hoisted(() => ({ run: vi.fn(async () => true) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useImportPortalPdf: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("../src/portal/manage/useCommand", () => ({ useCommand: () => ({ run: api.run, pending: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const classes = [{ id: 1, name: "JSS 1A" }, { id: 2, name: "JSS 1B" }, { id: 3, name: "JSS 1C" }, { id: 4, name: "JSS 2A" }];
const q = { id: "q1", type: "mcq" as const, text: "2 + 2?", options: ["3", "4"], marks: 1, correctAnswer: 1 };

it("a new exam for JSS 1A goes to JSS 1B and 1C too, uploaded once", async () => {
  const data = { classes, examClasses: classes, students: [], teachers: [], exams: [], attempts: [], materials: [], notices: [] } as unknown as PortalManagement;
  render(<ExamEditor data={data} initial={{ ...blankExam(1), title: "Maths test", subject: "Maths", questions: [q] }} onClose={() => {}} />);
  expect(screen.getByTestId("text-exam-goes-to").textContent).toContain("This exam goes to 3 classes:");
  expect(screen.getByTestId("text-exam-goes-to").textContent).toMatch(/JSS 1A.*JSS 1B.*JSS 1C/);
  fireEvent.click(screen.getByTestId("button-save-exam"));
  await waitFor(() => expect(api.run).toHaveBeenCalled());
  expect((api.run.mock.calls[0] as unknown as [{ alsoClassIds: number[] }])[0].alsoClassIds.sort()).toEqual([2, 3]);
  cleanup(); vi.clearAllMocks();

  render(<ExamEditor data={data} initial={{ ...blankExam(1), title: "Maths test", subject: "Maths", questions: [q] }} onClose={() => {}} />);
  fireEvent.click(screen.getByTestId("button-only-this-class"));
  expect(screen.getByTestId("text-exam-goes-to").textContent).toContain("This exam goes to 1 class:");
  fireEvent.click(screen.getByTestId("button-save-exam"));
  await waitFor(() => expect(api.run).toHaveBeenCalled());
  expect((api.run.mock.calls[0] as unknown as [Record<string, unknown>])[0].alsoClassIds).toBeUndefined();
});

it("editing a shared paper saves to every class unless unticked", async () => {
  const copy = (id: number, classId: number) => ({ ...blankExam(classId), id, title: "Maths test", subject: "Maths", questions: [q], paperGroup: "g-1" });
  const data = { classes, examClasses: classes, students: [], teachers: [], exams: [copy(10, 1), copy(11, 2), copy(12, 3)], attempts: [], materials: [], notices: [] } as unknown as PortalManagement;
  render(<ExamEditor data={data} initial={copy(10, 1)} onClose={() => {}} />);
  expect(screen.getByTestId("panel-linked-classes").textContent).toContain("One paper for 3 classes");
  expect(screen.queryByTestId("fieldset-also-classes")).toBeNull();
  fireEvent.click(screen.getByTestId("button-save-exam"));
  await waitFor(() => expect(api.run).toHaveBeenCalledTimes(1));
  expect((api.run.mock.calls[0] as unknown as [{ linked: boolean }])[0].linked).toBe(true);
  fireEvent.click(screen.getByTestId("checkbox-apply-linked"));
  fireEvent.click(screen.getByTestId("button-save-exam"));
  await waitFor(() => expect(api.run).toHaveBeenCalledTimes(2));
  expect((api.run.mock.calls[1] as unknown as [{ linked: boolean }])[0].linked).toBe(false);
});
