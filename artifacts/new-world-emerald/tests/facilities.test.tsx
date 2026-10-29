import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { HostelPanel, TransportPanel } from "../src/portal/manage/FacilitiesPanels";
import { StudentFacilities } from "../src/portal/StudentFacilities";

const api = vi.hoisted(() => ({ manage: vi.fn(async () => ({ message: "Saved." })), mine: null as unknown }));
const person = (studentId: number, name: string, detail: string) => ({ studentId, studentCode: `NWE-${studentId}`, name, className: "SS 1", detail });
const data = {
  students: [{ id: 1, studentCode: "NWE-1", name: "Ada Obi", className: "SS 1" }, { id: 3, studentCode: "NWE-3", name: "Chi Eze", className: "SS 2" }],
  blocks: [{ id: 5, name: "Emerald House", gender: "girls", description: "", imageUrl: "", rooms: [
    { id: 9, blockId: 5, name: "Room 1", beds: 2, priceKobo: 15_000_000, imageUrl: "", notes: "", occupants: [person(1, "Ada Obi", "Bed 1"), person(2, "Bisi Ade", "Bed 2")], status: "full" },
    { id: 10, blockId: 5, name: "Room 2", beds: 4, priceKobo: 15_000_000, imageUrl: "", notes: "", occupants: [], status: "available" },
  ] }],
  routes: [{ id: 7, name: "Ikeja - Ojota", stops: [{ name: "Ikeja", pickup: "06:45", dropoff: "15:40" }, { name: "Ojota", pickup: "07:05", dropoff: "15:20" }], driverName: "Mr Musa", driverPhone: "0803 123 4567", vehicle: "Coaster", plate: "LAG 123 XY", feeKobo: 4_000_000, notes: "", active: true, riders: [person(1, "Ada Obi", "Ojota")] }],
};
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useGetFacilities: () => ({ isLoading: false, isError: false, data }),
  useManageFacilities: () => ({ mutateAsync: api.manage, isPending: false }),
  useGetMyFacilities: () => ({ isLoading: false, isError: false, data: api.mine }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("shows occupancy, blocks full rooms, and allocates a student to a bed", async () => {
  render(wrap(<HostelPanel />));
  expect(screen.getByTestId("room-status-9").textContent).toBe("Full");
  expect(screen.getByTestId("room-status-10").textContent).toBe("4 free");
  expect((screen.getByTestId("button-allocate-9") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId("button-allocate-10"));
  fireEvent.change(screen.getByTestId("select-allocate-student"), { target: { value: "3" } });
  fireEvent.click(screen.getByTestId("button-confirm-allocate"));
  await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "allocate", allocation: { studentId: 3, roomId: 10, bed: "Bed 1" } } }));
});

it("shows each route's stops and times and assigns a student to a stop", async () => {
  render(wrap(<TransportPanel />));
  expect(screen.getByTestId("route-7").textContent).toContain("Pick-up 07:05");
  expect(screen.getByTestId("route-7").textContent).toContain("LAG 123 XY");
  fireEvent.click(screen.getByTestId("button-assign-7"));
  fireEvent.change(screen.getByTestId("select-assign-student"), { target: { value: "3" } });
  fireEvent.change(screen.getByTestId("select-assign-stop"), { target: { value: "Ojota" } });
  fireEvent.click(screen.getByTestId("button-confirm-assign"));
  await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "assignRoute", assignment: { studentId: 3, routeId: 7, stop: "Ojota" } } }));
});

it("a student sees their room and bus, and a clear message when they have neither", () => {
  api.mine = { hostel: { block: "Emerald House", gender: "girls", room: "Room 1", bed: "Bed 1", priceKobo: 15_000_000, imageUrl: "", roommates: 1 }, transport: { route: "Ikeja - Ojota", stop: "Ojota", pickup: "07:05", dropoff: "15:20", driverName: "Mr Musa", driverPhone: "0803 123 4567", vehicle: "Coaster", plate: "LAG 123 XY", feeKobo: 4_000_000, stops: data.routes[0].stops } };
  render(wrap(<StudentFacilities />));
  expect(screen.getByTestId("card-my-hostel").textContent).toContain("Room 1");
  expect(screen.getByTestId("card-my-hostel").textContent).toContain("₦150,000 per term");
  expect(screen.getByTestId("card-my-route").textContent).toContain("07:05");
  cleanup();
  api.mine = { hostel: null, transport: null };
  render(wrap(<StudentFacilities />));
  expect(screen.getByText("No hostel room or bus route")).toBeTruthy();
});
