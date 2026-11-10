import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useAuth, useClerk, useUser } from "@clerk/react";
import { ApiError, getGetSchoolAccountsQueryKey, useGetSchoolAccounts } from "@workspace/api-client-react";
import "@/portal/portal.css";
import { usePortalTheme } from "@/portal/shell/theme";
import { BackToWebsite, ErrorPanel, Skeleton } from "@/portal/ui";
import { errorMessage, usePortalMeta } from "@/portal/lib";
import { IdleSignOut } from "@/components/IdleSignOut";
import { asset } from "@/lib/asset";
import { AccountsView } from "@/portal/accounts/AccountsView";
import { presetRange } from "@/portal/accounts/ledger";

function Gate({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <main className="portal grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <img src={asset("/logo.jpg")} alt="New World Emerald Private School" className="mx-auto h-16 w-16 object-contain" />
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--p-gold-ink))]">School accounts</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--p-ink)/0.7)]">{body}</p>
        <div className="mt-7 space-y-3">{children}</div>
        <div className="mt-8"><BackToWebsite /></div>
      </div>
    </main>
  );
}

/** /accounts: the bursar keeps the school's accounts; the school owner approves spending. */
export default function SchoolAccounts() {
  usePortalMeta("School accounts");
  usePortalTheme();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const signedIn = isLoaded && isSignedIn === true;
  const [range, setRange] = useState(() => presetRange("month"));
  const q = useGetSchoolAccounts(range, { query: { queryKey: [...getGetSchoolAccountsQueryKey(range), user?.id ?? "anon"], enabled: signedIn, placeholderData: (prev) => prev, refetchInterval: 300_000, retry: (n, e) => e instanceof ApiError && e.status === 403 && n < 6, retryDelay: 5000 } });
  const leave = () => void signOut({ redirectUrl: import.meta.env.BASE_URL + "accounts" });

  if (!isLoaded) return <div className="portal p-10"><Skeleton className="mx-auto h-40 max-w-md" /></div>;
  if (!signedIn) return <Gate title="Money in and out" body="The school's accounts: fees received, other income and spending, with approval by the school owner. Sign in with the bursar's or the school owner's email."><Link href="/sign-in?returnTo=accounts" className="portal-btn w-full justify-center !py-3.5" data-testid="link-accounts-signin">Sign in with email</Link></Gate>;
  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 401)) return <Gate title="For the bursar and the school owner" body="The school accounts are open only to the bursar and the school owner. If that is you, sign in with the email the school registered for you."><button type="button" className="portal-btn-ghost w-full justify-center" onClick={leave} data-testid="button-accounts-switch">Use another account</button></Gate>;
  if (q.isLoading) return <div className="portal p-10"><Skeleton className="mx-auto h-[60vh] max-w-6xl" /></div>;
  if (q.isError || !q.data) return <div className="portal grid min-h-screen place-items-center px-4"><div className="w-full max-w-md"><ErrorPanel title="The accounts did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} /></div></div>;
  const me = user?.primaryEmailAddress?.emailAddress?.trim().toLowerCase() ?? "";
  return <><IdleSignOut enabled onSignOut={leave} /><AccountsView a={q.data} me={me} firstName={user?.firstName ?? ""} onRange={setRange} onLeave={leave} /></>;
}
