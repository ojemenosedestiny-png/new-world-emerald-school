import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PortalAttemptQuestionsItem } from "@workspace/api-client-react";
import { StaffEmail } from "../src/portal/director/StaffEmail";
import { QuestionCard } from "../src/portal/exam/QuestionCard";

const api = vi.hoisted(() => ({ send: vi.fn(async () => ({ id: 2, audience: "teachers", subject: "s", message: "m", recipients: 12, sent: 12, failed: 0, sentBy: "d", createdAt: "2026-10-29T08:00:00Z" })) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useListDirectorBroadcasts: () => ({ isLoading: false, isError: false, data: { counts: { teachers: 12, admins: 3, all: 14 }, emailReady: true, history: [{ id: 1, audience: "all", subject: "Welcome back", message: "x", recipients: 14, sent: 14, failed: 0, sentBy: "d", createdAt: "2026-10-28T08:00:00Z" }] } }),
  useSendDirectorBroadcast: () => ({ mutateAsync: api.send, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const wrap = (c: ReactNode) => <QueryClientProvider client={new QueryClient()}>{c}</QueryClientProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("the Director emails teachers, administrators or both, previews it, and confirms before sending", async () => {
  render(wrap(<StaffEmail />));
  expect(screen.getByTestId("panel-staff-email").textContent).not.toMatch(/student|parent/i);
  expect(screen.getByTestId("list-staff-email-history").textContent).toContain("Welcome back");
  fireEvent.click(screen.getByTestId("audience-teachers"));
  expect(screen.getByTestId("button-staff-send").textContent).toContain("Send to 12 people");
  expect((screen.getByTestId("button-staff-send") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByTestId("input-staff-subject"), { target: { value: "Staff meeting" } });
  fireEvent.change(screen.getByTestId("input-staff-message"), { target: { value: "Meet at 2pm.\n\nBring mark books." } });
  expect(screen.getByTestId("text-staff-preview-subject").textContent).toBe("Staff meeting");
  fireEvent.click(screen.getByTestId("button-staff-send"));
  fireEvent.click(screen.getByTestId("button-confirm-staff-send"));
  await waitFor(() => expect(api.send).toHaveBeenCalledWith({ data: { audience: "teachers", subject: "Staff meeting", message: "Meet at 2pm.\n\nBring mark books." } }));
});

it("after submitting, a student sees the right answer and their wrong choice, never a score", () => {
  const q = { id: "q1", type: "mcq", text: "2 + 2?", options: ["3", "4", "5"], marks: 2 } as PortalAttemptQuestionsItem;
  render(<QuestionCard q={q} index={0} value="0" onChange={() => {}} disabled review={{ questionId: "q1", correctAnswer: 1, correct: false }} />);
  expect(screen.getByTestId("verdict-q1").textContent).toContain("Wrong");
  expect(screen.getByTestId("option-q1-1").textContent).toContain("Right answer");
  expect(screen.getByTestId("option-q1-0").textContent).toContain("Your answer");
  expect(screen.getByTestId("card-question-q1").textContent).not.toMatch(/\d+ \/ 2|marks?/);
  cleanup();
  render(<QuestionCard q={q} index={0} value="" onChange={() => {}} disabled review={{ questionId: "q1", correctAnswer: 1, correct: false }} />);
  expect(screen.getByTestId("verdict-q1").textContent).toBe("Not answered");
});
