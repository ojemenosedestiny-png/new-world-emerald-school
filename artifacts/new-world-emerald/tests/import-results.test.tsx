import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ImportResultsPanel } from "../src/portal/manage/ImportResultsPanel";

const api = vi.hoisted(() => ({ preview: vi.fn(), commit: vi.fn() }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  previewResultImport: api.preview,
  commitResultImport: api.commit,
  useListResultImports: () => ({ data: [{ id: 1, fileName: "2019.csv", importedBy: "office@example.test", rows: 10, imported: 9, skipped: 1, warnings: 0, published: 2, terms: ["First Term, 2019/2020"], classes: ["JSS 1"], newTerms: [], newSubjects: [], createdAt: "2026-10-28T10:00:00Z" }], isLoading: false, isError: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const row = (line: number, status: "ok" | "warning" | "error", messages: string[] = []) => ({ line, status, messages, studentId: "NWE/2019/001", studentName: "Ada Obi", className: "JSS 1", session: "2019/2020", term: "First Term", subject: "Mathematics", ca: 30, exam: 50, total: 80, grade: "A" });

it("checks the file first, shows every problem, then imports the good rows and publishes on request", async () => {
  api.preview.mockResolvedValue({
    missingColumns: [], total: 3, ok: 1, warnings: 1, errors: 1, students: 1, terms: ["First Term, 2019/2020"], classes: ["JSS 1"],
    newTerms: ["First Term, 2019/2020"], newSubjects: ["Mathematics in JSS 1"],
    problems: [row(4, "error", ["No student with ID NWE/2019/404. Enrol them first."]), row(3, "warning", ["Name differs: the portal has Ada Obi."])], sample: [row(2, "ok")],
  });
  api.commit.mockResolvedValue({ id: 2, fileName: "old.csv", importedBy: "x", rows: 3, imported: 2, skipped: 1, warnings: 1, published: 1, terms: [], classes: [], newTerms: [], newSubjects: [], createdAt: "2026-10-28T11:00:00Z" });
  render(wrap(<ImportResultsPanel />));
  expect(screen.getByTestId("link-import-template").getAttribute("href")).toContain("/api/portal/results-import/template");
  expect(screen.getByTestId("list-import-history").textContent).toContain("2019.csv");

  const file = new File(["Student ID,Class\n"], "old.csv", { type: "text/csv" });
  fireEvent.change(screen.getByTestId("input-import-file"), { target: { files: [file] } });
  await waitFor(() => expect(api.preview).toHaveBeenCalledWith("Student ID,Class\n", { caMax: 40, examMax: 60 }));
  expect((await screen.findByTestId("import-count-not-imported")).textContent).toBe("1");
  expect(screen.getByTestId("table-import-problems").textContent).toContain("No student with ID NWE/2019/404");
  expect(screen.getByTestId("panel-import-preview").textContent).toContain("Mathematics in JSS 1");
  expect(screen.getByTestId("button-import-commit").textContent).toContain("Import 2 rows, skip 1");

  fireEvent.click(screen.getByTestId("button-import-commit"));
  await waitFor(() => expect(api.commit).toHaveBeenCalledWith("Student ID,Class\n", { caMax: 40, examMax: 60, publish: true, fileName: "old.csv" }));
  expect((await screen.findByTestId("text-import-done")).textContent).toContain("Imported 2 of 3 rows (1 skipped), published for 1 class term");
});

it("names missing columns instead of guessing", async () => {
  api.preview.mockResolvedValue({ missingColumns: ["Student ID", "Term"], total: 0, ok: 0, warnings: 0, errors: 0, students: 0, terms: [], classes: [], newTerms: [], newSubjects: [], problems: [], sample: [] });
  render(wrap(<ImportResultsPanel />));
  fireEvent.change(screen.getByTestId("input-import-file"), { target: { files: [new File(["x"], "bad.csv")] } });
  expect((await screen.findByTestId("text-import-missing")).textContent).toContain("Student ID, Term");
  expect(screen.queryByTestId("button-import-commit")).toBeNull();
});
