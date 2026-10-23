import { useEffect, useRef, useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export const IDLE_MINUTES = 30;
const WARNING_SECONDS = 60;
const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
const KEY = "nwe-last-activity";

/**
 * Signs the user out after a period without keyboard, mouse or touch activity, with a
 * one-minute warning. Activity in any tab of the site counts, so a second open tab
 * does not sign out someone who is working in the first.
 */
export function IdleSignOut({ enabled, onSignOut, minutes = IDLE_MINUTES }: { enabled: boolean; onSignOut: () => void; minutes?: number }) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const signOutRef = useRef(onSignOut);
  signOutRef.current = onSignOut;
  const done = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    done.current = false;
    const mark = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* storage unavailable */ } local = Date.now(); };
    let local = Date.now();
    mark();
    let lastMark = 0;
    const onActivity = () => { if (Date.now() - lastMark > 5_000) { lastMark = Date.now(); mark(); } };
    for (const e of EVENTS) window.addEventListener(e, onActivity, { passive: true });
    const tick = window.setInterval(() => {
      let last = local;
      try { last = Math.max(last, Number(localStorage.getItem(KEY)) || 0); } catch { /* storage unavailable */ }
      const remaining = Math.round((last + minutes * 60_000 - Date.now()) / 1000);
      if (remaining <= 0) {
        if (!done.current) { done.current = true; setSecondsLeft(null); signOutRef.current(); }
      } else setSecondsLeft(remaining <= WARNING_SECONDS ? remaining : null);
    }, 1000);
    return () => { window.clearInterval(tick); for (const e of EVENTS) window.removeEventListener(e, onActivity); };
  }, [enabled, minutes]);

  const stay = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* storage unavailable */ } setSecondsLeft(null); };
  return (
    <AlertDialog open={secondsLeft !== null}>
      <AlertDialogContent data-testid="dialog-idle-warning">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-serif text-2xl">Are you still there?</AlertDialogTitle>
          <AlertDialogDescription>For security you will be signed out in {secondsLeft} seconds because there has been no activity for {minutes} minutes.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => { done.current = true; setSecondsLeft(null); signOutRef.current(); }}>Sign out now</AlertDialogCancel>
          <AlertDialogAction onClick={stay} data-testid="button-stay-signed-in">Stay signed in</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Keeps the idle timer satisfied while `active` (for example during an exam, where a student
 * may read for a long time without typing), so another open tab never signs them out.
 */
export function useKeepAlive(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const beat = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* storage unavailable */ } };
    beat();
    const t = window.setInterval(beat, 30_000);
    return () => window.clearInterval(t);
  }, [active]);
}
