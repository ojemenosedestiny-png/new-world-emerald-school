import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { inspectKey, useExamGuard } from "../src/portal/exam/useLockdown";

afterEach(cleanup);
const k = (key: string, m: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...m });

it("knows the Inspect, view-source, save and print shortcuts, and leaves typing alone", () => {
  for (const e of [k("F12"), k("I", { ctrlKey: true, shiftKey: true }), k("j", { ctrlKey: true, shiftKey: true }), k("C", { ctrlKey: true, shiftKey: true }), k("i", { metaKey: true, altKey: true }), k("u", { ctrlKey: true }), k("s", { ctrlKey: true }), k("p", { metaKey: true })]) expect(inspectKey(e), JSON.stringify(e)).toBe(true);
  for (const e of [k("a"), k("I"), k("i", { shiftKey: true }), k("Enter"), k("c", { ctrlKey: true }), k("Backspace")]) expect(inspectKey(e), JSON.stringify(e)).toBe(false);
});

function Exam({ on }: { on: boolean }) { useExamGuard(on); return <textarea data-testid="answer" />; }

it("blocks right-click and F12 only while the exam is being written", () => {
  const { rerender, getByTestId } = render(<Exam on />);
  expect(fireEvent.contextMenu(getByTestId("answer"))).toBe(false);
  expect(fireEvent.keyDown(getByTestId("answer"), { key: "F12" })).toBe(false);
  expect(fireEvent.keyDown(getByTestId("answer"), { key: "a" })).toBe(true);
  rerender(<Exam on={false} />);
  expect(fireEvent.contextMenu(getByTestId("answer"))).toBe(true);
});
