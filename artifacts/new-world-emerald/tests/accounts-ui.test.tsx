import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortalManagement } from "@workspace/api-client-react";
import { PasswordStrength, passwordProblem, passwordScore } from "../src/portal/PasswordStrength";
import ActivateAccount from "../src/pages/ActivateAccount";
import { StudentLogin } from "../src/portal/StudentLogin";
import { EnrolStudentDialog, activationSlipsHtml, whatsAppLink } from "../src/portal/manage/accounts";

const mocks = vi.hoisted(() => ({ check: vi.fn(), complete: vi.fn(), forgot: vi.fn(), enrol: vi.fn() }));
function mutation(fn: ReturnType<typeof vi.fn>) {
  // Minimal useMutation stand-in that drives onSuccess and exposes state like React Query.
  return () => {
    const [state, setState] = useState<{ data?: unknown; error?: unknown; status: string }>({ status: "idle" });
    return {
      mutate: (vars: unknown, opts?: { onSuccess?: (d: unknown) => void }) => {
        setState({ status: "pending" });
        Promise.resolve(fn(vars)).then((d) => { setState({ data: d, status: "success" }); opts?.onSuccess?.(d); }, (e) => setState({ error: e, status: "error" }));
      },
      data: state.data, error: state.error, isPending: state.status === "pending", isError: state.status === "error", isSuccess: state.status === "success",
    };
  };
}
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useCheckAccountToken: mutation(mocks.check),
  useCompleteAccountToken: mutation(mocks.complete),
  useRequestPasswordReset: mutation(mocks.forgot),
  useEnrolStudent: mutation(mocks.enrol),
  useLoginPortalStudent: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); window.history.replaceState(null, "", "/"); });
const TOKEN = "ab".repeat(32);

describe("password strength", () => {
  it("matches the server rule and scores variety", () => {
    expect(passwordProblem("short1")).toBe("Use at least 10 characters.");
    expect(passwordProblem("onlyletterslong")).toBe("Include at least one letter and one number.");
    expect(passwordProblem("Ada-Chosen-2026")).toBeNull();
    expect(passwordScore("")).toBe(0);
    expect(passwordScore("onlyletterslong")).toBe(1);
    expect(passwordScore("Ada-Chosen-2026!xyz")).toBe(4);
    render(<PasswordStrength password="abc" />);
    expect(screen.getByTestId("password-strength").textContent).toContain("Weak");
  });
});

describe("activation page", () => {
  it("confirms the student, enforces the password rule, then signs in", async () => {
    window.history.replaceState(null, "", "/portal/activate?t=" + TOKEN);
    mocks.check.mockResolvedValue({ purpose: "activate", studentName: "Ada Obi", studentId: "NWE/2026/00001", className: "JSS 1", expiresAt: new Date().toISOString() });
    mocks.complete.mockResolvedValue({ role: "student", name: "Ada Obi", studentId: "NWE/2026/00001", classIds: [1], mustChangePassword: false });
    render(wrap(<ActivateAccount />));
    await waitFor(() => expect(screen.getByTestId("panel-account-details").textContent).toContain("NWE/2026/00001"));
    expect(mocks.check).toHaveBeenCalledWith({ data: { token: TOKEN } });
    expect(window.location.search).toBe("", "token removed from the address bar");
    const submit = screen.getByTestId("button-activate") as HTMLButtonElement;
    fireEvent.change(screen.getByTestId("input-activate-password"), { target: { value: "onlyletterslong" } });
    fireEvent.change(screen.getByTestId("input-activate-confirm"), { target: { value: "onlyletterslong" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-activate-password"), { target: { value: "Ada-Chosen-2026" } });
    fireEvent.change(screen.getByTestId("input-activate-confirm"), { target: { value: "Ada-Chosen-2026" } });
    fireEvent.click(submit);
    await waitFor(() => expect(window.location.pathname).toBe("/portal"));
    expect(mocks.complete).toHaveBeenCalledWith({ data: { token: TOKEN, password: "Ada-Chosen-2026" } });
  });
  it("explains an invalid or missing link", async () => {
    window.history.replaceState(null, "", "/portal/activate?t=" + TOKEN);
    mocks.check.mockRejectedValue(new Error("This link is invalid, already used or expired. Ask the school office for a new one."));
    render(wrap(<ActivateAccount />));
    await waitFor(() => expect(screen.getByText("This link cannot be used")).toBeTruthy());
    cleanup();
    window.history.replaceState(null, "", "/portal/activate");
    render(wrap(<ActivateAccount />));
    expect(screen.getByText("This link is incomplete")).toBeTruthy();
  });
});

describe("forgot password", () => {
  it("asks for the Student ID and shows the server's neutral reply", async () => {
    mocks.forgot.mockResolvedValue({ message: "If that Student ID has a parent email on file, a password reset link has been sent to it." });
    render(wrap(<StudentLogin />));
    fireEvent.click(screen.getByTestId("button-forgot-password"));
    fireEvent.change(screen.getByTestId("input-forgot-id"), { target: { value: " nwe/2026/00001 " } });
    fireEvent.click(screen.getByTestId("button-send-reset"));
    await waitFor(() => expect(screen.getByTestId("text-forgot-sent").textContent).toContain("If that Student ID"));
    expect(mocks.forgot).toHaveBeenCalledWith({ data: { studentId: "nwe/2026/00001" } });
  });
});

describe("staff enrolment", () => {
  it("enrols with an automatic ID, optional parent email and optional existing ID", async () => {
    const result = { student: { id: 3, studentId: "NWE/2026/00003", name: "Ada Obi", className: "JSS 1", guardianEmail: "p@example.com" }, url: "https://s/portal/activate?t=" + TOKEN, expiresAt: new Date().toISOString(), emailed: true, emailNote: "Emailed to p@example.com." };
    mocks.enrol.mockResolvedValue(result);
    const onDone = vi.fn();
    const data = { classes: [{ id: 7, name: "JSS 1" }], students: [], teachers: [], exams: [], attempts: [], materials: [], notices: [] } as unknown as PortalManagement;
    render(wrap(<EnrolStudentDialog data={data} onClose={() => {}} onDone={onDone} />));
    fireEvent.change(screen.getByTestId("input-enrol-name"), { target: { value: "Ada Obi" } });
    fireEvent.change(screen.getByTestId("input-enrol-email"), { target: { value: "p@example.com" } });
    fireEvent.click(screen.getByTestId("button-enrol-student"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(result));
    expect(mocks.enrol).toHaveBeenCalledWith({ data: { name: "Ada Obi", classId: 7, guardianEmail: "p@example.com", studentId: null, send: true } });
  });
  it("prints escaped activation slips and builds a WhatsApp share link", () => {
    const html = activationSlipsHtml([{ name: "<b>Ada</b>", studentId: "NWE/2026/00001", className: "JSS 1", url: "https://s/portal/activate?t=x", expiresAt: new Date().toISOString() }]);
    expect(html).not.toContain("<b>Ada</b>");
    expect(html).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(html).not.toContain("<script");
    const wa = whatsAppLink({ student: { id: 1, studentId: "NWE/2026/00001", name: "Ada", className: "", guardianEmail: null }, url: "https://s/portal/activate?t=x" }, "activate");
    expect(wa.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(wa)).toContain("https://s/portal/activate?t=x");
  });
});
