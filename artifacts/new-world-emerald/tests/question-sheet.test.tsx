import { deflateRawSync } from "node:zlib";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PortalManagement } from "@workspace/api-client-react";
import { parseCsv, questionTemplate, readQuestionSheet } from "../src/portal/manage/questionSheet";
import { ExamEditor, blankExam } from "../src/portal/manage/ExamEditor";

vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useImportPortalPdf: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("../src/portal/manage/useCommand", () => ({ useCommand: () => ({ run: vi.fn(async () => true), pending: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
afterEach(() => cleanup());

/** A compressed zip, the way Excel itself saves a workbook. */
function zipDeflated(files: [string, string][]) {
  const parts: Buffer[] = [], dir: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const n = Buffer.from(name), raw = Buffer.from(text), data = deflateRawSync(raw);
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(8, 8); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(n.length, 26);
    const d = Buffer.alloc(46); d.writeUInt32LE(0x02014b50, 0); d.writeUInt16LE(8, 10); d.writeUInt32LE(data.length, 20); d.writeUInt32LE(raw.length, 24); d.writeUInt16LE(n.length, 28); d.writeUInt32LE(offset, 42);
    parts.push(head, n, data); dir.push(d, n);
    offset += 30 + n.length + data.length;
  }
  const size = dir.reduce((s, x) => s + x.length, 0);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, ...dir, end]));
}

const S = (i: number) => ({ t: "s", v: String(i) });
const N = (v: string, s?: number) => ({ v, s });
type Cell = { t?: string; v: string; s?: number } | null;
const sheet = (rows: Cell[][], merges = "") => `<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${rows.map((r, y) => `<x:row r="${y + 1}">${r.map((c, i) => c ? `<x:c r="${String.fromCharCode(65 + i)}${y + 1}"${c.t ? ` t="${c.t}"` : ""}${c.s != null ? ` s="${c.s}"` : ""}><x:v>${c.v}</x:v></x:c>` : "").join("")}</x:row>`).join("")}</x:sheetData>${merges}</x:worksheet>`;

function excelLikeWorkbook() {
  const strings = [
    "JSS 2 Basic Science (Second Term)", "Question", "Option A", "Option B", "Option C", "Option D", "Correct answer", "Marks", "Comprehension",
    "1. Which of these is a mammal?", "A. Shark", "Whale", "Frog", "Answer this", // 9-13
    "Read the passage.\nThe sun rises in the east.", // 14
    "Where does the sun rise?", "East", "West", "North", "South", // 15-19
    "What is 0.1 + 0.2?", "Pick the closing date", "Rich", "Duplicate", "Same", "Same ", "Define osmosis", "Movement of water", "written", "Hidden", // 20-29
  ];
  const sst = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((s, i) => i === 22
    ? `<si><r><rPr><b/></rPr><t>Which word is </t></r><r><t xml:space="preserve">in bold_x000D_
type?</t></r><rPh><t>ignored</t></rPh></si>`
    : `<si><t xml:space="preserve">${s.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</t></si>`).join("")}</sst>`;
  const styles = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\-mmm\\-yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="9"/></cellXfs></styleSheet>`;
  const rows: Cell[][] = [
    [S(0)],
    [S(1), S(2), S(3), S(4), S(5), S(6), S(7), S(8)],
    [S(9), S(10), S(11), S(12), null, S(11), N("2"), null], // answer by text; "A. " dropped; D empty
    [S(15), S(16), S(17), S(18), S(19), N("1"), N("1"), S(14)], // answer as number 1 -> A; passage merged down
    [S(20), N("0.30000000000000004"), N("0.3"), N("3"), N("0.2"), { t: "str", v: "B" }, N("1"), null], // passage via merge
    [S(21), N("46000", 1), N("46001", 1), N("0.5", 2), null, { t: "s", v: "13" }, N("250"), null], // dates, percent, bad answer, bad marks
    [{ t: "s", v: "22" }, S(24), S(25), null, null, null, null, null], // rich text, duplicate choices
    [null, S(16), S(17)], // choices but no question
    [S(26), null, null, null, null, S(27), N("4"), null],
  ];
  rows[8][6] = N("4");
  const main = sheet(rows, '<x:mergeCells count="1"><x:mergeCell ref="H4:H5"/></x:mergeCells>');
  const hidden = sheet([[S(1)], [S(29)]]);
  return zipDeflated([
    ["[Content_Types].xml", "<Types/>"],
    ["xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Old" sheetId="2" state="hidden" r:id="rId2"/><sheet name="Paper" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ["xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>'],
    ["xl/sharedStrings.xml", sst],
    ["xl/styles.xml", styles],
    ["xl/worksheets/sheet1.xml", main],
    ["xl/worksheets/sheet2.xml", hidden],
  ]);
}

it("reads the downloadable template back as three ready questions", async () => {
  const r = await readQuestionSheet(questionTemplate(), "exam-questions-template.xlsx");
  expect(r.sheet).toBe("Questions");
  expect(r.questions.map((q) => [q.type, q.text, q.options, q.correctAnswer, q.marks])).toEqual([
    ["mcq", "What is the capital of Nigeria?", ["Lagos", "Abuja", "Kano", "Ibadan"], 1, 1],
    ["mcq", "Water boils at what temperature at sea level?", ["50 °C", "80 °C", "100 °C", "120 °C"], 2, 1],
    ["written", "Explain why green plants need sunlight.", [], null, 5],
  ]);
  expect(r.questions[2].rubric).toContain("photosynthesis");
  expect(r.notes).toEqual([]);
  expect(new Set(r.questions.map((q) => q.id)).size).toBe(3);
});

it("keeps every question whole from a workbook saved by Excel", async () => {
  const r = await readQuestionSheet(excelLikeWorkbook(), "science.xlsx");
  expect(r.sheet).toBe("Paper");
  const [mammal, sun, sum, date, rich, osmosis] = r.questions;
  expect(r.questions).toHaveLength(6);
  // Numbering and the "A." prefix in column A are dropped; the empty D column is left out and the key follows the text.
  expect(mammal).toMatchObject({ type: "mcq", text: "Which of these is a mammal?", options: ["Shark", "Whale", "Frog"], correctAnswer: 1, marks: 2 });
  expect(mammal.passage).toBeUndefined();
  // A passage merged down two rows belongs to both questions, line break kept.
  expect(sun).toMatchObject({ options: ["East", "West", "North", "South"], correctAnswer: 0, passage: "Read the passage.\nThe sun rises in the east." });
  expect(sum.passage).toBe(sun.passage);
  // Numbers read as Excel shows them, not as floating-point noise.
  expect(sum.options).toEqual(["0.3", "0.3", "3", "0.2"]);
  expect(sum.correctAnswer).toBe(1);
  // Dates and percentages as written in the cells; a wrong answer and wrong marks are flagged, not guessed.
  expect(date.options).toEqual(["09/12/2025", "10/12/2025", "50%"]);
  expect(date.correctAnswer).toBeNull();
  expect(date.marks).toBe(1);
  // Rich text joined, Excel's _x000D_ return kept as a line break, phonetic guide left out.
  expect(rich.text).toBe("Which word is in bold\ntype?");
  expect(osmosis).toMatchObject({ type: "written", options: [], rubric: "Answer: Movement of water", marks: 4 });
  const noteText = r.notes.map((n) => `${n.index}:${n.message}`).join("\n");
  expect(noteText).toContain("2:Row 5 of the sheet: two choices are the same (\"0.3\")");
  expect(noteText).toContain("3:Row 6 of the sheet: the marks \"250\"");
  expect(noteText).toContain("3:Row 6 of the sheet: the answer \"Answer this\" does not match any choice");
  expect(noteText).toContain("4:Row 7 of the sheet: two choices are the same");
  expect(r.general).toContain("Row 8 has choices but no question, so it was skipped.");
  expect(r.keys).toBe(3);
  expect(r.mcq).toBe(5);
});

it("reads CSV from Excel, with semicolons, quotes and line breaks in a cell", async () => {
  const csv = "﻿Question;A;B;C;D;Answer;Marks\r\n\"Read: \"\"Ada said, hello\"\".\nWho spoke?\";Ada;Obi;Musa;Ngozi;a;1\r\n;;;;;;\r\n2) Pick 7;5;7;9;11;7;2\r\n";
  expect(parseCsv(csv)[1][0]).toBe('Read: "Ada said, hello".\nWho spoke?');
  const r = await readQuestionSheet(new TextEncoder().encode(csv), "paper.csv");
  expect(r.questions.map((q) => [q.text, q.options, q.correctAnswer, q.marks])).toEqual([
    ['Read: "Ada said, hello".\nWho spoke?', ["Ada", "Obi", "Musa", "Ngozi"], 0, 1],
    ["Pick 7", ["5", "7", "9", "11"], 1, 2],
  ]);
});

it("explains files it cannot use instead of importing something broken", async () => {
  await expect(readQuestionSheet(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), "old.xls")).rejects.toThrow(/97-2003/);
  await expect(readQuestionSheet(new TextEncoder().encode("Name,Class\nAda,JSS 1\n"), "list.csv")).rejects.toThrow(/No "Question" column/);
  await expect(readQuestionSheet(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9]), "broken.xlsx")).rejects.toThrow(/could not be read/);
});

it("adds the sheet's questions to the exam editor after those already there, with notes", async () => {
  const data = { classes: [{ id: 1, name: "JSS 2" }], students: [], teachers: [], exams: [], attempts: [], materials: [], notices: [] } as unknown as PortalManagement;
  const first = { id: "q-keep", type: "written" as const, text: "Existing question", options: [], marks: 2, correctAnswer: null };
  render(<ExamEditor data={data} initial={{ ...blankExam(1), questions: [first] }} onClose={() => {}} />);
  expect(screen.getByTestId("panel-excel-import").textContent).toContain("Upload questions from Excel");
  const csv = "Question,A,B,C,D,Answer,Marks\nCapital of Nigeria?,Lagos,Abuja,Kano,Ibadan,Z,1\n";
  fireEvent.change(screen.getByTestId("input-excel-file"), { target: { files: [new File([csv], "jss2.csv", { type: "text/csv" })] } });
  await waitFor(() => expect(screen.getByTestId("summary-excel-import").textContent).toContain("1 question added from jss2.csv, after the 1 already here."));
  expect((screen.getByTestId("input-qtext-0") as HTMLTextAreaElement).value).toBe("Existing question");
  expect((screen.getByTestId("input-qtext-1") as HTMLTextAreaElement).value).toBe("Capital of Nigeria?");
  expect((screen.getByTestId("input-option-1-1") as HTMLInputElement).value).toBe("Abuja");
  expect(screen.getByTestId("note-q-1").textContent).toContain("the answer \"Z\" does not match any choice");
  expect(screen.getByTestId("text-excel-keys").textContent).toContain("0 of 1");
});
