import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortalsModal } from "../src/components/Widgets";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), state: { isError: false, isPending: false, error: null as unknown } }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useLoginPortalStudent: () => ({ mutate: mocks.mutate, ...mocks.state }),
}));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(<QueryClientProvider client={client}><PortalsModal isOpen onClose={onClose} /></QueryClientProvider>);
  return { client, onClose };
}
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.state = { isError: false, isPending: false, error: null }; window.history.replaceState(null, "", "/"); });

describe("homepage portal sign-in", () => {
  it("signs a student in with the real portal login and opens the portal", async () => {
    mocks.mutate.mockImplementation((_vars, options) => options.onSuccess({ role: "student", name: "Ada", studentId: "TEST001", classIds: [1], mustChangePassword: true }));
    const { client, onClose } = setup();
    const submit = screen.getByTestId("button-modal-login") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-modal-student-id"), { target: { value: " test001 " } });
    fireEvent.change(screen.getByTestId("input-modal-password"), { target: { value: "Temporary-Pass-1" } });
    fireEvent.click(submit);
    expect(mocks.mutate.mock.calls[0][0]).toEqual({ data: { studentId: "test001", password: "Temporary-Pass-1" } });
    await waitFor(() => expect(window.location.pathname).toBe("/portal"));
    expect(onClose).toHaveBeenCalled();
    expect(client.getQueryData(["/api/portal/session"])).toMatchObject({ role: "student", studentId: "TEST001" });
  });
  it("explains a failed sign-in and how to recover a password", () => {
    mocks.state = { isError: true, isPending: false, error: new Error("Incorrect student ID or password.") };
    setup();
    expect(screen.getByTestId("text-modal-login-error").textContent).toBe("Incorrect student ID or password.");
    fireEvent.click(screen.getByTestId("button-modal-forgot"));
    expect(screen.getByText(/school office/)).toBeTruthy();
  });
  it("sends teachers to staff sign-in and parents to school payments", () => {
    const first = setup();
    fireEvent.click(screen.getByTestId("tab-portal-teacher"));
    fireEvent.click(screen.getByTestId("button-modal-staff"));
    expect(window.location.pathname + window.location.search).toBe("/sign-in?returnTo=portal");
    expect(first.onClose).toHaveBeenCalled();
    cleanup();
    setup();
    fireEvent.click(screen.getByTestId("tab-portal-parent"));
    fireEvent.click(screen.getByTestId("button-modal-parent"));
    expect(window.location.pathname + window.location.search).toBe("/commerce?section=fees");
  });
});
