import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useAuth, useClerk, useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetParentOverview, getGetParentOverviewQueryKey, useVerifyParentPayment, type ParentPayment } from "@workspace/api-client-react";
import { CreditCard, Loader2, Receipt, Users, Wallet } from "lucide-react";
import "@/portal/portal.css";
import { AppShell, type NavGroup, type NavItem } from "@/portal/shell/AppShell";
import { usePortalTheme } from "@/portal/shell/theme";
import { BackToWebsite, ErrorPanel, Skeleton } from "@/portal/ui";
import { errorMessage, usePortalMeta } from "@/portal/lib";
import { IdleSignOut } from "@/components/IdleSignOut";
import { ChildrenView, PaymentsView, PayFees, ReceiptBody, ReceiptDialog, WalletView } from "@/portal/parents/ParentViews";
import { asset } from "@/lib/asset";

type Section = "pay" | "children" | "payments" | "wallet";
const TITLES: Record<Section, string> = { pay: "Pay school fees", children: "My children", payments: "Payments & receipts", wallet: "School wallet" };

function Gate({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <main className="portal grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <img src={asset("/logo.jpg")} alt="New World Emerald Private School" className="mx-auto h-16 w-16 object-contain" />
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--p-gold-ink))]">Parent portal</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--p-ink)/0.7)]">{body}</p>
        <div className="mt-7 space-y-3">{children}</div>
        <div className="mt-8"><BackToWebsite /></div>
      </div>
    </main>
  );
}

/** After Paystack sends the parent back (?reference=...), confirm the payment with the server and show the outcome. */
function useReturnFromPaystack(enabled: boolean) {
  const verify = useVerifyParentPayment();
  const queryClient = useQueryClient();
  const [payment, setPayment] = useState<ParentPayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reference] = useState(() => new URLSearchParams(window.location.search).get("reference"));
  const ran = useRef(false);
  const check = async () => {
    if (!reference) return;
    setError(null);
    try {
      const p = await verify.mutateAsync({ reference });
      setPayment(p);
      if (p.status !== "pending") await queryClient.invalidateQueries({ queryKey: getGetParentOverviewQueryKey() });
    } catch (e) { setError(errorMessage(e)); }
  };
  useEffect(() => {
    if (!enabled || !reference || ran.current) return;
    ran.current = true;
    // The address is cleaned so a refresh does not check again.
    window.history.replaceState(null, "", window.location.pathname);
    void check();
  }, [enabled, reference]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = !!reference && (verify.isPending || !!payment || !!error);
  return { open, checking: verify.isPending, payment, error, check, close: () => { setPayment(null); setError(null); } };
}

export default function ParentPortal() {
  usePortalMeta("Parent portal");
  const theme = usePortalTheme();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const signedIn = isLoaded && isSignedIn === true;
  const [section, setSection] = useState<Section>("pay");
  const [receipt, setReceipt] = useState<ParentPayment | null>(null);
  const q = useGetParentOverview({ query: { queryKey: [...getGetParentOverviewQueryKey(), user?.id ?? "anon"], enabled: signedIn, retry: 1, refetchInterval: 60_000 } });
  const back = useReturnFromPaystack(signedIn && q.isSuccess);

  if (!isLoaded) return <div className="portal p-10"><Skeleton className="mx-auto h-40 max-w-md" /></div>;
  if (!signedIn) {
    return (
      <Gate title="Pay school fees online" body="Sign in with the email address the school has for you. You will see every child registered with that email, their fees and receipts.">
        <Link href="/sign-in?returnTo=parents" className="portal-btn w-full justify-center !py-3.5" data-testid="link-parent-signin">Sign in with email</Link>
        <p className="text-xs text-[hsl(var(--p-ink)/0.6)]">First time? Enter your email, choose a password and type the code we send you. After that you sign in with your email and a code.</p>
      </Gate>
    );
  }
  if (q.isLoading) return <div className="portal p-10"><Skeleton className="mx-auto h-40 max-w-2xl" /></div>;
  if (q.isError || !q.data) {
    return <div className="portal grid min-h-screen place-items-center px-4"><div className="w-full max-w-md"><ErrorPanel title="The parent portal did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} /></div></div>;
  }
  const data = q.data;
  const leave = () => void signOut({ redirectUrl: import.meta.env.BASE_URL + "parents" });
  if (!data.children.length) {
    return (
      <Gate title="No children found" body={`No student is registered with ${data.email}. Ask the school office to add this email as the parent email on your child's record, then sign in again.`}>
        <button type="button" className="portal-btn-ghost w-full justify-center" onClick={leave} data-testid="button-parent-switch">Use another email</button>
      </Gate>
    );
  }

  const owing = data.outstanding.length;
  const nav: NavItem<Section>[] = [
    { key: "pay", label: "Pay fees", icon: CreditCard, badge: owing, testId: "tab-parent-pay" },
    { key: "children", label: "My children", icon: Users, testId: "tab-parent-children" },
    { key: "payments", label: "Receipts", icon: Receipt, testId: "tab-parent-payments" },
    { key: "wallet", label: "Wallet", icon: Wallet, testId: "tab-parent-wallet" },
  ];
  const groups: NavGroup<Section>[] = [{ items: nav }];
  const ok = back.payment?.status === "success";
  return (
    <AppShell subtitle="Parent portal" groups={groups} active={section} onNavigate={(k) => setSection(k as Section)}
      title={TITLES[section]} eyebrow={data.children.map((c) => c.name.split(" ")[0]).join(" · ")}
      user={{ name: user?.fullName || data.email, detail: data.email }} theme={theme.theme} onTheme={theme.setTheme}
      onSignOut={leave} bottomNav={nav}>
      <IdleSignOut enabled onSignOut={leave} />
      <div className="px-4 pb-6 pt-4 lg:px-0 lg:pt-0">
        {section === "pay" && <PayFees data={data} onPaid={setReceipt} />}
        {section === "children" && <ChildrenView children={data.children} />}
        {section === "payments" && <PaymentsView payments={data.payments} onOpen={setReceipt} />}
        {section === "wallet" && <WalletView data={data} />}
      </div>
      <ReceiptDialog payment={receipt} onClose={() => setReceipt(null)} />
      <ReceiptDialogReturn back={back} ok={ok} />
    </AppShell>
  );
}

/** The outcome after coming back from Paystack: paid (with the receipt), still waiting, or not paid. */
function ReceiptDialogReturn({ back, ok }: { back: ReturnType<typeof useReturnFromPaystack>; ok: boolean }) {
  if (!back.open) return null;
  if (back.checking && !back.payment) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" role="status" aria-live="polite">
        <div className="portal-card flex items-center gap-3 !p-6"><Loader2 className="animate-spin text-[hsl(var(--p-emerald))]" aria-hidden="true" /> Confirming your payment with Paystack...</div>
      </div>
    );
  }
  if (back.payment && back.payment.status !== "pending") {
    return <ReceiptDialog payment={back.payment} onClose={back.close} title={ok ? "Payment successful" : "Payment not completed"} />;
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="pending-title">
      <div className="portal-card w-full max-w-md space-y-4 !p-6">
        <h2 id="pending-title" className="font-serif text-2xl font-semibold">{back.error ? "We could not check the payment" : "Waiting for Paystack"}</h2>
        <p className="text-sm leading-relaxed">{back.error ?? "Paystack has not confirmed this payment yet. If you completed it, it usually appears within a minute; you will also get an email receipt. If you closed the Paystack page, nothing was charged."}</p>
        {back.payment && <ReceiptBody p={back.payment} />}
        <div className="flex gap-2">
          <button type="button" className="portal-btn flex-1 justify-center" onClick={() => void back.check()} disabled={back.checking}>{back.checking ? "Checking..." : "Check again"}</button>
          <button type="button" className="portal-btn-ghost" onClick={back.close}>Close</button>
        </div>
      </div>
    </div>
  );
}
