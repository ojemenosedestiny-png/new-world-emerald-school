import assert from "node:assert/strict";
import { test } from "node:test";
import type { PortalQuestionData } from "@workspace/db";
import { buildPaper, paperSettingsProblem, paperSize } from "./cbt";
import { automaticMarks } from "./portal-assessment";

const mcq = (n: number, marks = 2): PortalQuestionData => ({ id: `q${n}`, type: "mcq", text: `Question ${n}`, options: ["A", "B", "C", "D"].map((o) => `${o}${n}`), correctAnswer: n % 4, marks });
const bank = Array.from({ length: 10 }, (_, i) => mcq(i + 1));
const off = { shuffleQuestions: false, shuffleOptions: false, drawCount: 0 };
// Deterministic "random" for repeatable tests.
function seeded(seed: number) {
  let s = seed;
  return (n: number) => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; };
}

test("cbt: settings are checked against the paper", () => {
  assert.equal(paperSettingsProblem("interactive", bank, off), null);
  assert.match(paperSettingsProblem("pdf", bank, { ...off, shuffleOptions: true })!, /PDF/);
  assert.match(paperSettingsProblem("interactive", bank, { ...off, drawCount: 11 })!, /only 10/);
  assert.match(paperSettingsProblem("interactive", [...bank, mcq(11, 5)], { ...off, drawCount: 5 })!, /same marks/);
  assert.equal(paperSettingsProblem("interactive", [...bank, mcq(11, 5)], { ...off, shuffleQuestions: true }), null, "mixed marks are fine without a draw");
  assert.match(paperSettingsProblem("interactive", bank, { ...off, drawCount: 1.5 })!, /whole number/);
});

test("cbt: with everything off the paper is unchanged", () => {
  assert.deepEqual(buildPaper(bank, off), bank);
  assert.deepEqual(paperSize(bank, 0), { questionCount: 10, totalMarks: 20 });
  assert.deepEqual(paperSize(bank, 4), { questionCount: 4, totalMarks: 8 });
});

test("cbt: a draw picks distinct questions from the bank in the teacher's order", () => {
  const paper = buildPaper(bank, { ...off, drawCount: 4 }, seeded(7));
  assert.equal(paper.length, 4);
  assert.equal(new Set(paper.map((q) => q.id)).size, 4);
  const positions = paper.map((q) => bank.findIndex((b) => b.id === q.id));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test("cbt: shuffled options keep the right answer right", () => {
  for (let seed = 1; seed < 40; seed++) {
    const paper = buildPaper(bank, { shuffleQuestions: true, shuffleOptions: true, drawCount: 0 }, seeded(seed));
    assert.deepEqual(new Set(paper.map((q) => q.id)), new Set(bank.map((q) => q.id)));
    for (const q of paper) {
      const original = bank.find((b) => b.id === q.id)!;
      assert.equal(q.options[q.correctAnswer!], original.options[original.correctAnswer!], "same option text is still the key");
      assert.deepEqual([...q.options].sort(), [...original.options].sort());
    }
    // A student choosing the right option text on the shuffled paper scores full marks.
    const answers = Object.fromEntries(paper.map((q) => [q.id, String(q.correctAnswer)]));
    assert.equal(automaticMarks(paper, answers).reduce((s, m) => s + m.score, 0), 20);
  }
});

test("cbt: written questions and missing keys survive shuffling", () => {
  const written: PortalQuestionData = { id: "w1", type: "written", text: "Explain", options: [], marks: 5 };
  const unkeyed: PortalQuestionData = { ...mcq(99), correctAnswer: null };
  const paper = buildPaper([written, unkeyed], { shuffleQuestions: false, shuffleOptions: true, drawCount: 0 }, seeded(3));
  assert.deepEqual(paper[0], written);
  assert.equal(paper[1].correctAnswer, null);
});
