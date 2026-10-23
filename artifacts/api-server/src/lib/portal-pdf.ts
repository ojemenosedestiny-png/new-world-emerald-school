import { randomUUID } from "node:crypto";
import type { PortalQuestionData } from "@workspace/db";

// Deterministic import: retain the wording and never invent an answer key.
// Unrecognized/scanned layouts remain usable through the original-PDF mode.
export function questionsFromText(rawText: string): PortalQuestionData[] {
  const text = rawText.replace(/\r/g, "").replace(/\u00a0/g, " ")
    .split(/^\s*(?:answer\s*key|marking\s*scheme|answers\s*:)\s*$/im)[0];
  const start = /^\s*(?:question\s+)?(\d{1,3})[.)]\s+|^\s*question\s+(\d{1,3})\s*[:.)-]?\s+/gim;
  const matches = [...text.matchAll(start)];
  const questions: PortalQuestionData[] = [];
  for (let i = 0; i < matches.length && questions.length < 200; i++) {
    const match = matches[i];
    const chunk = text.slice(match.index! + match[0].length, matches[i + 1]?.index ?? text.length).trim();
    if (!chunk) continue;
    // Choices can be on individual lines or inline following the prompt.
    const choice = /(?:^|\n|\s{1,})(?:\(([A-Ha-h])\)|([A-Ha-h])[.)])\s+/g;
    const choices = [...chunk.matchAll(choice)];
    const sequential = choices.length >= 2 && choices.length <= 8 &&
      choices.every((c, idx) => (c[1] ?? c[2]).toUpperCase() === String.fromCharCode(65 + idx));
    const prompt = sequential ? chunk.slice(0, choices[0].index).trim() : chunk;
    if (!prompt) continue;
    const options = sequential ? choices.map((c, idx) => chunk.slice(c.index! + c[0].length, choices[idx + 1]?.index ?? chunk.length).trim()) : [];
    questions.push({
      id: randomUUID(), type: sequential ? "mcq" : "written", text: prompt.slice(0, 12000),
      options: options.map((o) => o.slice(0, 3000)), marks: 1, correctAnswer: null, rubric: "",
    });
  }
  return questions;
}
export async function extractPdfText(buffer: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
  const document = await task.promise;
  try {
    if (document.numPages > 100) throw new Error("PDF documents are limited to 100 pages.");
    let text = "";
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
      const content = await page.getTextContent();
      let lastY: number | undefined;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5];
        if (lastY !== undefined && Math.abs(y - lastY) > 3) text += "\n";
        text += item.str + (item.hasEOL ? "\n" : " ");
        lastY = y;
      }
      text += "\n";
      page.cleanup();
      if (text.length > 250000) throw new Error("PDF text is too long. Split this document into smaller papers.");
    }
    return text;
  } finally {
    await task.destroy();
  }
}
