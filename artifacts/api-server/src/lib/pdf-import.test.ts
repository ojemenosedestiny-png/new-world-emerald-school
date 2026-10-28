import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { diagramContentType, paperFromLayout, questionsFromText, readPdfLayout } from "./portal-pdf";

// Fixtures are made-up papers (no student data); they run from the api-server folder.
const fixture = (name: string) => readFileSync(`test-fixtures/${name}`);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test("pdf import: the SS3 mixed paper gives 20 four-option questions, its passage and both diagrams", async () => {
  const layout = await readPdfLayout(fixture("ss3-mixed-student-test.pdf"), { render: true });
  const paper = paperFromLayout(layout);
  assert.equal(paper.questions.length, 20);
  assert.deepEqual(paper.numbers, Array.from({ length: 20 }, (_, i) => i + 1));
  for (const q of paper.questions) {
    assert.equal(q.type, "mcq");
    assert.equal(q.options.length, 4, q.text);
    assert.equal(q.correctAnswer, null, "answers are never inferred");
    for (const t of [q.text, ...q.options]) assert.doesNotMatch(t, /SS3 ENGLISH|STUDENT COPY|Page \d|SECTION/i);
  }
  assert.equal(paper.questions[4].options[3], "Reading is useful only during the first term");

  // The comprehension passage is shared by Questions 1 to 5 only.
  const passage = paper.questions[0].passage ?? "";
  assert.match(passage, /^Read the passage carefully and answer Questions 1 to 5\.\n\nAt the beginning of the term/);
  assert.match(passage, /adjusted when necessary\.$/);
  paper.questions.forEach((q, i) => assert.equal(q.passage, i < 5 ? passage : undefined, `question ${i + 1}`));
  assert.ok(paper.passages.some((p) => p.from === 1 && p.to === 5));
  // Headings and instructions are kept for review, not dropped.
  assert.ok(paper.passages.some((p) => p.text === "MATHEMATICS - SECTION A" && p.from == null && p.before === 11));
  assert.ok(paper.passages.some((p) => /^Choose one answer \(A-D\)/.test(p.text) && p.before === 11));

  // The triangle (Question 18) and trapezium (Question 20) come with their labels, as pictures.
  assert.equal(layout.diagrams.length, 2);
  assert.deepEqual(paper.diagramQuestion, [17, 19]);
  assert.deepEqual([...layout.diagrams[0].labels].sort(), ["6 cm", "8 cm", "A", "B", "C"]);
  assert.deepEqual([...layout.diagrams[1].labels].sort(), ["14 cm", "5 cm", "8 cm"]);
  for (const d of layout.diagrams) assert.ok(d.image?.subarray(0, 4).equals(PNG), "diagram cropped as PNG");
  assert.equal(paper.questions[17].text, "Refer to the right-angled triangle shown. Find the length AC.");
  assert.equal(paper.questions[19].text, "The diagram shows a trapezium. Find its area.");
  assert.deepEqual(paper.questions[19].options, ["45 cm^2", "50 cm^2", "55 cm^2", "70 cm^2"]);
  assert.doesNotMatch(paper.text, /STUDENT COPY|Page 1 of 5/);
  assert.ok(!paper.text.split("\n").some((l) => /^(14|8|5|6) cm$/.test(l)), "labels are not loose text lines");
});

test("pdf import: inline options, instruction ranges, page furniture and drawn diagrams on another layout", async () => {
  const layout = await readPdfLayout(fixture("mixed-paper.pdf"));
  const paper = paperFromLayout(layout);
  assert.equal(paper.questions.length, 20);
  assert.ok(paper.questions.every((q) => q.options.length === 4));
  assert.deepEqual(paper.questions[5].options, ["Roomy", "Narrow", "Dirty", "Noisy"]);
  assert.equal(paper.questions[4].options[3], "Reading is useful only during the first term");
  assert.match(paper.questions[5].passage ?? "", /^For Questions 6 to 8/);
  assert.equal(paper.questions[8].passage, undefined);
  assert.deepEqual(paper.diagramQuestion, [17, 19]);
  assert.ok(layout.diagrams.every((d) => d.image === undefined), "no pictures unless rendering is asked for");
  assert.ok(paper.questions.every((q) => !/\b\d+ cm\b/.test(q.text)), "diagram labels stay out of the stems");
});

test("pdf import: an answer choice ends at a heading, and passage ranges follow restarted numbering", () => {
  const text = [
    "SECTION A",
    "1. First?", "A. one", "B. two",
    "2. Second?  A. yes  B. no  C. maybe",
    "SECTION B",
    "Read the poem and answer Questions 1 and 2.",
    "The rain came down.",
    "1. What came down?", "A. Rain", "B. Snow",
    "2. When?", "A. Today", "B. Never",
  ].join("\n");
  const questions = questionsFromText(text);
  assert.equal(questions.length, 4);
  assert.deepEqual(questions[1].options, ["yes", "no", "maybe"]);
  assert.equal(questions[0].passage, undefined, "the second section's passage does not reach back to section A");
  assert.equal(questions[1].passage, undefined);
  assert.match(questions[2].passage ?? "", /^Read the poem/);
  assert.equal(questions[3].passage, questions[2].passage);
});

test("pdf import: diagram files are told apart from papers by name", () => {
  assert.equal(diagramContentType("cloudinary:nwe/portal/diagrams/x.png"), "image/png");
  assert.equal(diagramContentType("diagram-x.jpg"), "image/jpeg");
  assert.equal(diagramContentType("cloudinary:nwe/portal/files/x.pdf"), null);
  assert.equal(diagramContentType("3f2b0c1e-0000-4000-8000-000000000000"), null);
});
