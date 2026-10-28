import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { PortalQuestionData } from "@workspace/db";

// Deterministic import: retain the wording and never invent an answer key.
// Unrecognized/scanned layouts remain usable through the original-PDF mode.

/** A line of text on a page, in points from the top-left corner. Diagram labels and page furniture are not lines. */
export interface PdfLine { page: number; text: string; x: number; top: number; bottom: number }
/** A drawing (vector paths or a picture) with its text labels, in points from the top-left corner. */
export interface PdfDiagram { page: number; x0: number; top: number; x1: number; bottom: number; labels: string[]; image?: Buffer }
export interface PdfLayout { pages: { width: number; height: number }[]; lines: PdfLine[]; diagrams: PdfDiagram[] }

/** Text found between questions: a passage or instruction, and the question numbers it says it is for. */
export interface ImportedPassage { text: string; from: number | null; to: number | null; before: number | null }
export interface ImportedPaper {
  questions: PortalQuestionData[];
  /** The printed number of each question, in the same order. */
  numbers: number[];
  passages: ImportedPassage[];
  /** For each diagram in the layout, the index of the question it belongs to (null when there is none). */
  diagramQuestion: (number | null)[];
  /** The paper's text without headers, footers, page numbers or diagram labels, for staff to check against. */
  text: string;
}

const QUESTION = /^(?:question\s+)?(\d{1,3})\s*[.)]\s+(?=\S)|^question\s+(\d{1,3})\s*[:.)-]?\s*/i;
const OPTION = /(?:^|\s)(?:\(([A-Ha-h])\)|([A-Ha-h])[.)])\s+(?=\S)/g;
const OPTION_START = /^(?:\(([A-Ha-h])\)|([A-Ha-h])[.)])\s+\S/;
const RANGE = /questions?\s+(\d{1,3})\s*(?:to|-|–|—|through|and)\s*(\d{1,3})/i;
const PAGE_NUMBER = /^(?:page\s*)?#(?:\s*(?:of|\/)\s*#)?$|^[-–]\s*#\s*[-–]$/;

/** Diagram pictures are stored as portal files named with an image extension; papers are PDFs. */
export function diagramContentType(objectName: string) {
  const ext = objectName.match(/\.(png|jpg|webp)$/)?.[1];
  return ext === "png" ? "image/png" : ext === "jpg" ? "image/jpeg" : ext === "webp" ? "image/webp" : null;
}

const furnitureKey = (text: string) => text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
/** A section heading such as "SECTION B: MATHEMATICS" or "PART II", never part of an answer choice. */
const isHeading = (text: string) => /^(?:section|part)\s+[\dA-Z]/i.test(text) || (/[A-Z]{3}/.test(text) && !/[a-z]/.test(text) && text.length <= 90);

/** Running headers, footers and page numbers: text near the top or bottom edge that repeats across pages or is a page number. */
function removeFurniture(layout: PdfLayout) {
  if (!layout.pages.length) return layout.lines;
  const inBand = (l: PdfLine) => { const h = layout.pages[l.page]?.height ?? 842; return l.top < h * 0.1 || l.bottom > h * 0.9; };
  const pagesWith = new Map<string, Set<number>>();
  for (const l of layout.lines) {
    const key = furnitureKey(l.text);
    if (!pagesWith.has(key)) pagesWith.set(key, new Set());
    pagesWith.get(key)!.add(l.page);
  }
  const pageCount = layout.pages.length;
  return layout.lines.filter((l) => {
    const key = furnitureKey(l.text);
    const repeats = pagesWith.get(key)!.size;
    if (inBand(l) && (PAGE_NUMBER.test(key) || (pageCount >= 2 && repeats >= 2))) return false;
    // A watermark or title printed in the same place on every page of a longer paper.
    return !(pageCount >= 3 && repeats === pageCount && !QUESTION.test(l.text) && !OPTION_START.test(l.text));
  });
}

/** Joins wrapped lines into paragraphs: a new paragraph starts after a clear vertical gap. */
function joinLines(lines: PdfLine[]) {
  let out = "";
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    const gap = prev && prev.page === l.page ? l.top - prev.bottom : 0;
    // "Read the passage and answer Questions 1 to 5." stays its own paragraph above the passage.
    const instruction = prev && RANGE.test(prev.text) && /[.:]$/.test(prev.text.trim());
    out += !prev ? l.text : (gap > (l.bottom - l.top) * 0.9 || prev.page !== l.page || instruction ? "\n\n" : " ") + l.text;
  });
  return out.replace(/[ \t]+/g, " ").trim();
}

function splitOptions(text: string) {
  const marks = [...text.matchAll(OPTION)];
  const sequential = marks.length >= 2 && marks.length <= 8 && marks.every((m, i) => (m[1] ?? m[2]).toUpperCase() === String.fromCharCode(65 + i));
  if (!sequential) return null;
  return {
    stem: text.slice(0, marks[0].index).trim(),
    options: marks.map((m, i) => text.slice(m.index! + m[0].length, marks[i + 1]?.index ?? text.length).trim()),
  };
}

interface Draft { number: number; stem: PdfLine[]; options: { letter: string; lines: PdfLine[] }[]; closed: boolean }

/**
 * Turns the page layout into draft questions. An answer choice ends at the next choice, question,
 * heading, outdented paragraph or the end of its page; text outside questions is kept as passages.
 */
export function paperFromLayout(layout: PdfLayout, { pages = true } = {}): ImportedPaper {
  const lines = pages ? removeFurniture(layout) : layout.lines;
  type Item = { line: PdfLine } | { diagram: number };
  const pos = (it: Item) => ("line" in it ? it.line : layout.diagrams[it.diagram]);
  const items: Item[] = [...lines.map((line) => ({ line })), ...layout.diagrams.map((_, diagram) => ({ diagram }))]
    .sort((a, b) => pos(a).page - pos(b).page || pos(a).top - pos(b).top || ("line" in a ? a.line.x : 0) - ("line" in b ? b.line.x : 0));

  const drafts: Draft[] = [];
  // `at` is the draft that follows the passage (null at the end of the paper).
  const passages: { text: string; from: number | null; to: number | null; at: number | null }[] = [];
  const diagramDraft: (number | null)[] = layout.diagrams.map(() => null);
  const waitingDiagrams: number[] = [];
  let block: PdfLine[] = [];
  let current: Draft | null = null;

  const flushBlock = (at: number | null) => {
    // Section headings are listed on their own; the rest of the block is one passage or instruction.
    let body: PdfLine[] = [];
    const emit = () => {
      if (!body.length) return;
      const text = joinLines(body);
      const range = text.match(RANGE);
      const [from, to] = range ? [Number(range[1]), Number(range[2])] : [null, null];
      passages.push({ text, from, to: to != null && from != null && to >= from ? to : from, at });
      body = [];
    };
    for (const l of block) {
      if (isHeading(l.text) && !RANGE.test(l.text)) { emit(); passages.push({ text: l.text.trim(), from: null, to: null, at }); }
      else body.push(l);
    }
    emit();
    block = [];
  };
  const optionsOf = (line: PdfLine) => {
    const split = splitOptions(line.text);
    if (split && !split.stem) return split.options;
    const one = line.text.match(OPTION_START);
    return one ? [line.text.replace(/^\(?[A-Ha-h][.)]?\)?\s+/, "")] : null;
  };
  // A stem line may carry its choices inline: "What is 2 + 2?  A. 3  B. 4  C. 5".
  const addStem = (draft: Draft, line: PdfLine) => {
    const split = splitOptions(line.text);
    if (!split || !split.stem) { draft.stem.push(line); return; }
    draft.stem.push({ ...line, text: split.stem });
    split.options.forEach((o, i) => draft.options.push({ letter: String.fromCharCode(65 + i), lines: [{ ...line, text: o }] }));
  };
  const startDraft = (number: number, rest: string, line: PdfLine) => {
    flushBlock(drafts.length);
    const draft: Draft = { number, stem: [], options: [], closed: false };
    current = draft;
    drafts.push(draft);
    for (const d of waitingDiagrams.splice(0)) diagramDraft[d] = drafts.length - 1;
    if (rest) addStem(draft, { ...line, text: rest });
  };

  let lastPage = -1;
  for (const it of items) {
    const page = pos(it).page;
    if (page !== lastPage && current) (current as Draft).closed = (current as Draft).options.length > 0;
    lastPage = page;
    if ("diagram" in it) {
      // A drawing belongs to the question it sits in; one inside a passage belongs to the next question.
      if (current && !block.length) diagramDraft[it.diagram] = drafts.length - 1;
      else waitingDiagrams.push(it.diagram);
      continue;
    }
    const line = it.line;
    const q = line.text.match(QUESTION);
    const n = q ? Number(q[1] ?? q[2]) : NaN;
    const expected = !current || n === (current as Draft).number + 1 || n === 1;
    if (q && expected) { startDraft(n, line.text.slice(q[0].length).trim(), line); continue; }
    const draft = current as Draft | null;
    if (!draft || block.length) { block.push(line); continue; }
    const opts = OPTION_START.test(line.text) ? optionsOf(line) : null;
    if (opts) {
      const startLetter = (line.text.match(OPTION_START)![1] ?? line.text.match(OPTION_START)![2]).toUpperCase();
      const split = splitOptions(line.text);
      if (split && !split.stem) split.options.forEach((o, i) => draft.options.push({ letter: String.fromCharCode(startLetter.charCodeAt(0) + i), lines: [{ ...line, text: o }] }));
      else draft.options.push({ letter: startLetter, lines: [{ ...line, text: opts[0] }] });
      draft.closed = false;
      continue;
    }
    const heading = isHeading(line.text) || RANGE.test(line.text);
    if (!draft.options.length) {
      // Still in the question: a heading or "Questions 6 to 10" line starts a new block.
      if (heading && draft.stem.length) block.push(line);
      else addStem(draft, line);
      continue;
    }
    // After the choices: a wrapped choice continues only on the same page, at the choice's indent, right below it.
    const last = draft.options[draft.options.length - 1].lines;
    const prev = last[last.length - 1];
    const continues = !draft.closed && !heading && prev.page === line.page && line.x >= prev.x - 2 && line.top - prev.bottom < (prev.bottom - prev.top) * 1.2;
    if (continues) last.push(line);
    else { draft.closed = true; block.push(line); }
  }
  flushBlock(null);

  const questions: PortalQuestionData[] = [];
  const numbers: number[] = [];
  const diagramQuestion = diagramDraft.map(() => null as number | null);
  const position = new Map<number, number>();
  drafts.slice(0, 200).forEach((d, di) => {
    let text = joinLines(d.stem);
    let options = d.options.map((o) => joinLines(o.lines));
    const sequential = options.length >= 2 && options.length <= 8 && d.options.every((o, i) => o.letter === String.fromCharCode(65 + i)) && options.every(Boolean);
    if (!sequential && options.length) {
      text = [text, ...d.options.map((o, i) => `${o.letter}. ${options[i]}`)].filter(Boolean).join("\n");
      options = [];
    }
    if (!text) return;
    diagramDraft.forEach((target, k) => { if (target === di) diagramQuestion[k] = questions.length; });
    position.set(di, questions.length);
    numbers.push(d.number);
    questions.push({
      id: randomUUID(), type: sequential ? "mcq" : "written", text: text.slice(0, 12000),
      options: options.map((o) => o.slice(0, 3000)), marks: 1, correctAnswer: null, rubric: "",
    });
  });
  // Shared context is copied onto each question in its range, so it survives shuffling and question banks.
  // The range is the run of questions after the passage numbered within it (numbering may restart per section).
  const out: ImportedPassage[] = passages.slice(0, 100).map((p) => {
    const next = p.at == null ? -1 : questions.findIndex((_, i) => i >= (position.get(p.at!) ?? Infinity));
    const before = next >= 0 ? next + 1 : null;
    if (p.from == null || p.to == null || next < 0) return { text: p.text, from: null, to: null, before };
    let first = -1, last = -1;
    for (let i = next; i < questions.length; i++) {
      const inRange = numbers[i] >= p.from && numbers[i] <= p.to;
      if (inRange) { if (first < 0) first = i; last = i; questions[i].passage = p.text.slice(0, 20000); }
      else if (first >= 0) break;
    }
    return { text: p.text, from: first >= 0 ? first + 1 : null, to: last >= 0 ? last + 1 : null, before };
  });
  return { questions, numbers, passages: out, diagramQuestion, text: lines.map((l) => l.text).join("\n") };
}

/** Plain-text import for pasted text or tests: every line is treated as one PDF line. */
export function questionsFromText(rawText: string): PortalQuestionData[] {
  const text = rawText.replace(/\r/g, "").replace(/ /g, " ")
    .split(/^\s*(?:answer\s*key|marking\s*scheme|answers\s*:)\s*$/im)[0];
  const lines = text.split("\n").map((t, i) => ({ page: 0, text: t.trim(), x: 0, top: i * 14, bottom: i * 14 + 11 })).filter((l) => l.text);
  return paperFromLayout({ pages: [], lines, diagrams: [] }, { pages: false }).questions;
}

type Matrix = number[];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
type Box = { x0: number; top: number; x1: number; bottom: number };
const boxOf = (m: Matrix, x0: number, y0: number, x1: number, y1: number): Box => {
  const pts = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
  return { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), top: Math.min(...pts.map((p) => p[1])), bottom: Math.max(...pts.map((p) => p[1])) };
};
const distance = (a: Box, b: Box) => Math.max(a.x0 - b.x1, b.x0 - a.x1, a.top - b.bottom, b.top - a.bottom, 0);
const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), top: Math.min(a.top, b.top), x1: Math.max(a.x1, b.x1), bottom: Math.max(a.bottom, b.bottom) });

function standardFonts() {
  try { return join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "standard_fonts") + "/"; }
  catch { return undefined; }
}

/**
 * Reads text lines and drawings from a PDF. Drawings are located from their vector paths and pictures,
 * their nearby short labels are kept with them (not in the question text), and, when `render` is set,
 * each drawing is cropped from the rendered page as a PNG.
 */
export async function readPdfLayout(buffer: Buffer, { render = false } = {}): Promise<PdfLayout> {
  const { getDocument, OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false, standardFontDataUrl: standardFonts(), verbosity: 0 });
  const document = await task.promise;
  const layout: PdfLayout = { pages: [], lines: [], diagrams: [] };
  try {
    if (document.numPages > 100) throw new Error("PDF documents are limited to 100 pages.");
    let length = 0;
    for (let p = 1; p <= document.numPages; p++) {
      const page = await document.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const pageIndex = p - 1;
      layout.pages.push({ width: viewport.width, height: viewport.height });

      // Text pieces, grouped into rows by baseline and into segments by horizontal gaps.
      const content = await page.getTextContent();
      type Piece = Box & { text: string; size: number };
      const pieces: Piece[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const m = multiply(viewport.transform, item.transform);
        const size = Math.hypot(m[2], m[3]) || 10;
        const x = m[4], baseline = m[5];
        pieces.push({ text: item.str, size, x0: x, x1: x + item.width * viewport.scale, top: baseline - size * 0.8, bottom: baseline + size * 0.2 });
      }
      pieces.sort((a, b) => a.bottom - b.bottom || a.x0 - b.x0);
      const rows: Piece[][] = [];
      for (const piece of pieces) {
        const row = rows.find((r) => Math.abs(r[0].bottom - piece.bottom) < r[0].size * 0.5);
        if (row) row.push(piece); else rows.push([piece]);
      }
      type Segment = Box & { text: string; size: number; label: boolean };
      const segments: Segment[] = [];
      for (const row of rows) {
        row.sort((a, b) => a.x0 - b.x0);
        let seg: Segment | null = null;
        for (const piece of row) {
          const gap = seg ? piece.x0 - seg.x1 : Infinity;
          if (seg && gap < piece.size * 1.5) {
            seg.text += (gap > piece.size * 0.15 && !/\s$/.test(seg.text) && !/^\s/.test(piece.text) ? " " : "") + piece.text;
            Object.assign(seg, union(seg, piece));
          } else {
            seg = { ...piece, label: false };
            segments.push(seg);
          }
        }
      }

      // Drawings: boxes of every painted path and picture, merged when they touch.
      const ops = await page.getOperatorList();
      const marks: Box[] = [];
      let ctm: Matrix = [1, 0, 0, 1, 0, 0];
      const stack: Matrix[] = [];
      const images = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat]);
      ops.fnArray.forEach((fn, i) => {
        const args = ops.argsArray[i];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
        else if (fn === OPS.transform) ctm = multiply(ctm, args);
        else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = multiply(ctm, args[0]); }
        else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
        else if (fn === OPS.constructPath && args?.[2] && args[0] !== OPS.endPath) {
          const mm = args[2];
          marks.push(boxOf(multiply(viewport.transform, ctm), mm[0], mm[1], mm[2], mm[3]));
        } else if (images.has(fn)) marks.push(boxOf(multiply(viewport.transform, ctm), 0, 0, 1, 1));
      });
      let regions: Box[] = [];
      for (const mark of marks) {
        let merged = mark;
        regions = regions.filter((r) => { if (distance(r, merged) <= 6) { merged = union(r, merged); return false; } return true; });
        regions.push(merged);
      }
      // Real drawings are at least about a centimetre each way, cover less than half the page and
      // do not frame paragraphs of text (boxed passages, page borders, shaded headings).
      const pageArea = viewport.width * viewport.height;
      regions = regions.filter((r) => {
        const w = r.x1 - r.x0, h = r.bottom - r.top;
        if (w < 24 || h < 24 || w / h > 10 || w * h > pageArea * 0.5) return false;
        const inside = segments.filter((s) => (s.x0 + s.x1) / 2 > r.x0 && (s.x0 + s.x1) / 2 < r.x1 && (s.top + s.bottom) / 2 > r.top && (s.top + s.bottom) / 2 < r.bottom);
        return !inside.some((s) => s.text.trim().length > 30);
      });
      // Short labels next to a drawing ("A", "8 cm", "x°") belong to it, never to the question text.
      for (const region of regions) {
        let grown = true;
        while (grown) {
          grown = false;
          for (const s of segments) {
            const text = s.text.trim();
            const sentence = /[.?:;]$/.test(text) || text.split(/\s+/).length > 2;
            if (s.label || text.length > 16 || sentence || QUESTION.test(text) || OPTION_START.test(text) || distance(s, region) > s.size * 2.2) continue;
            s.label = true;
            Object.assign(region, union(region, s));
            grown = true;
          }
        }
        layout.diagrams.push({ page: pageIndex, ...region, labels: segments.filter((s) => s.label && distance(s, region) === 0).map((s) => s.text.trim()) });
      }

      // Remaining segments on the same row form one line.
      const kept = segments.filter((s) => !s.label).sort((a, b) => a.bottom - b.bottom || a.x0 - b.x0);
      const lineRows: Segment[][] = [];
      for (const s of kept) {
        const row = lineRows.find((r) => Math.abs(r[0].bottom - s.bottom) < r[0].size * 0.5);
        if (row) row.push(s); else lineRows.push([s]);
      }
      for (const row of lineRows) {
        row.sort((a, b) => a.x0 - b.x0);
        const text = row.map((s) => s.text.trim()).join("   ").replace(/ /g, " ");
        length += text.length;
        layout.lines.push({ page: pageIndex, text, x: row[0].x0, top: Math.min(...row.map((s) => s.top)), bottom: Math.max(...row.map((s) => s.bottom)) });
      }
      if (length > 250000) throw new Error("PDF text is too long. Split this document into smaller papers.");

      const drawings = layout.diagrams.filter((d) => d.page === pageIndex);
      if (render && drawings.length) {
        // Padding around a drawing stops short of the question text and choices above and below it.
        const pageLines = layout.lines.filter((l) => l.page === pageIndex);
        const crops = drawings.map((d) => {
          const across = pageLines.filter((l) => l.x < d.x1);
          const above = Math.max(-Infinity, ...across.filter((l) => l.bottom <= d.top + 1).map((l) => l.bottom));
          const below = Math.min(Infinity, ...across.filter((l) => l.top >= d.bottom - 1).map((l) => l.top));
          return { d, box: { x0: d.x0 - PAD, x1: d.x1 + PAD, top: Math.max(d.top - PAD, above + 0.5), bottom: Math.min(d.bottom + PAD, below - 0.5) } };
        });
        try { await cropDrawings((document as unknown as { canvasFactory: unknown }).canvasFactory, page, crops); }
        catch { /* The review step reports the drawings that were not imported. */ }
      }
      page.cleanup();
    }
    layout.lines.sort((a, b) => a.page - b.page || a.top - b.top || a.x - b.x);
    return layout;
  } finally {
    await task.destroy();
  }
}

const SCALE = 2;
const PAD = 6;
async function cropDrawings(
  canvasFactory: unknown,
  page: { getViewport(o: { scale: number }): { width: number; height: number }; render(o: object): { promise: Promise<void> } },
  drawings: { d: PdfDiagram; box: Box }[],
) {
  type Canvas = { toBuffer(type: "image/png"): Buffer };
  type Ctx = { drawImage(...args: unknown[]): void; fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void };
  const factory = canvasFactory as { create(w: number, h: number): { canvas: Canvas; context: Ctx } };
  const viewport = page.getViewport({ scale: SCALE });
  const full = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
  full.context.fillStyle = "#ffffff";
  full.context.fillRect(0, 0, viewport.width, viewport.height);
  await page.render({ canvasContext: full.context, canvas: full.canvas, viewport }).promise;
  for (const { d, box } of drawings.slice(0, 40)) {
    const x = Math.max(0, Math.floor(box.x0 * SCALE)), y = Math.max(0, Math.floor(box.top * SCALE));
    const w = Math.min(Math.ceil(viewport.width) - x, Math.floor(box.x1 * SCALE) - x);
    const h = Math.min(Math.ceil(viewport.height) - y, Math.floor(box.bottom * SCALE) - y);
    if (w < 8 || h < 8) continue;
    const crop = factory.create(w, h);
    crop.context.drawImage(full.canvas, x, y, w, h, 0, 0, w, h);
    const png = crop.canvas.toBuffer("image/png");
    if (png.length <= 2 * 1024 * 1024) d.image = png;
  }
}
