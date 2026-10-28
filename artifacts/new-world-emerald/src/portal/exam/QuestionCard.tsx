import type { PortalAttemptQuestionsItem, PortalAttemptMarksItem } from "@workspace/api-client-react";
import { OPTION_LETTERS, diagramUrl } from "../lib";

/** `sharedWith` is the number of the earlier question that already shows the same passage open. */
export function QuestionCard({ q, index, value, onChange, disabled, mark, compact, sharedWith }: {
  q: PortalAttemptQuestionsItem; index: number; value: string; onChange: (v: string) => void; disabled: boolean; mark?: PortalAttemptMarksItem; compact?: boolean; sharedWith?: number;
}) {
  const labelId = "q-label-" + q.id;
  return (
    <section id={"question-" + q.id} className="portal-card scroll-mt-28 p-5 md:p-7" aria-labelledby={labelId} data-testid={"card-question-" + q.id}>
      {q.passage && (
        <details open={!sharedWith} className="mb-5 rounded-xl border border-[hsl(var(--p-line))] bg-[hsl(var(--p-paper-2)/0.6)] p-4" data-testid={"passage-" + q.id}>
          <summary className="cursor-pointer text-sm font-semibold">{sharedWith ? `Passage (same as question ${sharedWith})` : "Read this first"}</summary>
          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{q.passage}</p>
        </details>
      )}
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[hsl(var(--p-ink))] text-sm font-bold text-[hsl(var(--p-paper))]">{index + 1}</span>
          <p id={labelId} className={"whitespace-pre-wrap pt-1 leading-relaxed " + (compact ? "text-sm font-medium" : "text-[17px] font-medium")}>{q.text}</p>
        </div>
        <span className="shrink-0 text-xs font-semibold text-[hsl(var(--p-ink)/0.5)]">{q.marks} {q.marks === 1 ? "mark" : "marks"}</span>
      </div>
      {q.diagramFileId && (
        <img src={diagramUrl(q.diagramFileId)} alt={`Diagram for question ${index + 1}`} className="mb-4 max-h-96 max-w-full rounded-xl border border-[hsl(var(--p-line))] bg-white p-2" data-testid={"diagram-" + q.id} />
      )}
      {q.type === "mcq" ? (
        <div role="radiogroup" aria-labelledby={labelId} className="grid gap-2 sm:grid-cols-2">
          {q.options.map((opt, i) => (
            <button key={i} type="button" role="radio" aria-checked={value === String(i)} disabled={disabled} onClick={() => onChange(String(i))} className="portal-option" data-testid={"option-" + q.id + "-" + i}>
              <span className="portal-option-letter">{OPTION_LETTERS[i]}</span>
              <span className="pt-0.5 text-sm">{opt || "Option " + OPTION_LETTERS[i]}</span>
            </button>
          ))}
        </div>
      ) : (
        <textarea aria-labelledby={labelId} className="portal-input min-h-[140px] leading-relaxed" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder={disabled ? "" : "Write your answer here"} maxLength={20000} data-testid={"input-answer-" + q.id} />
      )}
      {mark && (
        <div className="mt-4 rounded-xl bg-[hsl(var(--p-emerald-soft)/0.6)] p-3 text-sm">
          <p className="font-semibold text-[hsl(var(--p-emerald))]">{mark.score} / {q.marks}</p>
          {mark.feedback && <p className="mt-1 whitespace-pre-wrap text-[hsl(var(--p-ink)/0.8)]">{mark.feedback}</p>}
        </div>
      )}
    </section>
  );
}
