import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdleSignOut, useKeepAlive } from "../src/components/IdleSignOut";
import { TwoFactorSetup } from "../src/components/TwoFactorSetup";
import { AuditLogPanel, SessionsPanel, deviceLabel } from "../src/portal/security/SecurityPanels";
import { reportCardsHtml } from "../src/portal/reports/reportCard";
import { loginSlipsHtml } from "../src/portal/manage/enrol";

const mocks = vi.hoisted(() => ({
  openUserProfile: vi.fn(), revoke: vi.fn(),
  sessions: { data: undefined as unknown, isLoading: false, isError: false },
  audit: { data: undefined as unknown, isLoading: false, isError: false },
  auditParams: [] as unknown[],
}));
vi.mock("@clerk/react", () => ({ useClerk: () => ({ openUserProfile: mocks.openUserProfile }) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useGetSecuritySessions: () => ({ ...mocks.sessions, refetch: vi.fn() }),
  useGetAuditLog: (params: unknown) => { mocks.auditParams.push(params); return { ...mocks.audit, refetch: vi.fn() }; },
  useRevokeSessions: () => ({ mutateAsync: mocks.revoke, isPending: false }),
}));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); localStorage.clear(); mocks.auditParams = []; });

describe("idle sign-out", () => {
  it("warns a minute before the limit, resets on activity and signs out at the limit", () => {
    vi.useFakeTimers();
    const onSignOut = vi.fn();
    render(<IdleSignOut enabled onSignOut={onSignOut} minutes={2} />);
    act(() => { vi.advanceTimersByTime(58_000); });
    expect(screen.queryByTestId("dialog-idle-warning")).toBeNull();
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(screen.getByTestId("dialog-idle-warning").textContent).toMatch(/signed out in \d+ seconds/);
    fireEvent.click(screen.getByTestId("button-stay-signed-in"));
    expect(screen.queryByTestId("dialog-idle-warning")).toBeNull();
    act(() => { vi.advanceTimersByTime(90_000); });
    expect(onSignOut).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(40_000); });
    expect(onSignOut).toHaveBeenCalledTimes(1);
  }, 20_000);
  it("does nothing when disabled", () => {
    vi.useFakeTimers();
    const onSignOut = vi.fn();
    render(<IdleSignOut enabled={false} onSignOut={onSignOut} minutes={1} />);
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(onSignOut).not.toHaveBeenCalled();
  });
});

describe("two-factor setup", () => {
  it("opens the account security settings and rechecks access", () => {
    const check = vi.fn();
    render(<TwoFactorSetup onCheckAgain={check} />);
    fireEvent.click(screen.getByTestId("button-setup-two-factor"));
    expect(mocks.openUserProfile).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("button-check-two-factor"));
    expect(check).toHaveBeenCalled();
  });
});

describe("security screens", () => {
  it("describes devices simply", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iOS");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge on Windows");
    expect(deviceLabel(null)).toBe("Unknown device");
  });
  it("lists sessions and signs one out", async () => {
    mocks.revoke.mockResolvedValue({ message: "Signed out." });
    mocks.sessions = { isLoading: false, isError: false, data: {
      staffAvailable: true,
      staff: [{ sessionId: "sess_1", email: "head@school.test", role: "Administrator", lastActiveAt: new Date().toISOString(), createdAt: null }],
      students: [{ studentId: 5, studentCode: "NWE-5", name: "Ada Obi", className: "JSS 1", ref: "0123456789abcdef", createdAt: new Date().toISOString(), expiresAt: new Date().toISOString(), ip: "203.0.113.7", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36" }],
    } };
    render(wrap(<SessionsPanel />));
    expect(screen.getByTestId("staff-session-sess_1").textContent).toContain("head@school.test");
    const row = screen.getByTestId("student-session-0123456789abcdef");
    expect(row.textContent).toContain("Chrome on Windows");
    expect(row.textContent).toContain("203.0.113.7");
    fireEvent.click(row.querySelector("button")!);
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith({ data: { kind: "studentSession", ref: "0123456789abcdef" } }));
  });
  it("shows audit entries with before and after, and filters by search", () => {
    mocks.audit = { isLoading: false, isError: false, data: { total: 1, page: 1, pageSize: 50, entries: [
      { id: 9, at: new Date().toISOString(), actorKind: "staff", actorId: "u1", actorLabel: "head@school.test", action: "portal.saveStudent", targetType: "student", targetId: "5", outcome: "success", status: 200, ip: "203.0.113.7", userAgent: null, before: { name: "Ada" }, after: { student: { name: "Ada Obi", password: "[redacted]" } } },
    ] } };
    render(wrap(<AuditLogPanel />));
    const row = screen.getByTestId("audit-row-9");
    expect(row.textContent).toContain("portal.saveStudent");
    fireEvent.click(row.querySelector("button")!);
    expect(row.textContent).toContain("\"Ada Obi\"");
    expect(row.textContent).toContain("[redacted]");
    fireEvent.change(screen.getByTestId("input-audit-search"), { target: { value: "saveStudent" } });
    fireEvent.click(screen.getByTestId("button-audit-filter"));
    expect(mocks.auditParams.at(-1)).toMatchObject({ q: "saveStudent", page: 1 });
  });
});

describe("print pages under a strict security policy", () => {
  it("contain no inline scripts", () => {
    expect(loginSlipsHtml([{ studentId: "A", name: "Ada", className: "JSS 1", password: "x" }], "https://s/portal")).not.toContain("<script");
    expect(reportCardsHtml([])).not.toContain("<script");
  });
});

describe("exams and idle sign-out", () => {
  it("an exam in progress keeps other tabs from signing the student out", () => {
    vi.useFakeTimers();
    const onSignOut = vi.fn();
    function Exam() { useKeepAlive(true); return null; }
    render(<><IdleSignOut enabled onSignOut={onSignOut} minutes={2} /><Exam /></>);
    act(() => { vi.advanceTimersByTime(10 * 60_000); });
    expect(onSignOut).not.toHaveBeenCalled();
  });
});
