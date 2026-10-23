import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLoginPortalStudent, useRequestPasswordReset, getGetPortalSessionQueryKey } from "@workspace/api-client-react";
import { Eye, EyeOff, KeyRound, LogIn, ShieldCheck } from "lucide-react";
import { asset } from "@/lib/asset";
import { BackToWebsite, ErrorPanel } from "./ui";
import { clearDrafts, clearStudentQueries, errorMessage } from "./lib";

export function StudentLogin() {
  const queryClient = useQueryClient();
  const login = useLoginPortalStudent();
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotId, setForgotId] = useState("");
  const forgot = useRequestPasswordReset();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!studentId.trim() || !password) return;
    login.mutate(
      { data: { studentId: studentId.trim(), password } },
      {
        onSuccess: async (session) => {
          setPassword("");
          await clearStudentQueries(queryClient);
          clearDrafts(session.studentId);
          queryClient.setQueryData(getGetPortalSessionQueryKey(), session);
        },
      },
    );
  };

  return (
    <div className="portal grid min-h-[100dvh] lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[hsl(var(--p-ink))] p-12 text-[hsl(var(--p-paper))] lg:flex lg:flex-col lg:justify-between">
        <img src={asset("/logo.jpg")} alt="" className="pointer-events-none absolute -right-24 -bottom-24 w-[520px] rounded-full opacity-[0.06]" />
        <div className="flex items-center gap-3">
          <img src={asset("/logo.jpg")} alt="New World Emerald logo" className="h-12 w-12 rounded-full bg-white p-0.5" />
          <div>
            <p className="font-serif text-xl font-bold">New World Emerald</p>
            <p className="text-[10px] uppercase tracking-[0.24em] opacity-60">Private School</p>
          </div>
        </div>
        <div className="max-w-md portal-rise">
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-[hsl(var(--p-gold))]">Student Portal</p>
          <h1 className="font-serif text-5xl font-semibold leading-[1.05]">Your classroom, ready when you are.</h1>
          <p className="mt-6 text-base leading-relaxed text-[hsl(var(--p-paper)/0.7)]">Sit your exams, revisit your class notes and read announcements from your teachers. Every answer you type is saved as you go.</p>
        </div>
        <div className="flex items-center gap-3 text-sm text-[hsl(var(--p-paper)/0.6)]">
          <ShieldCheck size={18} className="text-[hsl(var(--p-gold))]" />
          Your teachers set the exams and release every result.
        </div>
      </aside>

      <main className="flex flex-col px-5 py-8 sm:px-10">
        <div className="flex items-center justify-between">
          <BackToWebsite />
          <Link href="/portal/manage" className="text-sm font-semibold text-[hsl(var(--p-emerald))] underline-offset-4 hover:underline" data-testid="link-staff-portal">Staff sign-in</Link>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10 portal-rise">
          <div className="mb-8 lg:hidden flex items-center gap-3">
            <img src={asset("/logo.jpg")} alt="New World Emerald logo" className="h-11 w-11 rounded-full bg-white p-0.5" />
            <p className="font-serif text-lg font-bold">New World Emerald</p>
          </div>
          <h2 className="font-serif text-3xl font-semibold">Sign in to your portal</h2>
          <p className="mt-2 text-sm text-[hsl(var(--p-ink)/0.6)]">Use the student ID and password given to you by the school.</p>

          <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="portal-student-id" className="portal-label">Student ID</label>
              <input id="portal-student-id" className="portal-input font-semibold tracking-wide" autoComplete="username" autoCapitalize="characters" value={studentId} onChange={(e) => setStudentId(e.target.value)} maxLength={50} required data-testid="input-student-id" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="portal-password" className="portal-label">Password</label>
              <div className="relative">
                <input id="portal-password" type={show ? "text" : "password"} className="portal-input pr-11" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} required data-testid="input-password" />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-[hsl(var(--p-ink)/0.5)]" aria-label={show ? "Hide password" : "Show password"} data-testid="button-toggle-password">
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>
            {login.isError && <ErrorPanel title="Could not sign you in" message={errorMessage(login.error, "Check your student ID and password.")} />}
            <button type="submit" className="portal-btn w-full py-3" disabled={login.isPending || !studentId.trim() || !password} data-testid="button-student-login">
              <LogIn size={17} /> {login.isPending ? "Checking your details..." : "Sign in"}
            </button>
          </form>

          <div className="mt-8 rounded-2xl bg-[hsl(var(--p-gold-soft)/0.7)] p-4 text-sm leading-relaxed text-[hsl(var(--p-ink)/0.8)]">
            <div className="flex gap-3">
              <KeyRound size={18} className="mt-0.5 shrink-0 text-[hsl(var(--p-gold-ink))]" />
              <div className="flex-1">
                <p>Forgotten your password? <button type="button" className="font-semibold text-[hsl(var(--p-emerald))] underline-offset-4 hover:underline" onClick={() => { setForgotOpen((o) => !o); setForgotId(studentId); }} aria-expanded={forgotOpen} data-testid="button-forgot-password">Email a reset link</button> to your parent, or contact the school office.</p>
                {forgotOpen && (
                  forgot.isSuccess ? <p className="mt-3 rounded-xl bg-[hsl(var(--p-surface)/0.8)] p-3" role="status" data-testid="text-forgot-sent">{forgot.data.message}</p> : (
                    <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (forgotId.trim()) forgot.mutate({ data: { studentId: forgotId.trim() } }); }}>
                      <label htmlFor="forgot-id" className="sr-only">Student ID</label>
                      <input id="forgot-id" className="portal-input !py-2 text-sm" placeholder="Your Student ID" value={forgotId} onChange={(e) => setForgotId(e.target.value)} maxLength={50} data-testid="input-forgot-id" />
                      <button className="portal-btn !py-2 text-sm" disabled={!forgotId.trim() || forgot.isPending} data-testid="button-send-reset">{forgot.isPending ? "Sending..." : "Send"}</button>
                    </form>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
