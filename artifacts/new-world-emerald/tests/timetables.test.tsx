import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Timetable, TimetableWorkspace } from "@workspace/api-client-react";
import { StudentTimetables, TimetablesPanel, timetableAudience } from "../src/portal/Timetables";

const api = vi.hoisted(() => ({ mine: [] as unknown[], workspace: null as unknown, manage: vi.fn(async () => ({ message: "Posted." })), fetch: vi.fn() }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  customFetch: api.fetch,
  useListMyTimetables: () => ({ data: api.mine, isLoading: false, isError: false, refetch: vi.fn() }),
  useListTimetables: () => ({ data: api.workspace, isLoading: false, isError: false, refetch: vi.fn() }),
  useManageTimetables: () => ({ mutateAsync: api.manage, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const exam: Timetable = { id: 1, title: "Autumn Term exam timetable", kind: "exam", classIds: [], classNames: [], fileId: "f-exam", fileType: "pdf", published: true, createdBy: "officer@school.test", updatedAt: "2026-11-05T09:00:00Z" };
const lessons: Timetable = { id: 2, title: "JSS 1 lessons", kind: "class", classIds: [1], classNames: ["JSS 1"], fileId: "f-photo", fileType: "image", published: true, createdBy: "office@school.test", updatedAt: "2026-11-04T09:00:00Z" };

describe("timetables for students", () => {
  it("opens a PDF and shows a photo in full", () => {
    api.mine = [exam, lessons];
    render(wrap(<StudentTimetables />));
    expect(within(screen.getByTestId("card-timetable-1")).getByText("Open the PDF")).toBeTruthy();
    expect(screen.getByTestId("card-timetable-1").textContent).toContain("Whole school");
    const photo = screen.getByAltText("JSS 1 lessons");
    expect(photo.getAttribute("src")).toMatch(/\/api\/portal\/files\/f-photo$/);
    expect(timetableAudience(lessons)).toBe("JSS 1");
  });
  it("explains when nothing is posted", () => {
    api.mine = [];
    render(wrap(<StudentTimetables />));
    expect(screen.getByText("No timetables yet")).toBeTruthy();
  });
});

describe("posting a timetable", () => {
  const workspace: TimetableWorkspace = { canWholeSchool: true, classes: [{ id: 1, name: "JSS 1" }, { id: 2, name: "Year 3" }], timetables: [lessons] };
  it("uploads the exam timetable for the whole school and posts it", async () => {
    api.workspace = workspace;
    api.fetch.mockResolvedValue({ fileId: "new-file", fileType: "pdf" });
    render(wrap(<TimetablesPanel />));
    fireEvent.click(screen.getByTestId("button-add-timetable"));
    expect((screen.getByTestId("button-save-timetable") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-timetable-title"), { target: { value: " Autumn Term exam timetable " } });
    const file = new File(["%PDF-1.4"], "exams.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("input-timetable-file"), { target: { files: [file] } });
    await waitFor(() => expect(api.fetch).toHaveBeenCalledWith("/api/portal/documents", expect.objectContaining({ method: "POST", body: file })));
    await waitFor(() => expect((screen.getByTestId("button-save-timetable") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("button-save-timetable"));
    await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "save", timetable: { title: "Autumn Term exam timetable", kind: "exam", classIds: [], fileId: "new-file", published: true } } }));
  });
  it("lets a teacher post only for their class, uploading the file for that class", async () => {
    api.workspace = { canWholeSchool: false, classes: [{ id: 2, name: "Year 3" }], timetables: [] };
    api.fetch.mockResolvedValue({ fileId: "class-file", fileType: "image" });
    render(wrap(<TimetablesPanel />));
    fireEvent.click(screen.getByTestId("button-add-timetable"));
    expect(screen.queryByTestId("button-timetable-whole-school")).toBeNull();
    expect(screen.getByTestId("button-timetable-class-2").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("radio-timetable-class"));
    const file = new File(["png"], "week.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("input-timetable-file"), { target: { files: [file] } });
    await waitFor(() => expect(api.fetch).toHaveBeenCalledWith("/api/portal/documents?classId=2", expect.anything()));
    await waitFor(() => expect((screen.getByTestId("button-timetable-class-2") as HTMLButtonElement).disabled).toBe(true));
  });
  it("hides and deletes", async () => {
    api.workspace = workspace;
    render(wrap(<TimetablesPanel />));
    fireEvent.click(screen.getByTestId("button-toggle-timetable-2"));
    await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "save", timetable: { id: 2, title: "JSS 1 lessons", kind: "class", classIds: [1], fileId: "f-photo", published: false } } }));
    fireEvent.click(screen.getByTestId("button-delete-timetable-2"));
    fireEvent.click(screen.getByTestId("button-confirm-delete-timetable"));
    await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "delete", id: 2 } }));
  });
});
