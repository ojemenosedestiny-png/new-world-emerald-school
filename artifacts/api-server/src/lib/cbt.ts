import { randomInt } from "node:crypto";
import type { PortalQuestionData } from "@workspace/db";

export interface PaperSettings { shuffleQuestions: boolean; shuffleOptions: boolean; drawCount: number }
/** Exits from the exam screen beyond this are not counted further (keeps a misbehaving client from flooding). */
export const MAX_FOCUS_LOSSES = 500;

function shuffled<T>(items: T[], rand: (n: number) => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Problems with the paper settings, or null. Draws need equal marks so every student's paper is worth the same. */
export function paperSettingsProblem(mode: string, questions: PortalQuestionData[], s: PaperSettings): string | null {
  if (!Number.isInteger(s.drawCount) || s.drawCount < 0) return "The number of questions per student must be a whole number.";
  const changesPaper = s.shuffleQuestions || s.shuffleOptions || s.drawCount > 0;
  if (mode === "pdf" && changesPaper) return "Shuffling and question banks only work with on-screen questions, not a PDF paper.";
  if (s.drawCount > questions.length) return `The question bank has only ${questions.length} questions; choose ${questions.length} or fewer per student.`;
  if (s.drawCount > 0 && new Set(questions.map((q) => q.marks)).size > 1) return "For a question bank, give every question the same marks so each student's paper is worth the same.";
  return null;
}

/**
 * One student's paper: optionally a random draw from the bank, in shuffled order, with shuffled options.
 * The answer key is remapped to the new option order, so marking the attempt's own copy stays correct.
 */
export function buildPaper(questions: PortalQuestionData[], s: PaperSettings, rand: (n: number) => number = randomInt): PortalQuestionData[] {
  let paper = s.drawCount > 0 && s.drawCount < questions.length
    ? shuffled(questions, rand).slice(0, s.drawCount)
    : [...questions];
  // A draw keeps the teacher's order unless shuffling is on, so section headings in question text still read well.
  if (s.drawCount > 0 && !s.shuffleQuestions) {
    const order = new Map(questions.map((q, i) => [q.id, i]));
    paper.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }
  if (s.shuffleQuestions) paper = shuffled(paper, rand);
  if (!s.shuffleOptions) return paper;
  return paper.map((q) => {
    if (q.type !== "mcq" || q.options.length < 2) return q;
    const order = shuffled(q.options.map((_, i) => i), rand);
    return {
      ...q,
      options: order.map((i) => q.options[i]),
      correctAnswer: q.correctAnswer == null ? q.correctAnswer : order.indexOf(q.correctAnswer),
    };
  });
}

/** Questions and marks a student sees before starting. */
export function paperSize(questions: PortalQuestionData[], drawCount: number) {
  if (drawCount > 0 && drawCount < questions.length) return { questionCount: drawCount, totalMarks: drawCount * (questions[0]?.marks ?? 0) };
  return { questionCount: questions.length, totalMarks: questions.reduce((sum, q) => sum + q.marks, 0) };
}
