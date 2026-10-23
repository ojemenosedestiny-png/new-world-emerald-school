import { SignIn, SignUp } from "@clerk/react";
import { Link } from "wouter";
import { asset } from "@/lib/asset";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const RETURN_KEY = "nwe-signin-return";
// Allow-list only: maps a returnTo token to an internal path. Anything else falls back to /admin.
const RETURN_TARGETS: Record<string, string> = { portal: "/portal/manage" };

function resolveReturnTo(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("returnTo");
    if (token && RETURN_TARGETS[token]) { sessionStorage.setItem(RETURN_KEY, token); return token; }
    const path = window.location.pathname.replace(basePath, "");
    // Fresh visit to the sign-in/sign-up root without a token resets to default.
    if (path === "/sign-in" || path === "/sign-up") { sessionStorage.removeItem(RETURN_KEY); return null; }
    const stored = sessionStorage.getItem(RETURN_KEY);
    return stored && RETURN_TARGETS[stored] ? stored : null;
  } catch {
    return null;
  }
}

export function SchoolSignIn({ signup = false }: { signup?: boolean }) {
  const token = resolveReturnTo();
  const target = basePath + (token ? RETURN_TARGETS[token] : "/admin");
  const query = token ? "?returnTo=" + token : "";
  const isPortal = token === "portal";
  return (
    <main className="min-h-screen bg-secondary px-4 py-12 text-white">
      <div className="mx-auto max-w-lg text-center">
        <img src={asset("/logo.jpg")} alt="New World Emerald Private School" className="mx-auto h-20 w-20 object-contain" />
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.25em] text-accent">{isPortal ? "Learning portal staff" : "School office"}</p>
        <h1 className="mt-2 font-serif text-3xl font-bold">New World Emerald</h1>
        <p className="mb-8 mt-3 text-sm text-white/75">{isPortal ? "Teachers and administrators sign in with their school-approved email to manage exams, revision and marking." : "Sign in with your email to access the school admin panel. Website management is restricted to school-approved administrators."}</p>
        {signup
          ? <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in${query}`} forceRedirectUrl={target} />
          : <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up${query}`} forceRedirectUrl={target} />}
        <Link href="/" className="mt-7 inline-block text-sm text-white/80 underline">Return to the school website</Link>
      </div>
    </main>
  );
}
