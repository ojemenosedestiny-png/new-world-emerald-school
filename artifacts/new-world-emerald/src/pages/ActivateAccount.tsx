import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCheckAccountToken, useCompleteAccountToken, getGetPortalSessionQueryKey, type AccountTokenInfo } from "@workspace/api-client-react";
import { CheckCircle2, Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import "@/portal/portal.css";
import { asset } from "@/lib/asset";
import { BackToWebsite, ErrorPanel, Skeleton } from "@/portal/ui";
import { clearDrafts, clearStudentQueries, errorMessage, usePortalMeta } from "@/portal/lib";
import { usePortalTheme } from "@/portal/shell/theme";
import { PasswordStrength, passwordProblem } from "@/portal/PasswordStrength";

/** Opened from an activation or password-reset email. The token stays in this page only. */
export default function ActivateAccount() {
  usePortalMeta("Activate account");
  usePortalTheme();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [token] = useState(() => new URLSearchParams(window.location.search).get("t") ?? "");
  const check = useCheckAccountToken();
  const complete = useCompleteAccountToken();
  const [info, setInfo] = useState<AccountTokenInfo | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Remove the token from the address bar and history once read.
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
    if (token) check.mutate({ data: { token } }, { onSuccess: setInfo });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const problem = passwordProblem(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem || password !== confirm) return;
    complete.mutate({ data: { token, password } }, {
      onSuccess: async (session) => {
        await clearStudentQueries(queryClient);
        clearDrafts(session.studentId);
        queryClient.setQueryData(getGetPortalSessionQueryKey(), session);
        setLocation("/portal");
      },
    });
  };
  const reset = info?.purpose === "reset";

  return (
    <div className="portal grid min-h-[100dvh] place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between"><BackToWebsite /><Link href="/portal" className="text-sm font-semibold text-[hsl(var(--p-emerald))]">Student sign-in</Link></div>
        <div className="portal-card portal-rise p-7">
          <div className="mb-5 flex items-center gap-3">
            <img src={asset("/logo.jpg")} alt="" className="h-11 w-11 rounded-full bg-white p-0.5" />
            <div><p className="font-serif text-lg font-bold">New World Emerald</p><p className="text-[10px] font-semibold uppercase tracking-[0.22em] opacity-60">Student portal</p></div>
          </div>
          {!token ? (
            <ErrorPanel title="This link is incomplete" message="Open the full link from the email, or ask the school office for a new one." />
          ) : check.isPending || (!info && !check.isError) ? (
            <div className="space-y-3"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-24" /></div>
          ) : check.isError || !info ? (
            <ErrorPanel title="This link cannot be used" message={errorMessage(check.error, "This link is invalid, already used or expired. Ask the school office for a new one.")} />
          ) : (
            <form onSubmit={submit} className="space-y-5" noValidate>
              <div>
                <h1 className="font-serif text-2xl font-semibold">{reset ? "Choose a new password" : "Activate your account"}</h1>
                <p className="mt-1 text-sm text-[hsl(var(--p-ink)/0.65)]">{reset ? "Your other devices will be signed out." : "Check these details, then choose a private password."}</p>
              </div>
              <div className="rounded-2xl bg-[hsl(var(--p-emerald-soft)/0.6)] p-4 text-sm" data-testid="panel-account-details">
                <p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} className="text-[hsl(var(--p-emerald))]" /> {info.studentName}</p>
                <p className="mt-1 text-[hsl(var(--p-ink)/0.7)]">Student ID <b className="font-mono">{info.studentId}</b>{info.className ? ` / ${info.className}` : ""}</p>
                <p className="mt-2 text-xs text-[hsl(var(--p-ink)/0.6)]">Not you? Close this page and contact the school office.</p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="act-password" className="portal-label">New password</label>
                <div className="relative">
                  <input id="act-password" type={show ? "text" : "password"} className="portal-input pr-11" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} data-testid="input-activate-password" />
                  <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-[hsl(var(--p-ink)/0.5)]" aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                </div>
                <PasswordStrength password={password} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="act-confirm" className="portal-label">Type it again</label>
                <input id="act-confirm" type={show ? "text" : "password"} className="portal-input" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={128} aria-invalid={mismatch} data-testid="input-activate-confirm" />
                {mismatch && <p className="text-xs text-[hsl(var(--p-red))]">The two passwords do not match.</p>}
              </div>
              {complete.isError && <ErrorPanel title="Password not saved" message={errorMessage(complete.error)} />}
              <button type="submit" className="portal-btn w-full py-3" disabled={!!problem || password !== confirm || complete.isPending} data-testid="button-activate">
                {reset ? <KeyRound size={16} /> : <ShieldCheck size={16} />} {complete.isPending ? "Saving..." : reset ? "Save new password" : "Activate and sign in"}
              </button>
              <p className="text-center text-xs text-[hsl(var(--p-ink)/0.55)]">You will sign in with your Student ID and this password.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
