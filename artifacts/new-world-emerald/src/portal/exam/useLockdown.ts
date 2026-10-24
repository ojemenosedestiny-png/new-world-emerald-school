import { useCallback, useEffect, useRef, useState } from "react";
import { reportPortalFocusLoss } from "@workspace/api-client-react";

const fullscreenSupported = () => typeof document !== "undefined" && document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === "function";

/**
 * Lockdown for a computer-based test: asks for full screen, blocks copy, paste and the context menu, and reports
 * each time the student leaves the exam screen. One trip away (tab switch + blur + leaving full screen) counts once.
 * Browsers cannot stop other apps, so this deters and records rather than prevents.
 */
export function useLockdown(attemptId: number, active: boolean) {
  const [exits, setExits] = useState(0);
  const [fullscreen, setFullscreen] = useState(() => typeof document !== "undefined" && !!document.fullscreenElement);
  const away = useRef(false);

  const leave = useCallback(() => {
    if (away.current) return;
    away.current = true;
    setExits((n) => n + 1);
    void reportPortalFocusLoss(attemptId).then((r) => setExits(r.focusLosses)).catch(() => { /* counted locally; the server copy may lag */ });
  }, [attemptId]);

  useEffect(() => {
    if (!active) return;
    const back = () => { if (document.visibilityState === "visible" && document.hasFocus()) away.current = false; };
    const onVisibility = () => (document.visibilityState === "hidden" ? leave() : back());
    const onFullscreen = () => {
      const on = !!document.fullscreenElement;
      setFullscreen(on);
      if (!on) leave(); else back();
    };
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    for (const type of ["copy", "cut", "paste", "contextmenu"]) document.addEventListener(type, block);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
      for (const type of ["copy", "cut", "paste", "contextmenu"]) document.removeEventListener(type, block);
    };
  }, [active, leave]);

  // Leave full screen when the exam ends.
  useEffect(() => {
    if (!active && document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
  }, [active]);

  const enterFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
      away.current = false;
    } catch { /* the browser refused; the exam continues and exits are still recorded */ }
  }, []);

  return { exits, needsFullscreen: active && fullscreenSupported() && !fullscreen, enterFullscreen };
}
