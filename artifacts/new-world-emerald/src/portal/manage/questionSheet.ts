import type { PortalExamQuestionsItem } from "@workspace/api-client-react";
import { OPTION_LETTERS, newQuestionId } from "../lib";

/**
 * Reads exam questions from an Excel workbook (.xlsx) or a CSV file, one question per row, in the browser.
 * Nothing is sent anywhere: the rows become draft questions in the exam editor, which staff check and save
 * through the usual exam checks. A cell's words are kept exactly (line breaks, symbols, numbers such as 0.5
 * or 100, dates and percentages as Excel shows them); only a leading "1." on a question and "A." on a choice
 * in its own column are removed, because the editor numbers and letters them already.
 */
type Q = PortalExamQuestionsItem;
export const MAX_SHEET = 5 * 1024 * 1024;
const MAX_QUESTIONS = 200;
const LIMIT = { text: 12000, option: 3000, passage: 20000, rubric: 5000 };

export class SheetError extends Error {}
export type SheetResult = { questions: Q[]; notes: { index: number; message: string }[]; general: string[]; sheet: string; keys: number; mcq: number };

const NOT_READABLE = "This file could not be read as an Excel workbook. In Excel choose File > Save As > Excel Workbook (.xlsx), or CSV, and upload it again.";

// ---------- .xlsx: a zip of XML files ----------
type Entry = { method: number; size: number; full: number; offset: number };
function zipEntries(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new SheetError(NOT_READABLE);
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const out = new Map<string, Entry>();
  const names = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (p + 46 > b.length || v.getUint32(p, true) !== 0x02014b50) throw new SheetError(NOT_READABLE);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    if (local + 30 > b.length || v.getUint32(local, true) !== 0x04034b50) throw new SheetError(NOT_READABLE);
    const name = names.decode(b.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
    out.set(name, { method: v.getUint16(p + 10, true), size: v.getUint32(p + 20, true), full: v.getUint32(p + 24, true), offset: local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true) });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

async function unzipText(b: Uint8Array, e: Entry | undefined): Promise<string | null> {
  if (!e) return null;
  if (e.full > 60 * 1024 * 1024) throw new SheetError("This workbook is too large. Keep only the questions sheet and try again.");
  const raw = b.slice(e.offset, e.offset + e.size);
  if (e.method === 0) return new TextDecoder().decode(raw);
  if (e.method !== 8) throw new SheetError(NOT_READABLE);
  const stream = new Response(raw as unknown as BodyInit).body!.pipeThrough(new DecompressionStream("deflate-raw"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

function xml(text: string) {
  const d = new DOMParser().parseFromString(text, "application/xml");
  if (d.getElementsByTagName("parsererror").length) throw new SheetError(NOT_READABLE);
  return d;
}
const all = (n: Document | Element, tag: string) => Array.from(n.getElementsByTagNameNS("*", tag));
const attr = (el: Element, local: string) => el.getAttribute(local) ?? Array.from(el.attributes).find((a) => a.localName === local)?.value ?? null;
// Excel writes some characters as _xHHHH_ (a carriage return is _x000D_); _x005F_ is a literal underscore.
const unescape = (s: string) => s.replace(/_x([0-9a-fA-F]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/\r\n?/g, "\n");
// Rich text runs are joined; phonetic guides (rPh) are not part of the words.
const runText = (el: Element) => unescape(all(el, "t").filter((t) => t.parentElement?.localName !== "rPh").map((t) => t.textContent ?? "").join(""));

type Kind = "general" | "date" | "time" | "datetime" | "percent";
function formatKind(id: number, code: string | undefined): Kind {
  if (id >= 14 && id <= 17) return "date";
  if ((id >= 18 && id <= 21) || (id >= 45 && id <= 47)) return "time";
  if (id === 22) return "datetime";
  if (id === 9 || id === 10) return "percent";
  if (!code) return "general";
  const c = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "").split(";")[0];
  if (c.includes("%")) return "percent";
  const d = /[dy]/i.test(c), t = /[hs]/i.test(c);
  if (d && t) return "datetime";
  if (d || (!t && /m/i.test(c))) return "date";
  return t ? "time" : "general";
}
const plain = (n: number) => String(Number(n.toPrecision(15)));
const two = (n: number) => String(n).padStart(2, "0");
function serial(n: number, kind: Kind, date1904: boolean) {
  if (kind === "percent") return plain(n * 100) + "%";
  if (kind === "general") return plain(n);
  const d = new Date(Math.round(((date1904 ? n + 1462 : n) - 25569) * 86400) * 1000);
  if (Number.isNaN(d.getTime())) return plain(n);
  const day = `${two(d.getUTCDate())}/${two(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`, time = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
  return kind === "date" ? day : kind === "time" ? time : `${day} ${time}`;
}

function colNumber(ref: string) {
  const m = /^([A-Z]+)/i.exec(ref);
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

async function readWorkbook(b: Uint8Array): Promise<{ name: string; rows: string[][] }[]> {
  const files = zipEntries(b);
  const get = (path: string) => unzipText(b, files.get(path.toLowerCase()));
  const book = await get("xl/workbook.xml");
  if (!book) throw new SheetError(NOT_READABLE);
  const wb = xml(book);
  const date1904 = all(wb, "workbookPr").some((p) => ["1", "true"].includes(attr(p, "date1904") ?? ""));
  const relsText = await get("xl/_rels/workbook.xml.rels");
  const targets = new Map<string, string>();
  if (relsText) for (const r of all(xml(relsText), "Relationship")) {
    const t = (attr(r, "Target") ?? "").replace(/\\/g, "/");
    targets.set(attr(r, "Id") ?? "", t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, ""));
  }
  const sharedText = await get("xl/sharedStrings.xml");
  const shared = sharedText ? all(xml(sharedText), "si").map(runText) : [];
  const stylesText = await get("xl/styles.xml");
  const kinds: Kind[] = [];
  if (stylesText) {
    const st = xml(stylesText);
    const codes = new Map(all(st, "numFmt").map((f) => [Number(attr(f, "numFmtId")), attr(f, "formatCode") ?? ""]));
    const xfs = all(st, "cellXfs")[0];
    if (xfs) for (const xf of Array.from(xfs.children).filter((c) => c.localName === "xf")) {
      const id = Number(attr(xf, "numFmtId") ?? 0);
      kinds.push(formatKind(id, codes.get(id)));
    }
  }
  const sheets: { name: string; rows: string[][] }[] = [];
  const list = all(wb, "sheet").filter((s) => !["hidden", "veryHidden"].includes(attr(s, "state") ?? ""));
  for (const [k, s] of list.entries()) {
    const text = (await get(targets.get(attr(s, "id") ?? "") ?? "")) ?? (k === 0 ? await get("xl/worksheets/sheet1.xml") : null);
    if (!text) continue;
    const doc = xml(text);
    const rows: string[][] = [];
    let r = -1;
    for (const row of all(doc, "row")) {
      r = Number(attr(row, "r") ?? r + 2) - 1;
      if (r > 5000) break;
      const cells: string[] = (rows[r] = []);
      let c = -1;
      for (const cell of Array.from(row.children).filter((x) => x.localName === "c")) {
        const ref = attr(cell, "r");
        c = ref ? colNumber(ref) : c + 1;
        if (c < 0 || c > 60) continue;
        const t = attr(cell, "t") ?? "n";
        const v = all(cell, "v")[0]?.textContent ?? "";
        let value = "";
        if (t === "s") value = shared[Number(v)] ?? "";
        else if (t === "inlineStr") value = runText(cell);
        else if (t === "str" || t === "e") value = unescape(v);
        else if (t === "b") value = v === "1" ? "TRUE" : v === "0" ? "FALSE" : v;
        else if (v !== "") {
          const n = Number(v);
          value = Number.isFinite(n) ? serial(n, kinds[Number(attr(cell, "s") ?? 0)] ?? "general", date1904) : v;
        }
        cells[c] = value;
      }
    }
    // A cell merged down several rows (a passage shared by Questions 1 to 5) belongs to each of those rows.
    for (const m of all(doc, "mergeCell")) {
      const [a, z] = (attr(m, "ref") ?? "").split(":");
      if (!a || !z) continue;
      const col = colNumber(a), top = Number(/\d+/.exec(a)?.[0]) - 1, bottom = Number(/\d+/.exec(z)?.[0]) - 1;
      const value = rows[top]?.[col];
      if (!value || col < 0 || bottom > top + 1000) continue;
      for (let y = top + 1; y <= bottom; y++) { rows[y] ??= []; if (!rows[y][col]) rows[y][col] = value; }
    }
    sheets.push({ name: attr(s, "name") ?? `Sheet ${k + 1}`, rows: Array.from(rows, (x) => Array.from(x ?? [], (y) => y ?? "")) });
  }
  return sheets;
}

// ---------- CSV (Excel's "CSV UTF-8", plain CSV, semicolon CSV and "Unicode Text") ----------
function decodeText(b: Uint8Array) {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(b); }
  catch { return new TextDecoder("windows-1252").decode(b); }
}
export function parseCsv(input: string): string[][] {
  let text = input.replace(/^﻿/, "");
  let sep = "";
  const hint = /^sep=(.)\r?\n/i.exec(text);
  if (hint) { sep = hint[1]; text = text.slice(hint[0].length); }
  if (!sep) {
    const first = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
    const outside = first.replace(/"[^"]*"/g, "");
    const counts = [",", ";", "\t"].map((d) => [d, outside.split(d).length - 1] as const).sort((x, y) => y[1] - x[1]);
    sep = counts[0][1] > 0 ? counts[0][0] : ",";
  }
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.replace(/\r\n?/g, "\n")));
}

// ---------- rows to questions ----------
type Role = { k: "question" | "answer" | "marks" | "type" | "passage" | "rubric" | "picture" } | { k: "option"; i: number };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function role(header: string): Role | null {
  const n = norm(header);
  if (!n) return null;
  if (["question", "questions", "questiontext", "q", "text"].includes(n)) return { k: "question" };
  let m = /^(?:option|choice|opt)?([a-h])$/.exec(n);
  if (m) return { k: "option", i: m[1].charCodeAt(0) - 97 };
  m = /^(?:option|choice|opt)([1-8])$/.exec(n);
  if (m) return { k: "option", i: Number(m[1]) - 1 };
  if (["answer", "answers", "correctanswer", "correct", "correctoption", "key", "answerkey", "ans"].includes(n)) return { k: "answer" };
  if (["marks", "mark", "score", "scores", "points", "point", "pts"].includes(n)) return { k: "marks" };
  if (["type", "questiontype", "kind", "format"].includes(n)) return { k: "type" };
  if (["passage", "comprehension", "passagetext", "sharedpassage", "readingpassage", "context"].includes(n)) return { k: "passage" };
  if (["markingguide", "rubric", "guide", "modelanswer", "markingscheme"].includes(n)) return { k: "rubric" };
  if (["diagram", "image", "picture", "figure", "photo"].includes(n)) return { k: "picture" };
  return null;
}

function typeOf(value: string): Q["type"] | null {
  const n = norm(value);
  if (!n) return null;
  if (["mcq", "multiplechoice", "objective", "obj", "choice", "options"].includes(n)) return "mcq";
  if (["written", "theory", "essay", "shortanswer", "subjective", "open", "text"].includes(n)) return "written";
  return null;
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function questionsFromRows(sheets: { name: string; rows: string[][] }[]): SheetResult {
  let picked: { name: string; rows: string[][]; header: number; cols: Map<number, Role> } | null = null;
  for (const s of sheets) {
    for (let r = 0; r < Math.min(10, s.rows.length) && !picked; r++) {
      const cols = new Map<number, Role>();
      const seen = new Set<string>();
      (s.rows[r] ?? []).forEach((h, c) => {
        const x = role(h ?? "");
        const key = x ? (x.k === "option" ? "o" + x.i : x.k) : "";
        if (x && !seen.has(key)) { seen.add(key); cols.set(c, x); }
      });
      if (seen.has("question")) picked = { ...s, header: r, cols };
    }
    if (picked) break;
  }
  if (!picked) throw new SheetError("No \"Question\" column was found. Put the headings Question, A, B, C, D, Answer and Marks in the first row (download the template to see how).");

  const at = (row: string[], k: string, i?: number) => {
    for (const [c, x] of picked!.cols) if (x.k === k && (i == null || (x.k === "option" && x.i === i))) return (row[c] ?? "").trim();
    return "";
  };
  const questions: Q[] = [];
  const notes: { index: number; message: string }[] = [];
  const general: string[] = [];
  let keys = 0, mcq = 0, pictures = false, stopped = false;
  const stamp = newQuestionId();
  for (let r = picked.header + 1; r < picked.rows.length; r++) {
    const row = picked.rows[r] ?? [];
    if (!row.some((c) => c && c.trim())) continue;
    const where = `Row ${r + 1}`;
    const raw = at(row, "question");
    const options = OPTION_LETTERS.map((_, i) => at(row, "option", i));
    const answer = at(row, "answer");
    if (at(row, "picture")) pictures = true;
    if (!raw) {
      if (options.some(Boolean) || answer) general.push(`${where} has choices but no question, so it was skipped.`);
      continue;
    }
    if (questions.length >= MAX_QUESTIONS) { stopped = true; break; }
    const index = questions.length;
    const note = (message: string) => notes.push({ index, message: `${where} of the sheet: ${message}` });
    const fit = (value: string, max: number, what: string) => {
      if (value.length <= max) return value;
      note(`the ${what} was longer than ${max.toLocaleString()} characters and was cut short. Check the end of it.`);
      return value.slice(0, max);
    };
    // "1. What is..." or "Q1) What is...": the editor numbers questions itself.
    const text = fit(raw.replace(/^(?:q(?:uestion)?\s*)?\d{1,3}\s*[.):]\s+(?=\S)/i, ""), LIMIT.text, "question");
    // "A. Lagos" in column A: the editor letters the choices itself.
    const choices = options.map((o, i) => o.replace(new RegExp(`^\\(?${OPTION_LETTERS[i]}[.)]\\s+(?=\\S)`, "i"), ""));
    const filled = choices.map((t, orig) => ({ t, orig })).filter((x) => x.t);
    const typed = typeOf(at(row, "type"));
    const type: Q["type"] = typed ?? (filled.length ? "mcq" : "written");
    let marks = 1;
    const m = at(row, "marks");
    if (m) {
      const n = Number(/^\d+(?:\.\d+)?/.exec(m.replace(",", "."))?.[0]);
      if (n >= 0.5 && n <= 100) marks = n; else note(`the marks "${m}" are not between 0.5 and 100, so it was set to 1.`);
    }
    const q: Q = { id: `${stamp}-x${index}`, type, text, options: [], marks, correctAnswer: null };
    const passage = at(row, "passage");
    if (passage) q.passage = fit(passage, LIMIT.passage, "passage");
    if (type === "mcq") {
      mcq++;
      q.options = filled.map((x) => fit(x.t, LIMIT.option, `choice ${OPTION_LETTERS[x.orig]}`));
      if (filled.length < 2) note("a multiple-choice question needs at least 2 choices. Add them below or change it to Written.");
      const dup = q.options.find((o, i) => q.options.findIndex((p) => squash(p) === squash(o)) !== i);
      if (dup) note(`two choices are the same ("${dup}"). Change one before saving.`);
      if (answer) {
        const exact = q.options.findIndex((o) => squash(o) === squash(answer));
        const letter = /^\(?(?:option\s*)?([a-h])\)?\.?$/i.exec(answer);
        const number = /^[1-8]$/.test(answer) && !q.options.every((o) => /^-?\d/.test(o)) ? Number(answer) - 1 : -1;
        const orig = letter ? letter[1].toUpperCase().charCodeAt(0) - 65 : number;
        const key = exact >= 0 ? exact : orig >= 0 ? filled.findIndex((x) => x.orig === orig) : -1;
        if (key >= 0) { q.correctAnswer = key; keys++; }
        else note(`the answer "${answer}" does not match any choice, so no answer was chosen. Select the right one yourself.`);
      }
    } else {
      if (typed === "written" && filled.length) note("it is marked Written, so its choices were left out.");
      const guide = at(row, "rubric") || (answer ? `Answer: ${answer}` : "");
      if (guide) q.rubric = fit(guide, LIMIT.rubric, "marking guide");
    }
    questions.push(q);
  }
  if (stopped) general.push(`An exam holds at most ${MAX_QUESTIONS} questions, so only the first ${MAX_QUESTIONS} rows were read.`);
  if (pictures) general.push("Pictures are not read from Excel. Use \"Add diagram\" on each question that needs one.");
  if (!questions.length) general.unshift("No questions were found under the headings. Type one question per row below the heading row.");
  return { questions, notes, general, sheet: picked.name, keys, mcq };
}

export async function readQuestionSheet(bytes: Uint8Array, fileName: string): Promise<SheetResult> {
  if (bytes.length > MAX_SHEET) throw new SheetError("The file is larger than 5 MB. Keep only the questions sheet and try again.");
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new SheetError("This is an old Excel 97-2003 (.xls) file. In Excel choose File > Save As > Excel Workbook (.xlsx) and upload that.");
  if (zip) return questionsFromRows(await readWorkbook(bytes));
  if (/\.(xlsx|xlsm|xls|ods|numbers)$/i.test(fileName)) throw new SheetError(NOT_READABLE);
  return questionsFromRows([{ name: fileName, rows: parseCsv(decodeText(bytes)) }]);
}

// ---------- the template teachers download ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** A stored (uncompressed) zip: small, and opened by Excel, Google Sheets and LibreOffice. */
export function zipStore(files: [string, string][]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const n = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const head = new Uint8Array(30 + n.length), hv = new DataView(head.buffer);
    hv.setUint32(0, 0x04034b50, true); hv.setUint16(4, 20, true); hv.setUint16(6, 0x0800, true); hv.setUint32(14, crc, true); hv.setUint32(18, data.length, true); hv.setUint32(22, data.length, true); hv.setUint16(26, n.length, true);
    head.set(n, 30);
    const dir = new Uint8Array(46 + n.length), dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true); dv.setUint16(8, 0x0800, true); dv.setUint32(16, crc, true); dv.setUint32(20, data.length, true); dv.setUint32(24, data.length, true); dv.setUint16(28, n.length, true); dv.setUint32(42, offset, true);
    dir.set(n, 46);
    parts.push(head, data); central.push(dir);
    offset += head.length + data.length;
  }
  const size = central.reduce((s, x) => s + x.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let p = 0;
  for (const x of [...parts, ...central, end]) { out.set(x, p); p += x.length; }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i: number) => String.fromCharCode(65 + i);
function sheetXml(rows: string[][], widths: number[], headerStyle: boolean) {
  const body = rows.map((r, y) => `<row r="${y + 1}">${r.map((v, x) => (v === "" ? "" : /^\d+(\.\d+)?$/.test(v) && x > 0 ? `<c r="${colName(x)}${y + 1}"><v>${v}</v></c>` : `<c r="${colName(x)}${y + 1}" t="inlineStr"${headerStyle && y === 0 ? ' s="1"' : ' s="2"'}><is><t xml:space="preserve">${esc(v)}</t></is></c>`)).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${headerStyle ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ""}</sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${body}</sheetData></worksheet>`;
}

export const TEMPLATE_HEADINGS = ["Question", "A", "B", "C", "D", "Answer", "Marks", "Type", "Passage", "Marking guide"];
export function questionTemplate(): Uint8Array {
  const rows = [
    TEMPLATE_HEADINGS,
    ["What is the capital of Nigeria?", "Lagos", "Abuja", "Kano", "Ibadan", "B", "1", "Multiple choice", "", ""],
    ["Water boils at what temperature at sea level?", "50 °C", "80 °C", "100 °C", "120 °C", "C", "1", "Multiple choice", "", ""],
    ["Explain why green plants need sunlight.", "", "", "", "", "", "5", "Written", "", "Mentions photosynthesis and food (glucose) made in the leaves."],
  ];
  const help = [
    ["How to fill the Questions sheet"],
    ["One question per row. Keep the headings in row 1."],
    ["Question: the question exactly as students should read it. Line breaks inside a cell are kept."],
    ["A, B, C, D: the choices. Add columns E to H for more. Leave them empty for a written question."],
    ["Answer: the letter of the right choice (A, B, C ...). You will still check every answer before publishing."],
    ["Marks: from 0.5 to 100. Empty means 1."],
    ["Type: Multiple choice or Written. Empty means multiple choice when there are choices."],
    ["Passage: optional reading passage shown above the question. Repeat it, or merge the cells down, for every question it belongs to."],
    ["Marking guide: optional notes for marking written answers. Students never see it."],
    ["Diagrams: add them in the portal with \"Add diagram\" after uploading."],
    ["Save as Excel Workbook (.xlsx) or CSV, then choose Upload Excel in the exam."],
  ];
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  return zipStore([
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${ns}><sheets><sheet name="Questions" sheetId="1" r:id="rId1"/><sheet name="How to fill" sheetId="2" r:id="rId2"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ["xl/styles.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F5E3E"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ["xl/worksheets/sheet1.xml", sheetXml(rows, [52, 18, 18, 18, 18, 9, 8, 16, 40, 40], true)],
    ["xl/worksheets/sheet2.xml", sheetXml(help, [110], false)],
  ]);
}

export function downloadQuestionTemplate() {
  const blob = new Blob([questionTemplate() as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "exam-questions-template.xlsx";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
