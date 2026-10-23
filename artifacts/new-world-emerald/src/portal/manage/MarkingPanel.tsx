import { useState } from "react";
import type { PortalManagement, PortalManagementAttemptsItem } from "@workspace/api-client-react";
import { CheckSquare } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, StatusPill } from "../ui";
import { OPTION_LETTERS, fileUrl, formatDateTime } from "../lib";
import { className, useCommand } from "./useCommand";

type MarkRow = { questionId: string; score: string; feedback: string };

function GradeDialog({ attempt, onClose }: { attempt: PortalManagementAttemptsItem; onClose: () => void }) {
  const cmd = useCommand();
  const existing = new Map((attempt.marks ?? []).map((m) => [m.questionId, m]));
  const [rows, setRows] = useState<MarkRow[]>(() => attempt.questionKeys.map((q) => {
    const m = existing.get(q.id);
    if (m) return { questionId: q.id, score: String(m.score), feedback: m.feedback };
    const ans = attempt.answers[q.id];
    const auto = q.type === "mcq" && q.correctAnswer != null && ans !== undefined && ans !== "" ? (Number(ans) === q.correctAnswer ? q.marks : 0) : "";
    return { questionId: q.id, score: String(auto), feedback: "" };
  }));
  const invalid = rows.some((r, i) => r.score === "" || Number.isNaN(Number(r.score)) || Number(r.score) < 0 || Number(r.score) > attempt.questionKeys[i].marks);
  const total = rows.reduce((s, r) => s + (Number(r.score) || 0), 0);
  const save = async () => {
    if (invalid) return;
    if (await cmd.run({ action: "grade", grade: { attemptId: attempt.id, marks: rows.filter((r) => attempt.questionKeys.find((q) => q.id === r.questionId)?.type === "written").map((r) => ({ questionId: r.questionId, score: Number(r.score), feedback: r.feedback })) } }, "Marks saved")) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="portal !min-h-0 max-h-[94dvh] max-w-3xl overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle className="font-serif text-2xl">{attempt.studentName}</DialogTitle>
          <DialogDescription>{attempt.title} / {attempt.studentId} / submitted answers{attempt.fileId ? "" : ""}</DialogDescription></DialogHeader>
        {attempt.fileId && <a className="portal-btn-ghost w-fit" href={fileUrl(attempt.fileId)} target="_blank" rel="noreferrer">Open exam paper</a>}
        <div className="space-y-3">{attempt.questionKeys.map((q, i) => {
          const ans = attempt.answers[q.id] ?? "";
          const r = rows[i];
          return (
            <div key={q.id} className="rounded-2xl border border-[hsl(var(--p-line))] bg-white/80 p-4" data-testid={"grade-q-" + q.id}>
              <p className="text-sm font-semibold"><span className="mr-2 text-[hsl(var(--p-ink)/0.45)]">{i + 1}.</span>{q.text}</p>
              {q.type === "mcq" ? (
                <p className="mt-2 text-sm">Answer: <b>{ans === "" ? "No answer" : OPTION_LETTERS[Number(ans)] + ". " + (q.options[Number(ans)] ?? "")}</b> / Key: <b>{q.correctAnswer == null ? "not set" : OPTION_LETTERS[q.correctAnswer]}</b></p>
              ) : (
                <div className="mt-2 whitespace-pre-wrap rounded-xl bg-[hsl(var(--p-paper-2)/0.6)] p-3 text-sm">{ans || <span className="italic opacity-60">No answer</span>}</div>
              )}
              {q.rubric && <p className="mt-2 text-xs text-[hsl(var(--p-ink)/0.6)]">Guide: {q.rubric}</p>}
              <div className="mt-3 grid gap-2 sm:grid-cols-[120px_1fr]">
                <label className="text-xs font-semibold">{q.type === "mcq" ? "Automatic score" : "Score"} / {q.marks}<input type="number" min={0} max={q.marks} step={0.5} readOnly={q.type === "mcq"} className="portal-input mt-1 !py-1.5" value={r.score} onChange={(e) => setRows(rows.map((x, xi) => xi === i ? { ...x, score: e.target.value } : x))} data-testid={"input-score-" + q.id} /></label>
                <label className="text-xs font-semibold">Feedback<input className="portal-input mt-1 !py-1.5" maxLength={3000} disabled={q.type === "mcq"} value={r.feedback} onChange={(e) => setRows(rows.map((x, xi) => xi === i ? { ...x, feedback: e.target.value } : x))} data-testid={"input-feedback-" + q.id} /></label>
              </div>
            </div>
          );
        })}</div>
        <DialogFooter className="items-center gap-3">
          <span className="text-sm font-semibold">Total {total} / {attempt.totalMarks}</span>
          {invalid && <span className="text-xs text-[hsl(var(--p-red))]">Every score must be between 0 and the question's marks.</span>}
          <button className="portal-btn" onClick={save} disabled={cmd.pending || invalid} data-testid="button-save-grade">{cmd.pending ? "Saving..." : "Save marks"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MarkingPanel({ data }: { data: PortalManagement }) {
  const [open, setOpen] = useState<number | null>(null);
  const [show, setShow] = useState<"todo" | "all">("todo");
  const list = data.attempts.filter((a) => a.status !== "in_progress" && (show === "all" || a.status === "submitted"));
  const current = data.attempts.find((a) => a.id === open);
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button className={"portal-tab " + (show === "todo" ? "!bg-[hsl(var(--p-ink))] !text-[hsl(var(--p-paper))]" : "")} onClick={() => setShow("todo")} data-testid="button-filter-todo">Awaiting marking</button>
        <button className={"portal-tab " + (show === "all" ? "!bg-[hsl(var(--p-ink))] !text-[hsl(var(--p-paper))]" : "")} onClick={() => setShow("all")} data-testid="button-filter-all">All submitted</button>
      </div>
      {list.length === 0 ? <EmptyState icon={<CheckSquare size={22} />} title={show === "todo" ? "Nothing to mark" : "No submissions yet"} body="Submitted attempts from your classes appear here. Multiple-choice scores are calculated automatically; written answers are marked by staff." /> : (
        <div className="portal-card divide-y divide-[hsl(var(--p-line))] overflow-hidden">{list.map((a) => (
          <div key={a.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center" data-testid={"row-attempt-" + a.id}>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{a.studentName} <span className="font-mono text-xs text-[hsl(var(--p-ink)/0.5)]">{a.studentId}</span></p>
              <p className="text-xs text-[hsl(var(--p-ink)/0.55)]">{a.title} / {className(data.classes, a.classId)} / saved {formatDateTime(a.savedAt)}</p>
            </div>
            {a.status === "marked" ? <StatusPill tone="green">{a.score ?? "-"} / {a.totalMarks}</StatusPill> : <StatusPill tone="gold">To mark</StatusPill>}
            <button className="portal-btn-ghost" onClick={() => setOpen(a.id)} data-testid={"button-grade-" + a.id}>{a.status === "marked" ? "Review marks" : "Mark"}</button>
          </div>))}
        </div>
      )}
      {current && <GradeDialog key={current.id} attempt={current} onClose={() => setOpen(null)} />}
    </div>
  );
}
