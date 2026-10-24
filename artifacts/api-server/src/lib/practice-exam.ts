import type { PortalQuestionData } from "@workspace/db";

export const PRACTICE_TITLE = "Practice CBT (sample)";

const items: [string, string[], number][] = [
  ["What is 7 + 8?", ["13", "14", "15", "16"], 2],
  ["What is 9 × 6?", ["54", "56", "45", "63"], 0],
  ["What is 100 ÷ 4?", ["20", "25", "40", "50"], 1],
  ["What is half of 30?", ["10", "15", "20", "60"], 1],
  ["What is the plural of “child”?", ["childs", "children", "childes", "childrens"], 1],
  ["What is the opposite of “early”?", ["late", "soon", "quick", "first"], 0],
  ["What is the capital of Nigeria?", ["Lagos", "Abuja", "Kano", "Ibadan"], 1],
  ["How many days are in a week?", ["5", "6", "7", "8"], 2],
  ["Which of these animals is a mammal?", ["Shark", "Frog", "Goat", "Lizard"], 2],
  ["At what temperature does water freeze?", ["0°C", "10°C", "50°C", "100°C"], 0],
  ["What colours are on the Nigerian flag?", ["Green and white", "Red and white", "Green and yellow", "Blue and white"], 0],
  ["Which planet do we live on?", ["Mars", "Earth", "Venus", "Jupiter"], 1],
];

/** A short published practice test that exercises every CBT option: a 12-question bank, 10 per student, shuffled, lockdown. */
export function practiceExam(classId: number, now = new Date()) {
  const questions: PortalQuestionData[] = items.map(([text, options, correctAnswer], i) => ({ id: `practice-${i + 1}`, type: "mcq", text, options, correctAnswer, marks: 1 }));
  return {
    title: PRACTICE_TITLE, subject: "General knowledge", classId, durationMinutes: 15,
    startsAt: now, endsAt: new Date(now.getTime() + 7 * 86_400_000), mode: "interactive", fileId: null,
    instructions: "This is a practice test to try the computer-based test system. It uses full-screen lockdown, and each student gets 10 of 12 questions in a shuffled order.",
    questions, published: true, resultsReleased: false,
    shuffleQuestions: true, shuffleOptions: true, drawCount: 10, lockdown: true,
  };
}
