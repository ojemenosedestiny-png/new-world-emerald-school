import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PortalManagement, PortalPdfImport, PortalAttemptQuestionsItem } from "@workspace/api-client-react";
import { ExamEditor, blankExam } from "../src/portal/manage/ExamEditor";
import { QuestionCard } from "../src/portal/exam/QuestionCard";

const api = vi.hoisted(() => ({ result: null as unknown, run: vi.fn(async () => true) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useImportPortalPdf: () => ({ isPending: false, mutate: (_vars: unknown, opts: { onSuccess: (r: unknown) => void }) => opts.onSuccess(api.result) }),
}));
vi.mock("../src/portal/manage/useCommand", () => ({ useCommand: () => ({ run: api.run, pending: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const passage = "Read the passage carefully and answer Questions 1 to 5.\n\nAt the beginning of the term, students noticed...";
const mcq = (n: number, extra: object = {}) => ({ id: `q${n}`, type: "mcq" as const, text: `Question ${n}?`, options: ["A1", "B1", "C1", "D1"].map((o) => o + n), marks: 1, correctAnswer: null, rubric: "", ...extra });
const imported: PortalPdfImport = {
  fileId: "paper-1",
  warning: "Draft extraction only: review every question, choice, passage, diagram, mark and answer key.",
  extractedText: "…",
  questions: [1, 2, 3, 4, 5].map((n) => mcq(n, { passage })).concat([mcq(6, { diagramFileId: "diagram-6" }), mcq(7)]),
  passages: [
    { text: "ENGLISH LANGUAGE - SECTION A: COMPREHENSION", from: null, to: null, before: 1 },
    { text: passage, from: 1, to: 5, before: 1 },
    { text: "MATHEMATICS - SECTION A", from: null, to: null, before: 6 },
  ],
  notes: [
    { question: 5, message: "Question 6: the diagram on page 4 was attached as a picture. Check it against the original PDF." },
    { question: 6, message: "Question 7: a diagram on page 5 was not imported. Use Original PDF mode or attach the diagram manually." },
  ],
};
const data = { classes: [{ id: 1, name: "SS 3" }], students: [], teachers: [], exams: [], attempts: [], materials: [], notices: [] } as unknown as PortalManagement;

function importPaper() {
  api.result = imported;
  render(<ExamEditor data={data} initial={{ ...blankExam(1), title: "SS3 Mixed", subject: "English and Maths" }} onClose={() => {}} />);
  const input = document.querySelector('input[type="file"][accept="application/pdf"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["%PDF-"], "paper.pdf", { type: "application/pdf" })] } });
}

it("shows the passage once above its questions, separate from the stems, and staff can edit it", () => {
  importPaper();
  const editor = screen.getByTestId("editor-passage-1");
  expect((within(editor).getByTestId("input-passage-1") as HTMLTextAreaElement).value).toBe(passage);
  expect((screen.getByTestId("input-passage-to-1") as HTMLInputElement).value).toBe("5");
  expect(screen.queryByTestId("editor-passage-2")).toBeNull();
  expect((screen.getByTestId("input-qtext-0") as HTMLTextAreaElement).value).toBe("Question 1?");
  expect(screen.getByText("Passage shown with questions 1–5.")).toBeTruthy();

  fireEvent.change(screen.getByTestId("input-passage-1"), { target: { value: "Edited passage" } });
  fireEvent.change(screen.getByTestId("input-passage-to-1"), { target: { value: "2" } });
  expect((screen.getByTestId("input-passage-1") as HTMLTextAreaElement).value).toBe("Edited passage");
  expect((screen.getByTestId("input-passage-to-1") as HTMLInputElement).value).toBe("2");
  expect(screen.queryByTestId("editor-passage-3")).toBeNull();
});

it("shows each diagram and its note on the right question, and a clear warning when one was not imported", () => {
  importPaper();
  expect(screen.getByTestId("img-diagram-5").getAttribute("src")).toContain("/api/portal/diagrams/diagram-6");
  expect(screen.getByTestId("note-q-5").textContent).toContain("attached as a picture");
  expect(screen.queryByTestId("img-diagram-6")).toBeNull();
  expect(screen.getByTestId("note-q-6").textContent).toBe("Question 7: a diagram on page 5 was not imported. Use Original PDF mode or attach the diagram manually.");
  expect(screen.getByTestId("button-diagram-6").textContent).toContain("Attach diagram");
  expect(screen.getByTestId("button-diagram-5").textContent).toContain("Replace diagram");
});

it("keeps headings found outside questions for staff to place, and never fills in answers", async () => {
  importPaper();
  expect(screen.getByTestId("list-loose-text").textContent).toContain("MATHEMATICS - SECTION A");
  fireEvent.click(screen.getByTestId("button-loose-instructions-0"));
  expect((screen.getByTestId("input-exam-instructions") as HTMLTextAreaElement).value).toBe("ENGLISH LANGUAGE - SECTION A: COMPREHENSION");
  expect(screen.getByTestId("text-import-keys").textContent).toContain("Select the correct answer");
  expect(screen.getAllByRole("radio", { checked: true }).filter((r) => r.getAttribute("data-testid")?.startsWith("radio-key"))).toHaveLength(0);

  // Publishing is refused until staff choose every answer; a draft saves passages and diagrams as reviewed.
  fireEvent.click(screen.getByTestId("checkbox-exam-published"));
  fireEvent.click(screen.getByTestId("button-save-exam"));
  expect(screen.getByRole("alert").textContent).toContain("needs a confirmed answer key");
  expect(api.run).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("checkbox-exam-published"));
  fireEvent.click(screen.getByTestId("button-save-exam"));
  const saved = (api.run.mock.calls[0] as unknown as [{ exam: { questions: { passage?: string; diagramFileId?: string | null; correctAnswer: null }[] } }])[0].exam.questions;
  expect(saved[0].passage).toBe(passage);
  expect(saved[5]).toMatchObject({ diagramFileId: "diagram-6", correctAnswer: null });
  expect("passage" in saved[6]).toBe(false);
});

it("students read the passage open on its first question and collapsed after, with the diagram under the stem", () => {
  const q = (n: number, extra: object = {}) => ({ id: `s${n}`, type: "mcq", text: `Question ${n}?`, options: ["a", "b"], marks: 1, ...extra }) as PortalAttemptQuestionsItem;
  render(<>
    <QuestionCard q={q(1, { passage })} index={0} value="" onChange={() => {}} disabled={false} />
    <QuestionCard q={q(2, { passage })} index={1} value="" onChange={() => {}} disabled={false} sharedWith={1} />
    <QuestionCard q={q(3, { diagramFileId: "d3" })} index={2} value="" onChange={() => {}} disabled={false} />
  </>);
  expect((screen.getByTestId("passage-s1") as HTMLDetailsElement).open).toBe(true);
  expect((screen.getByTestId("passage-s2") as HTMLDetailsElement).open).toBe(false);
  expect(screen.getByTestId("passage-s2").textContent).toContain("same as question 1");
  expect(screen.getByTestId("diagram-s3").getAttribute("alt")).toBe("Diagram for question 3");
});
