import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PortalManagement } from "@workspace/api-client-react";
import { StudentsPanel } from "../src/portal/manage/PeoplePanels";
import { friendlyPassword } from "../src/portal/lib";

const api = vi.hoisted(() => ({ manage: vi.fn() }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useManagePortal: () => ({ mutateAsync: api.manage, isPending: false }),
}));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const data = {
  classes: [{ id: 3, name: "JSS 1" }],
  students: [{ id: 9, studentId: "NWE/2026/00001", name: "Ada Obi", classId: 3, active: true, accountStatus: "active", guardianEmail: null }],
  teachers: [], exams: [], attempts: [], materials: [], notices: [],
} as unknown as PortalManagement;

it("passwords are easy to type and long enough", () => {
  for (let i = 0; i < 50; i++) expect(friendlyPassword()).toMatch(/^[A-Z][a-z]+-\d{4}7*$/);
  expect(friendlyPassword().length).toBeGreaterThanOrEqual(10);
});

it("a teacher enrols a student with a password and no email, and sees the login to hand over", async () => {
  api.manage.mockResolvedValue({ message: "Student enrolled.", studentId: "NWE/2026/00002" });
  render(wrap(<StudentsPanel data={data} isAdmin={false} />));
  // Office-only actions are hidden from teachers.
  expect(screen.queryByTestId("button-bulk-enrol")).toBeNull();
  expect(screen.queryByTestId("button-add-student")).toBeNull();
  expect(screen.queryByTestId("button-edit-student-9")).toBeNull();
  expect(screen.queryByTestId("button-fees-student-9")).toBeNull();
  expect(screen.queryByTestId("button-toggle-student-9")).toBeNull();
  expect(screen.getByTestId("button-reset-student-9").textContent).toContain("New password");

  fireEvent.click(screen.getByTestId("button-enrol-password"));
  fireEvent.change(screen.getByTestId("input-student-name"), { target: { value: " Bayo Ade " } });
  fireEvent.click(screen.getByTestId("button-save-student"));
  await waitFor(() => expect(api.manage).toHaveBeenCalledTimes(1));
  const sent = api.manage.mock.calls[0][0].data.student;
  expect(sent).toMatchObject({ studentId: "", name: "Bayo Ade", classId: 3, active: true, guardianEmail: null });
  expect(sent.password).toMatch(/^[A-Z][a-z]+-\d{4}/);
  expect((await screen.findByTestId("text-issued-student-id")).textContent).toBe("NWE/2026/00002");
  expect(screen.getByTestId("text-temp-password").textContent).toContain(sent.password);
});
