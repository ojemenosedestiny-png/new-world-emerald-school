import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortalAttempt } from "@workspace/api-client-react";
import { getGetPortalSessionQueryKey } from "@workspace/api-client-react";
import { clearStudentQueries } from "../src/portal/lib";
import { useAttemptSync } from "../src/portal/exam/useAttemptSync";

const mocks = vi.hoisted(() => ({ save: vi.fn(), submit: vi.fn() }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useSavePortalAnswers: () => ({ mutateAsync: mocks.save }),
  useSubmitPortalAttempt: () => ({ mutateAsync: mocks.submit }),
}));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
const attempt: PortalAttempt = {
  id: 101, examId: 10, title: "QA exam", subject: "Maths", mode: "interactive", instructions: "",
  questions: [{ id: "q", text: "Explain", type: "written", options: [], marks: 3 }], answers: {},
  startedAt: new Date().toISOString(), deadline: new Date(Date.now() + 600000).toISOString(),
  serverNow: new Date().toISOString(), savedAt: new Date().toISOString(),
  status: "in_progress", totalMarks: 3, resultsReleased: false,
};
afterEach(() => {
  cleanup(); localStorage.clear(); vi.useRealTimers(); vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

describe("portal identity and answer recovery", () => {
  it("updates a mounted session observer immediately after student login", async () => {
    const { client, wrapper } = setup();
    const key = getGetPortalSessionQueryKey();
    function Session() {
      const session = useQuery({ queryKey: key, queryFn: async () => ({ role: "guest" }), initialData: { role: "guest" }, staleTime: Infinity });
      return <><span>{session.data.role}</span><button onClick={async () => {
        await clearStudentQueries(client);
        client.setQueryData(key, { role: "student" });
      }}>Sign in</button></>;
    }
    render(<Session />, { wrapper });
    fireEvent.click(screen.getByText("Sign in"));
    expect(await screen.findByText("student")).toBeTruthy();
  });
  it("shows offline truthfully and saves the latest local draft on reconnect", async () => {
    vi.useFakeTimers();
    const { wrapper } = setup();
    mocks.save.mockImplementation(async ({ data }) => ({ ...attempt, answers: data.answers }));
    const hook = renderHook(() => useAttemptSync(attempt, "QA-STUDENT"), { wrapper });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    act(() => { window.dispatchEvent(new Event("offline")); hook.result.current.setAnswer("q", "Latest offline answer"); });
    await act(async () => { vi.advanceTimersByTime(900); });
    expect(hook.result.current.state).toBe("offline");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(hook.result.current.answers.q).toBe("Latest offline answer");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(mocks.save).toHaveBeenCalledWith({ id: 101, data: { answers: { q: "Latest offline answer" } } });
    expect(hook.result.current.state).toBe("saved");
  });
  it("waits for an earlier save before submitting the newest answers", async () => {
    vi.useFakeTimers();
    const { client, wrapper } = setup();
    let resolveSave!: (value: PortalAttempt) => void;
    mocks.save.mockImplementation(() => new Promise<PortalAttempt>((resolve) => { resolveSave = resolve; }));
    mocks.submit.mockImplementation(async ({ data }) => ({ ...attempt, answers: data.answers, status: "submitted" }));
    const hook = renderHook(() => useAttemptSync(attempt, "QA-STUDENT"), { wrapper });
    act(() => hook.result.current.setAnswer("q", "First answer"));
    await act(async () => { vi.advanceTimersByTime(900); });
    act(() => hook.result.current.setAnswer("q", "Final answer"));
    let submitted!: Promise<boolean>;
    act(() => { submitted = hook.result.current.submit(); });
    expect(mocks.submit).not.toHaveBeenCalled();
    await act(async () => { resolveSave({ ...attempt, answers: { q: "First answer" } }); await submitted; });
    expect(mocks.submit).toHaveBeenCalledWith({ id: 101, data: { answers: { q: "Final answer" } } });
    expect(hook.result.current.answers.q).toBe("Final answer");
    expect(localStorage.getItem("nwe-portal-draft:QA-STUDENT:101")).toBeNull();
    const cached = client.getQueryData<PortalAttempt>(["/api/portal/attempts/101"]);
    expect(cached?.status).toBe("submitted");
  });
});
