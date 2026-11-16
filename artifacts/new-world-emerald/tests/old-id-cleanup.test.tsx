import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { OldStudentIdPlan } from "@workspace/api-client-react";
import { OldIdCleanupDialog } from "../src/portal/manage/OldIdCleanup";

const api = vi.hoisted(() => ({ preview: vi.fn(async () => ({}) as unknown), apply: vi.fn(async (_v: unknown) => ({ joined: 1, removed: 1, message: "Done." })) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  usePreviewOldStudentIdCleanup: () => ({ mutateAsync: api.preview, isPending: false }),
  useApplyOldStudentIdCleanup: () => ({ mutateAsync: api.apply, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const s = (id: number, studentId: string, name: string) => ({ id, studentId, name, className: "JSS 1 Amber", active: true });
const plan: OldStudentIdPlan = {
  pairs: [
    { old: s(1, "NWE/2026/00062", "ABDULKARIM SALAMI"), new: s(101, "NW/SEC/26/00001", "Abdulkarim Salami"), oldRecords: ["results", "attendance"], newRecords: [], status: "ready" },
    { old: s(2, "NWE/2026/00063", "FAADHIL AHMED"), new: s(102, "NW/SEC/26/00011", "Faadhil Ahmed"), oldRecords: [], newRecords: ["attendance"], status: "new_has_records" },
  ],
  unpaired: [
    { student: s(3, "NWE/2026/00070", "Left School"), records: [], note: "No new record with this name." },
    { student: s(4, "NWE/2026/00071", "RUNOR OMAMOGHO"), records: ["results"], note: "No new record with this name." },
  ],
  newOptions: [s(108, "NW/SEC/26/00008", "Oghenerunor Omamogho")],
};

it("joins ready pairs and removes empty old records; leaves the rest with a reason", async () => {
  api.preview.mockResolvedValueOnce(plan);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(wrap(<OldIdCleanupDialog open onClose={vi.fn()} />));
  expect((await screen.findByTestId("old-pair-1")).textContent).toContain("NW/SEC/26/00001");
  expect(screen.getByTestId("old-pair-1").textContent).toContain("Keeps: results, attendance");
  expect(screen.queryByTestId("old-pair-2")).toBeNull();
  expect(screen.getByTestId("old-other-2").textContent).toContain("already has attendance");
  expect((screen.getByTestId("select-old-4") as HTMLSelectElement).value, "records: kept unless a person chooses").toBe("keep");
  expect((screen.getByTestId("select-old-3") as HTMLSelectElement).value, "empty: removed").toBe("remove");
  expect([...(screen.getByTestId("select-old-4") as HTMLSelectElement).options].map((o) => o.value)).not.toContain("remove");
  // The office joins a name that differs (RUNOR OMAMOGHO = Oghenerunor Omamogho) by hand.
  fireEvent.change(screen.getByTestId("select-old-4"), { target: { value: "108" } });
  fireEvent.click(screen.getByTestId("button-apply-old-ids"));
  await waitFor(() => expect(api.apply).toHaveBeenCalledWith({ data: { join: [{ oldId: 1, newId: 101 }, { oldId: 4, newId: 108 }], remove: [3] } }));
  confirm.mockRestore();
});

it("keeps an old record the office chooses to keep, and will not join one new record twice", async () => {
  api.preview.mockResolvedValueOnce(plan);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(wrap(<OldIdCleanupDialog open onClose={vi.fn()} />));
  fireEvent.change(await screen.findByTestId("select-old-3"), { target: { value: "108" } });
  fireEvent.change(screen.getByTestId("select-old-4"), { target: { value: "108" } });
  expect((screen.getByTestId("button-apply-old-ids") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByTestId("select-old-3"), { target: { value: "keep" } });
  fireEvent.change(screen.getByTestId("select-old-4"), { target: { value: "keep" } });
  fireEvent.click(screen.getByTestId("button-apply-old-ids"));
  await waitFor(() => expect(api.apply).toHaveBeenCalledWith({ data: { join: [{ oldId: 1, newId: 101 }], remove: [] } }));
  confirm.mockRestore();
});
