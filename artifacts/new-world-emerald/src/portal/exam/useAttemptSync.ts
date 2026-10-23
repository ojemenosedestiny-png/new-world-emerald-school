import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSavePortalAnswers, useSubmitPortalAttempt, getGetPortalAttemptQueryKey, getGetPortalDashboardQueryKey,
  type PortalAttempt,
} from "@workspace/api-client-react";
import { DRAFT_PREFIX, errorMessage, isNetworkError } from "../lib";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "offline" | "error";
type Answers = Record<string, string>;
type Draft = { answers: Answers; dirty: boolean; updatedAt: number };

function draftKey(studentId: string, attemptId: number) { return DRAFT_PREFIX + studentId + ":" + attemptId; }
function readDraft(key: string): Draft | null {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as Draft) : null; } catch { return null; }
}
function writeDraft(key: string, d: Draft) { try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* storage full or blocked */ } }
const same = (a: Answers, b: Answers) => JSON.stringify(a) === JSON.stringify(b);

export function useAttemptSync(attempt: PortalAttempt | undefined, studentId: string) {
  const queryClient = useQueryClient();
  // React Query's default pauses mutations while offline, leaving mutateAsync
  // unresolved and the indicator stuck on "Saving". Exam writes must fail
  // explicitly so the local draft/reconnect logic owns recovery.
  const save = useSavePortalAnswers({ mutation: { networkMode: "always", retry: false } });
  const submit = useSubmitPortalAttempt({ mutation: { networkMode: "always", retry: false } });
  const saveRef = useRef(save.mutateAsync); saveRef.current = save.mutateAsync;
  const submitRef = useRef(submit.mutateAsync); submitRef.current = submit.mutateAsync;

  const [answers, setAnswers] = useState<Answers>({});
  const answersRef = useRef<Answers>({});
  const [state, setState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needsFlush, setNeedsFlush] = useState(0);
  const initFor = useRef<number | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const retryTimer = useRef<number | undefined>(undefined);
  /** input lock: submission in progress */
  const submitLockRef = useRef(false);
  /** input lock: deadline reached */
  const deadlineLockRef = useRef(false);
  /** server confirmed attempt is no longer in progress */
  const finalRef = useRef(false);
  const submitPendingRef = useRef(false);
  const key = attempt ? draftKey(studentId, attempt.id) : "";
  const keyRef = useRef(key); keyRef.current = key;
  const attemptId = attempt?.id;

  const removeDraft = () => { try { localStorage.removeItem(keyRef.current); } catch { /* ignore */ } };

  /** Apply an authoritative final (submitted/marked) server attempt. */
  const applyFinal = useCallback((res: PortalAttempt) => {
    finalRef.current = true;
    submitPendingRef.current = false;
    window.clearTimeout(timer.current); window.clearTimeout(retryTimer.current);
    removeDraft();
    queryClient.setQueryData(getGetPortalAttemptQueryKey(res.id), res);
    void queryClient.invalidateQueries({ queryKey: getGetPortalDashboardQueryKey() });
    answersRef.current = res.answers; setAnswers(res.answers);
    setSavedAt(res.savedAt); setState("saved"); setLastError(null); setSubmitError(null);
  }, [queryClient]);

  useEffect(() => {
    if (!attempt || initFor.current === attempt.id) return;
    initFor.current = attempt.id;
    finalRef.current = false; submitLockRef.current = false; deadlineLockRef.current = false;
    const k = draftKey(studentId, attempt.id);
    const draft = readDraft(k);
    if (attempt.status !== "in_progress") {
      finalRef.current = true;
      try { localStorage.removeItem(k); } catch { /* ignore */ }
      answersRef.current = attempt.answers; setAnswers(attempt.answers); setState("saved"); setSavedAt(attempt.savedAt);
      return;
    }
    if (draft?.dirty && !same(draft.answers, attempt.answers)) {
      answersRef.current = draft.answers; setAnswers(draft.answers); setState("dirty");
      setNeedsFlush((n) => n + 1);
    } else {
      answersRef.current = attempt.answers; setAnswers(attempt.answers); setState("saved"); setSavedAt(attempt.savedAt);
    }
  }, [attempt, studentId]);

  const flush = useCallback(async (): Promise<void> => {
    if (attemptId == null || finalRef.current || submitLockRef.current) return;
    window.clearTimeout(timer.current);
    if (!navigator.onLine) {
      setState("offline");
      setLastError("You are offline. Your latest answers are on this device and will save when you reconnect.");
      return;
    }
    if (inFlight.current) { again.current = true; return; }
    const snapshot = answersRef.current;
    setState("saving");
    const run = (async () => {
      try {
        const res = await saveRef.current({ id: attemptId, data: { answers: snapshot } });
        if (finalRef.current) return; // submission already confirmed; ignore late save
        if (res.status !== "in_progress") { applyFinal(res); return; }
        setSavedAt(res.savedAt);
        setLastError(null);
        queryClient.setQueryData(getGetPortalAttemptQueryKey(attemptId), (old: PortalAttempt | undefined) => old && old.status === "in_progress" ? { ...old, savedAt: res.savedAt, answers: res.answers, serverNow: res.serverNow, deadline: res.deadline } : old ?? res);
        if (same(snapshot, answersRef.current)) { writeDraft(keyRef.current, { answers: snapshot, dirty: false, updatedAt: Date.now() }); setState("saved"); }
        else setState("dirty");
      } catch (e) {
        if (finalRef.current) return;
        setLastError(errorMessage(e));
        const offline = isNetworkError(e) || !navigator.onLine;
        setState(offline ? "offline" : "error");
        if (offline && !submitLockRef.current) { window.clearTimeout(retryTimer.current); retryTimer.current = window.setTimeout(() => void flushRef.current(), 5000); }
      }
    })();
    inFlight.current = run;
    await run;
    inFlight.current = null;
    if (again.current) { again.current = false; if (!submitLockRef.current && !finalRef.current) void flushRef.current(); }
  }, [attemptId, queryClient, applyFinal]);
  const flushRef = useRef(flush); flushRef.current = flush;

  useEffect(() => { if (needsFlush > 0) void flushRef.current(); }, [needsFlush, attemptId]);

  const setAnswer = useCallback((qid: string, value: string) => {
    if (finalRef.current || submitLockRef.current || deadlineLockRef.current) return;
    const next = { ...answersRef.current, [qid]: value };
    answersRef.current = next;
    setAnswers(next);
    writeDraft(keyRef.current, { answers: next, dirty: true, updatedAt: Date.now() });
    setState("dirty");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flushRef.current(), 800);
  }, []);

  const doSubmit = useCallback(async () => {
    if (attemptId == null || finalRef.current) return finalRef.current;
    if (submitLockRef.current && submitting) return false;
    submitLockRef.current = true;
    window.clearTimeout(timer.current); window.clearTimeout(retryTimer.current);
    again.current = false;
    setSubmitting(true); setSubmitError(null);
    try {
      if (inFlight.current) { try { await inFlight.current; } catch { /* settled */ } }
      if (finalRef.current) return true;
      const res = await submitRef.current({ id: attemptId, data: { answers: answersRef.current } });
      applyFinal(res);
      return true;
    } catch (e) {
      const offline = isNetworkError(e) || !navigator.onLine;
      submitPendingRef.current = offline;
      setSubmitError(errorMessage(e, "Your exam was not submitted. Your answers are still on this device.") + (offline ? " Submission will retry automatically when you reconnect." : ""));
      writeDraft(keyRef.current, { answers: answersRef.current, dirty: true, updatedAt: Date.now() });
      if (!deadlineLockRef.current) submitLockRef.current = false;
      return false;
    } finally { setSubmitting(false); }
  }, [attemptId, applyFinal, submitting]);
  const submitFnRef = useRef(doSubmit); submitFnRef.current = doSubmit;

  useEffect(() => {
    const offline = () => {
      setState((current) => current === "dirty" || current === "saving" || current === "error" ? "offline" : current);
      setLastError("You are offline. Unsaved answers are kept on this device.");
    };
    const online = () => {
      if (finalRef.current) return;
      if (submitPendingRef.current) void submitFnRef.current();
      else if (!submitLockRef.current) void flushRef.current();
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); window.clearTimeout(timer.current); window.clearTimeout(retryTimer.current); };
  }, []);

  /** Deadline lock: blocks editing and autosave, never blocks submit. */
  const lock = useCallback(() => { deadlineLockRef.current = true; submitLockRef.current = true; window.clearTimeout(timer.current); }, []);
  const hasUnsaved = !finalRef.current && (state === "dirty" || state === "saving" || state === "offline" || state === "error");

  return { answers, setAnswer, state, savedAt, lastError, retrySave: flush, submit: doSubmit, submitting, submitError, lock, hasUnsaved };
}
