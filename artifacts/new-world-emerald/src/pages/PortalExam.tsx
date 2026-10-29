import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useGetPortalAttempt, getGetPortalAttemptQueryKey, useGetPortalSession, getGetPortalSessionQueryKey } from "@workspace/api-client-react";
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, CloudOff, FileText, Hourglass, ListChecks, Loader2, Maximize, Send, ShieldAlert } from "lucide-react";
import "@/portal/portal.css";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ErrorPanel, PortalHeader, Skeleton, StatusPill } from "@/portal/ui";
import { errorMessage, fileUrl, formatTime, scrollToQuestion, usePortalMeta } from "@/portal/lib";
import { usePortalTheme } from "@/portal/shell/theme";
import { useKeepAlive } from "@/components/IdleSignOut";
import { QuestionNavigator, unansweredNumbers } from "@/portal/exam/QuestionNavigator";
import { useAttemptSync, type SaveState } from "@/portal/exam/useAttemptSync";
import { Countdown, useRemaining } from "@/portal/exam/Countdown";
import { QuestionCard } from "@/portal/exam/QuestionCard";
import { useLockdown } from "@/portal/exam/useLockdown";

function SaveBadge({ state, savedAt, error, onRetry }: { state: SaveState; savedAt: string | null; error: string | null; onRetry: () => void }) {
  let text = "";
  if (state === "saving") text = "Saving...";
  else if (state === "dirty") text = "Unsaved changes";
  else if (state === "offline") text = "Offline. Answers kept on this device, retrying";
  else if (state === "error") text = "Not saved: " + (error ?? "server error");
  else if (state === "saved" && savedAt) text = "Saved at " + formatTime(savedAt);
  return (
    <div className="flex items-center gap-2 text-xs text-[hsl(var(--p-paper)/0.8)]" role="status" aria-live="polite" data-testid="status-save">
      {state === "saving" ? <Loader2 size={13} className="animate-spin" /> : state === "offline" || state === "error" ? <CloudOff size={13} className="text-[hsl(var(--p-gold))]" /> : state === "saved" ? <CheckCircle2 size={13} className="text-[hsl(var(--p-gold))]" /> : null}
      <span className="max-w-[220px] truncate">{text}</span>
      {(state === "error" || state === "offline") && <button onClick={onRetry} className="underline" data-testid="button-retry-save">Retry</button>}
    </div>
  );
}

export default function PortalExam() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const valid = Number.isInteger(id) && id > 0;
  usePortalTheme();
  const session = useGetPortalSession({ query: { queryKey: getGetPortalSessionQueryKey() } });
  const isStudent = session.data?.role === "student" && !session.data.mustChangePassword;
  const q = useGetPortalAttempt(id, {
    query: {
      queryKey: getGetPortalAttemptQueryKey(id),
      enabled: valid && isStudent,
      refetchOnWindowFocus: false,
      refetchInterval: (query) => (query.state.data && query.state.data.status !== "in_progress" && !(query.state.data.status === "marked" && query.state.data.resultsReleased) ? 30000 : false),
    },
  });
  const attempt = q.data;
  usePortalMeta(attempt ? attempt.title : "Exam");
  const sync = useAttemptSync(attempt, session.data?.studentId ?? "");
  const offset = useMemo(() => (attempt ? new Date(attempt.serverNow).getTime() - q.dataUpdatedAt : 0), [attempt, q.dataUpdatedAt]);
  const remaining = useRemaining(attempt?.deadline, offset);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const autoSubmitted = useRef(false);
  const inProgress = attempt?.status === "in_progress";
  const expired = remaining !== null && remaining <= 0;
  const locked = !inProgress || expired;
  // An exam in progress counts as activity, so the idle sign-out in other tabs never ends it.
  useKeepAlive(inProgress && !expired);
  const lockdown = useLockdown(id, !!attempt?.lockdown && inProgress && !expired);

  useEffect(() => {
    if (!inProgress || !expired || autoSubmitted.current) return;
    autoSubmitted.current = true;
    sync.lock();
    void sync.submit().then((ok) => { if (!ok) void q.refetch(); });
  }, [inProgress, expired, sync, q]);

  useEffect(() => {
    if (!inProgress || !sync.hasUnsaved) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [inProgress, sync.hasUnsaved]);

  const back = <Link href="/portal" className="portal-btn-dark" data-testid="link-back-dashboard"><ArrowLeft size={14} /> Portal</Link>;

  if (!session.isLoading && !isStudent) {
    return (
      <div className="portal grid place-items-center px-4"><div className="portal-card max-w-md p-8 text-center">
        <h1 className="font-serif text-2xl font-semibold">Please sign in first</h1>
        <p className="mt-2 text-sm text-[hsl(var(--p-ink)/0.65)]">Exams open only after you sign in to the student portal.</p>
        <Link href="/portal" className="portal-btn mt-6" data-testid="link-portal-login">Go to sign-in</Link>
      </div></div>
    );
  }
  if (!valid) return <div className="portal grid place-items-center px-4"><ErrorPanel title="Exam link not recognised" message="This address does not point to an exam attempt. Go back to your portal and open it from there." /></div>;
  if (session.isLoading || q.isLoading) return <div className="portal"><PortalHeader subtitle="Exam">{back}</PortalHeader><div className="mx-auto max-w-3xl space-y-4 px-4 py-10"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div></div>;
  if (q.isError || !attempt) return <div className="portal"><PortalHeader subtitle="Exam">{back}</PortalHeader><div className="mx-auto max-w-xl px-4 py-12"><ErrorPanel title="This exam could not be opened" message={errorMessage(q.error)} onRetry={() => q.refetch()} /></div></div>;

  const unanswered = unansweredNumbers(attempt.questions, sync.answers);
  const answered = attempt.questions.length - unanswered.length;
  const released = attempt.status === "marked" && attempt.resultsReleased && typeof attempt.score === "number";
  const marks = new Map((released ? attempt.marks ?? [] : []).map((m) => [m.questionId, m]));
  const review = new Map((attempt.review ?? []).map((r) => [r.questionId, r]));
  const pdf = attempt.mode === "pdf" && !!attempt.fileId && inProgress && !expired;

  return (
    <div className="portal pb-28">
      <PortalHeader subtitle={attempt.subject}>
        {inProgress && !expired && <SaveBadge state={sync.state} savedAt={sync.savedAt} error={sync.lastError} onRetry={() => void sync.retrySave()} />}
        {inProgress && remaining !== null && <Countdown remaining={remaining} />}
        {!inProgress && back}
      </PortalHeader>

      {lockdown.needsFullscreen && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-[hsl(var(--p-ink)/0.85)] px-4" role="dialog" aria-modal="true" aria-labelledby="lockdown-title" data-testid="panel-lockdown">
          <div className="portal-card max-w-md p-7 text-center">
            <ShieldAlert className="mx-auto text-[hsl(var(--p-emerald))]" size={34} />
            <h2 id="lockdown-title" className="mt-3 font-serif text-2xl font-semibold">Full screen exam</h2>
            <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--p-ink)/0.7)]">Your teacher has turned on lockdown. Stay on this screen until you submit. Copy and paste are off, and every time you leave the exam screen is recorded{lockdown.exits ? ` (so far: ${lockdown.exits})` : ""}.</p>
            <button type="button" className="portal-btn mt-5 w-full justify-center" onClick={() => void lockdown.enterFullscreen()} data-testid="button-enter-fullscreen"><Maximize size={15} /> {lockdown.exits ? "Return to full screen" : "Start in full screen"}</button>
          </div>
        </div>
      )}

      <main className={"mx-auto px-4 py-8 md:px-8 " + (pdf ? "max-w-7xl" : "max-w-3xl")}>
        {attempt.lockdown && inProgress && !expired && lockdown.exits > 0 && (
          <p className="mb-4 rounded-xl bg-[hsl(var(--p-gold-soft))] p-3 text-sm font-semibold" role="status" data-testid="text-lockdown-exits">You have left the exam screen {lockdown.exits} {lockdown.exits === 1 ? "time" : "times"}. Your teacher can see this.</p>
        )}
        <div className="portal-rise mb-6">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[hsl(var(--p-emerald))]">{attempt.subject} / {attempt.totalMarks} marks</p>
          <h1 className="mt-2 font-serif text-3xl font-semibold md:text-4xl" data-testid="text-exam-title">{attempt.title}</h1>
          {attempt.instructions && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-[hsl(var(--p-surface)/0.7)] p-4 text-sm leading-relaxed text-[hsl(var(--p-ink)/0.8)]">{attempt.instructions}</p>}
        </div>

        {!inProgress && (
          <div className="portal-card portal-rise mb-6 p-6" data-testid="panel-result">
            {released ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div><p className="portal-label">Your result</p><p className="mt-1 text-sm text-[hsl(var(--p-ink)/0.65)]">Marked and released by your teacher.</p></div>
                <p className="font-serif text-5xl font-bold text-[hsl(var(--p-emerald))]" data-testid="text-score">{attempt.score}<span className="text-xl text-[hsl(var(--p-ink)/0.45)]"> / {attempt.totalMarks}</span></p>
              </div>
            ) : (
              <div className="flex items-start gap-3"><Hourglass className="mt-1 text-[hsl(var(--p-gold))]" />
                <div><p className="font-serif text-xl font-semibold">Submitted. Result pending.</p><p className="mt-1 text-sm text-[hsl(var(--p-ink)/0.65)]">Your teacher will mark this exam and release results when the whole class is ready. This page checks for updates automatically.</p></div>
              </div>
            )}
          </div>
        )}

        {inProgress && expired && (
          <div className="mb-6" role="alert">
            {sync.submitting ? <div className="portal-card p-5 text-sm font-semibold">Time is up. Submitting your answers...</div>
              : sync.submitError ? <ErrorPanel title="Time is up, but submission did not reach the school" message={sync.submitError + " The server closes expired exams automatically with your last saved answers."} onRetry={() => void sync.submit()} />
              : <div className="portal-card p-5 text-sm font-semibold">Time is up. Answers can no longer be changed.</div>}
          </div>
        )}

        <div className={pdf ? "grid gap-6 lg:grid-cols-[1.2fr_1fr]" : ""}>
          {pdf && (
            <div className="lg:sticky lg:top-24 lg:h-[calc(100dvh-8rem)]">
              <iframe title="Exam paper" src={fileUrl(attempt.fileId as string)} className="h-[70dvh] w-full rounded-2xl border border-[hsl(var(--p-line))] bg-white lg:h-full" />
              <a href={fileUrl(attempt.fileId as string)} target="_blank" rel="noreferrer" className="portal-btn-ghost mt-2" data-testid="link-open-paper"><FileText size={14} /> Open paper in new tab</a>
            </div>
          )}
          <div className="space-y-4">
            {pdf && <p className="text-sm text-[hsl(var(--p-ink)/0.65)]">Read the questions on the paper, then record your answers in the matching slots below.</p>}
            {review.size > 0 && !released && <p className="rounded-xl bg-[hsl(var(--p-emerald-soft)/0.6)] p-4 text-sm" data-testid="text-answer-review">Your answers are checked below: the right answer is shown for every multiple-choice question. Your score will appear when the school releases results.</p>}
            {attempt.questions.map((question, i) => {
              const first = question.passage ? attempt.questions.findIndex((q) => q.passage === question.passage) : i;
              return <QuestionCard key={question.id} q={question} index={i} value={sync.answers[question.id] ?? ""} onChange={(v) => sync.setAnswer(question.id, v)} disabled={locked || sync.submitting} mark={marks.get(question.id)} compact={!!pdf} sharedWith={first < i ? first + 1 : undefined} review={review.get(question.id)} />;
            })}
          </div>
        </div>
      </main>

      {inProgress && !expired && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[hsl(var(--p-line))] bg-[hsl(var(--p-paper)/0.95)] backdrop-blur">
          {navOpen && (
            <div className="mx-auto max-w-3xl border-b border-[hsl(var(--p-line))] px-4 py-3" id="exam-question-nav">
              <QuestionNavigator questions={attempt.questions} answers={sync.answers} onJump={() => setNavOpen(false)} />
            </div>
          )}
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
            <div className="flex items-center gap-3 text-sm">
              <button type="button" className="portal-btn-ghost !px-2.5 !py-1.5" onClick={() => setNavOpen((o) => !o)} aria-expanded={navOpen} aria-controls="exam-question-nav" data-testid="button-toggle-nav">
                <ListChecks size={14} /> <span className="hidden sm:inline">Questions</span> {navOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              </button>
              <div><span className="font-bold" data-testid="text-answered-count">{answered}</span> of {attempt.questions.length} answered
                {sync.submitError && <p className="text-xs text-[hsl(var(--p-red))]" role="alert">{sync.submitError}</p>}
              </div>
            </div>
            <button className="portal-btn" onClick={() => setConfirmOpen(true)} disabled={sync.submitting} data-testid="button-open-submit"><Send size={15} /> {sync.submitting ? "Submitting..." : sync.submitError ? "Retry submit" : "Submit exam"}</button>
          </div>
        </div>
      )}
      {!inProgress && <div className="mx-auto max-w-3xl px-4"><StatusPill tone="ink">Answers locked</StatusPill></div>}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-2xl">Submit your exam?</AlertDialogTitle>
            <AlertDialogDescription>You have answered {answered} of {attempt.questions.length} questions. After submitting you cannot change any answer.</AlertDialogDescription>
          </AlertDialogHeader>
          {unanswered.length > 0 && (
            <div className="rounded-xl bg-[hsl(var(--p-gold-soft))] p-3 text-sm" data-testid="panel-unanswered">
              <p className="font-semibold">{unanswered.length === 1 ? "1 question is" : unanswered.length + " questions are"} still blank:</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {unanswered.slice(0, 40).map((u) => (
                  <button key={u.id} type="button" className="portal-nav-chip" onClick={() => { setConfirmOpen(false); window.setTimeout(() => scrollToQuestion(u.id), 150); }} data-testid={"unanswered-" + u.number}>{u.number}</button>
                ))}
                {unanswered.length > 40 && <span className="self-center text-xs">and {unanswered.length - 40} more</span>}
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-submit">Keep working</AlertDialogCancel>
            <AlertDialogAction onClick={() => void sync.submit()} data-testid="button-confirm-submit">Submit now</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
