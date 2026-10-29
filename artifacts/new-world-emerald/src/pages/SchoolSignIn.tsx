import { SignIn, SignUp } from "@clerk/react";
import { Link } from "wouter";
import { asset } from "@/lib/asset";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const RETURN_KEY = "nwe-signin-return";
// Allow-list only: maps a returnTo token to an internal path. Anything else falls back to /admin.
const RETURN_TARGETS: Record<string, string> = { portal: "/portal/manage", director: "/director" };

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

/** An email passed in the teacher's invitation link, to fill in the form so they use the address the school approved. */
function invitedEmail() {
  const email = new URLSearchParams(window.location.search).get("email") ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

export function SchoolSignIn({ signup = false }: { signup?: boolean }) {
  const token = resolveReturnTo();
  const email = invitedEmail();
  const target = basePath + (token ? RETURN_TARGETS[token] : "/admin");
  const query = token ? "?returnTo=" + token : "";
  const isPortal = token === "portal";
  const isDirector = token === "director";
  return (
    <main className="min-h-screen bg-secondary px-4 py-12 text-white">
      <div className="mx-auto max-w-lg text-center">
        <img src={asset("/logo.jpg")} alt="New World Emerald Private School" className="mx-auto h-20 w-20 object-contain" />
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.25em] text-accent">{isDirector ? "Director" : isPortal ? "Learning portal staff" : "School office"}</p>
        <h1 className="mt-2 font-serif text-3xl font-bold">New World Emerald</h1>
        <p className="mb-8 mt-3 text-sm text-white/75">{isDirector ? "Sign in with the Director's email to open the school dashboard and weekly report." : isPortal ? "Teachers and administrators sign in with their school-approved email to manage exams, revision and marking." : "Sign in with your email to access the school admin panel. Website management is restricted to school-approved administrators."}</p>
        {isPortal && (
          <div className="mx-auto mb-6 max-w-sm rounded-xl bg-white/10 p-4 text-left text-sm leading-relaxed text-white/90" data-testid="text-first-time-staff">
            <p className="font-semibold text-accent">First time here?</p>
            <p className="mt-1">Enter the email the school approved for you and press Continue. You will choose a password once and type the six-digit code we email you. After that you sign in with your email and a code.</p>
          </div>
        )}
        {signup
          ? <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in${query}`} forceRedirectUrl={target} initialValues={email ? { emailAddress: email } : undefined} />
          : <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up${query}`} forceRedirectUrl={target} signUpForceRedirectUrl={target} withSignUp initialValues={email ? { emailAddress: email } : undefined} />}
        <Link href="/" className="mt-7 inline-block text-sm text-white/80 underline">Return to the school website</Link>
      </div>
    </main>
  );
}
