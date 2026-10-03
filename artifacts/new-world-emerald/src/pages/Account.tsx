import { useAuth, useClerk, useUser } from "@clerk/react";
import { useGetLocalAccount, getGetLocalAccountQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";

export default function Account() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const query = useGetLocalAccount({ query: { queryKey: [...getGetLocalAccountQueryKey(), user?.externalId ?? user?.id], enabled: isLoaded && isSignedIn === true, retry: false } });
  return (
    <main className="min-h-screen bg-secondary px-4 py-16 text-white">
      <section className="mx-auto max-w-lg rounded-3xl bg-white/10 p-8">
        <h1 className="font-serif text-3xl font-bold">School account</h1>
        {!isLoaded ? <p className="mt-6">Checking your account…</p>
          : !isSignedIn ? <Link href="/sign-in" className="mt-6 block underline">Sign in with email</Link>
          : query.isError ? <p className="mt-6" role="alert">Your school account could not be loaded. <button onClick={() => void query.refetch()} className="underline">Retry</button></p>
          : !query.data ? <p className="mt-6">Loading your school account…</p>
          : <div data-testid="school-account-loaded" className="mt-6 space-y-3">
              <p>{user?.primaryEmailAddress?.emailAddress}</p>
              <p>{query.data.isAdmin ? "Approved school administrator" : "Administrator access requires school approval."}</p>
              <Link href="/admin" className="block text-accent underline">Open admin panel</Link>
            </div>}
        {isSignedIn && <button onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL })} className="mt-8 rounded-xl border border-white/30 px-5 py-3">Sign out</button>}
        <Link href="/" className="mt-6 block text-sm underline">School website</Link>
      </section>
    </main>
  );
}