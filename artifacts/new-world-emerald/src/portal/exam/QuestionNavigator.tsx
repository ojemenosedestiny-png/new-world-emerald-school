import { cn } from "@/lib/utils";
import { scrollToQuestion } from "../lib";

type NavQuestion = { id: string };

/** Numbered jump buttons: filled when answered, outlined when still empty. */
export function QuestionNavigator({ questions, answers, onJump }: { questions: NavQuestion[]; answers: Record<string, string>; onJump?: () => void }) {
  return (
    <nav aria-label="Jump to a question" className="flex flex-wrap gap-1.5" data-testid="nav-questions">
      {questions.map((q, i) => {
        const answered = (answers[q.id] ?? "").trim() !== "";
        return (
          <button
            key={q.id}
            type="button"
            onClick={() => { onJump?.(); scrollToQuestion(q.id); }}
            className={cn("portal-nav-chip", answered && "portal-nav-chip-done")}
            aria-label={`Question ${i + 1}, ${answered ? "answered" : "not answered"}`}
            data-testid={"nav-question-" + (i + 1)}
          >
            {i + 1}
          </button>
        );
      })}
    </nav>
  );
}

export function unansweredNumbers(questions: NavQuestion[], answers: Record<string, string>) {
  return questions.flatMap((q, i) => ((answers[q.id] ?? "").trim() === "" ? [{ id: q.id, number: i + 1 }] : []));
}
