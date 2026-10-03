import { SignIn, SignUp } from "@clerk/react";
import { Link } from "wouter";
import { asset } from "@/lib/asset";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function SchoolSignIn({ signup = false }: { signup?: boolean }) {
  return (
    <main className="min-h-screen bg-secondary px-4 py-12 text-white">
      <div className="mx-auto max-w-lg text-center">
        <img src={asset("/logo.jpg")} alt="New World Emerald Private School" className="mx-auto h-20 w-20 object-contain" />
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.25em] text-accent">School office</p>
        <h1 className="mt-2 font-serif text-3xl font-bold">New World Emerald</h1>
        <p className="mb-8 mt-3 text-sm text-white/75">Sign in with your email to access the school admin panel. Website management is restricted to school-approved administrators.</p>
        {signup
          ? <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} forceRedirectUrl={`${basePath}/admin`} />
          : <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} forceRedirectUrl={`${basePath}/admin`} />}
        <Link href="/" className="mt-7 inline-block text-sm text-white/80 underline">Return to the school website</Link>
      </div>
    </main>
  );
}