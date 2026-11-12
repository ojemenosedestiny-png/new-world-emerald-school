import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PortalManagement, TapInOverview } from "@workspace/api-client-react";
import { TapInPanel } from "../src/portal/manage/TapInPanel";

const api = vi.hoisted(() => ({ manage: vi.fn(async (_v: unknown) => ({ message: "Saved." } as { message: string; key?: string })), data: null as unknown }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useGetTapIn: () => ({ isLoading: false, isError: false, data: api.data, refetch: vi.fn() }),
  useManageTapIn: () => ({ mutateAsync: api.manage, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const mgmt = {
  classes: [{ id: 1, name: "JSS 1 Amber" }, { id: 2, name: "Year 3 Ruby" }],
  students: [
    { id: 11, name: "Ada Obi", studentId: "NWE/2026/00011", classId: 1, active: true },
    { id: 12, name: "Tolu Ade", studentId: "NWE/2026/00012", classId: 2, active: true },
    { id: 13, name: "Old Leaver", studentId: "NWE/2026/00013", classId: 2, active: false },
  ],
  teachers: [], exams: [], attempts: [], materials: [], notices: [],
} as unknown as PortalManagement;

const overview: TapInOverview = {
  lateAfter: "08:00",
  tapAddress: "https://example.test/api/kiosk/tap",
  kiosks: [{ id: 5, name: "Main gate", keyHint: "Ab9z", active: true, lastSeenAt: "2026-11-12T06:40:00Z", createdAt: "2026-11-01T08:00:00Z" }],
  cards: [{ id: 21, cardId: "04A1B2C3", studentId: 12, studentName: "Tolu Ade", studentNumber: "NWE/2026/00012", className: "Year 3 Ruby", createdAt: "2026-11-02T08:00:00Z" }],
  recent: [
    { id: 1, at: "2026-11-12T06:42:00Z", kioskName: "Main gate", cardId: "04A1B2C3", studentName: "Tolu Ade", className: "Year 3 Ruby", result: "present", message: "Welcome, Tolu." },
    { id: 2, at: "2026-11-12T06:45:00Z", kioskName: "Main gate", cardId: "99FF00", studentName: null, className: null, result: "unknown_card", message: "Not linked." },
  ],
  unknownCards: [{ cardId: "99FF00", lastAt: "2026-11-12T06:45:00Z", kioskName: "Main gate", taps: 1 }],
  today: { date: "2026-11-12", tapped: 1, present: 1, late: 0 },
};

it("shows today's taps, kiosks, linked cards and new cards", () => {
  api.data = overview;
  render(wrap(<TapInPanel data={mgmt} />));
  expect(screen.getByTestId("stat-tap-tapped-in-today").textContent).toBe("1");
  expect(within(screen.getByTestId("kiosk-5")).getByText(/Ab9z/)).toBeTruthy();
  expect(within(screen.getByTestId("tap-card-21")).getByText("Tolu Ade")).toBeTruthy();
  expect(screen.getByTestId("unknown-card-99FF00")).toBeTruthy();
  expect(within(screen.getByTestId("tap-event-2")).getByText("New card")).toBeTruthy();
});

it("links a new card tapped on a kiosk to an active student (inactive students are not offered)", async () => {
  api.data = overview;
  render(wrap(<TapInPanel data={mgmt} />));
  const select = screen.getByTestId("select-unknown-student-99FF00") as HTMLSelectElement;
  expect([...select.options].map((o) => o.textContent).join("|")).not.toContain("Old Leaver");
  fireEvent.change(screen.getByTestId("select-unknown-student-99FF00-search"), { target: { value: "ada" } });
  fireEvent.change(select, { target: { value: "11" } });
  fireEvent.click(screen.getByTestId("button-link-unknown-99FF00"));
  await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "assignCard", cardId: "99FF00", studentId: 11 } }));
});

it("adds a kiosk and shows its key once with the address to send taps to", async () => {
  api.data = overview;
  api.manage.mockResolvedValueOnce({ message: "Added.", key: "nwek_secretkey1234" });
  render(wrap(<TapInPanel data={mgmt} />));
  fireEvent.change(screen.getByTestId("input-kiosk-name"), { target: { value: "Back gate" } });
  fireEvent.click(screen.getByTestId("button-add-kiosk"));
  await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "addKiosk", name: "Back gate" } }));
  expect((await screen.findByTestId("text-kiosk-key")).textContent).toBe("nwek_secretkey1234");
  expect(screen.getAllByText("https://example.test/api/kiosk/tap").length).toBeGreaterThan(0);
});

it("links a card by number and saves the late time", async () => {
  api.data = overview;
  render(wrap(<TapInPanel data={mgmt} />));
  fireEvent.change(screen.getByTestId("input-card-id"), { target: { value: "0a:1b:2c" } });
  fireEvent.change(screen.getByTestId("select-card-student"), { target: { value: "12" } });
  fireEvent.click(screen.getByTestId("button-link-card"));
  await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "assignCard", cardId: "0a:1b:2c", studentId: 12 } }));
  fireEvent.change(screen.getByTestId("input-late-after"), { target: { value: "07:45" } });
  fireEvent.click(screen.getByTestId("button-save-late-after"));
  await waitFor(() => expect(api.manage).toHaveBeenCalledWith({ data: { action: "setLateAfter", lateAfter: "07:45" } }));
});
