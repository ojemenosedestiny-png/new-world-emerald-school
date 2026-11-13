import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { StudentProfileView } from "@workspace/api-client-react";
import { MyProfile } from "../src/portal/profile/StudentProfile";

const api = vi.hoisted(() => ({ saveMine: vi.fn(async (_v: unknown) => ({})), data: null as unknown }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useGetMyStudentProfile: () => ({ isLoading: false, isError: false, data: api.data, refetch: vi.fn() }),
  useSaveMyStudentProfile: () => ({ mutateAsync: api.saveMine, isPending: false }),
  useSaveStudentProfile: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../src/portal/photos", () => ({ Avatar: () => null }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const empty = Object.fromEntries(["dateOfBirth", "gender", "phone", "address", "city", "stateOfOrigin", "lga", "nationality", "religion", "bloodGroup", "genotype", "medicalNotes", "admissionDate", "previousSchool", "parent1Name", "parent1Relationship", "parent1Phone", "parent1Occupation", "parent2Name", "parent2Relationship", "parent2Phone", "parent2Occupation", "emergencyName", "emergencyPhone"].map((k) => [k, ""]));
const view = (profile: Record<string, string>): StudentProfileView => ({
  id: 7, studentId: "NWE/2026/00007", name: "Ada Obi", className: "JSS 1 Amber", active: true, photoImageId: null, guardianEmail: null, secondGuardianEmail: null,
  profile, updatedAt: null, updatedBy: "", canEdit: true,
});

it("asks the student to fill in their details, and saves them from their own portal", async () => {
  api.data = view({ ...empty, admissionDate: "2022-09-12" });
  render(wrap(<MyProfile />));
  expect(screen.getByTestId("text-profile-ask")).toBeTruthy();
  fireEvent.click(screen.getByTestId("button-edit-my-profile"));
  expect(screen.getByText(/Fill this in with your parent or guardian/)).toBeTruthy();
  expect(screen.queryByTestId("input-profile-admissionDate"), "the school sets the admission date").toBeNull();
  fireEvent.change(screen.getByTestId("input-profile-address"), { target: { value: "4 Unity Close, Gwarinpa" } });
  fireEvent.change(screen.getByTestId("input-profile-parent1Phone"), { target: { value: "0803 123 4567" } });
  fireEvent.click(screen.getByTestId("button-save-profile"));
  await waitFor(() => expect(api.saveMine).toHaveBeenCalledTimes(1));
  const sent = (api.saveMine.mock.calls[0][0] as { data: Record<string, string> }).data;
  expect(sent.address).toBe("4 Unity Close, Gwarinpa");
  expect(sent.parent1Phone).toBe("0803 123 4567");
});

it("stops asking once the address and a parent's phone are in", () => {
  api.data = view({ ...empty, address: "4 Unity Close", parent1Phone: "0803 123 4567" });
  render(wrap(<MyProfile />));
  expect(screen.queryByTestId("text-profile-ask")).toBeNull();
  expect(screen.getByTestId("button-edit-my-profile").textContent).toContain("Update my details");
});
