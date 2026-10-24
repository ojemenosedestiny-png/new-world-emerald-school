import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortalExam } from "@workspace/api-client-react";
import { useLockdown } from "../src/portal/exam/useLockdown";
import { blankExam, validateExam } from "../src/portal/manage/ExamEditor";

const api = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  reportPortalFocusLoss: api.report,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("lockdown", () => {
  it("counts one exit per trip away and blocks copy and paste only while active", async () => {
    let n = 0;
    api.report.mockImplementation(async () => ({ focusLosses: ++n }));
    const { result, rerender } = renderHook(({ active }) => useLockdown(42, active), { initialProps: { active: true } });
    const paste = new Event("paste", { cancelable: true });
    document.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);

    act(() => { window.dispatchEvent(new Event("blur")); });
    act(() => { window.dispatchEvent(new Event("blur")); });
    await waitFor(() => expect(result.current.exits).toBe(1));
    expect(api.report).toHaveBeenCalledTimes(1);
    expect(api.report).toHaveBeenCalledWith(42);

    // Coming back and leaving again is a second exit.
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    act(() => { window.dispatchEvent(new Event("focus")); });
    act(() => { window.dispatchEvent(new Event("blur")); });
    await waitFor(() => expect(result.current.exits).toBe(2));

    rerender({ active: false });
    const copy = new Event("copy", { cancelable: true });
    document.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(false);
    act(() => { window.dispatchEvent(new Event("blur")); });
    expect(api.report).toHaveBeenCalledTimes(2);
  });
});

describe("exam editor checks", () => {
  const q = (n: number, marks = 2) => ({ id: `q${n}`, type: "mcq" as const, text: `Q${n}`, options: ["A", "B"], correctAnswer: 0, marks });
  const exam = (over: Partial<PortalExam>): PortalExam => ({ ...blankExam(1), title: "Test", subject: "Maths", questions: [q(1), q(2), q(3)], ...over });
  it("accepts a valid question bank and refuses impossible settings", () => {
    expect(validateExam(exam({ drawCount: 2, shuffleOptions: true }), true)).toEqual([]);
    expect(validateExam(exam({ drawCount: 4 }), true).join()).toContain("cannot be more than the 3");
    expect(validateExam(exam({ drawCount: 2, questions: [q(1), q(2, 5)] }), true).join()).toContain("same marks");
    expect(validateExam(exam({ mode: "pdf", fileId: "f", shuffleQuestions: true }), true).join()).toContain("on-screen");
  });
});
