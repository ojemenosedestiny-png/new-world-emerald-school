import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useAuth, useClerk, useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetParentOverview, getGetParentOverviewQueryKey, useVerifyParentPayment, type ParentPayment } from "@workspace/api-client-react";
import { CreditCard, LineChart, Loader2, LockKeyhole, Mail, Receipt, ShieldCheck, Users, Wallet } from "lucide-react";
import "@/portal/portal.css";
import { AppShell, type NavGroup, type NavItem } from "@/portal/shell/AppShell";
import { usePortalTheme } from "@/portal/shell/theme";
import { BackToWebsite, ErrorPanel, Skeleton } from "@/portal/ui";
import { errorMessage, usePortalMeta } from "@/portal/lib";
import { IdleSignOut } from "@/components/IdleSignOut";
import { ChildrenView, PaymentsView, ReceiptBody, ReceiptDialog, WalletView } from "@/portal/parents/ParentViews";
import { TransferFees, TransferReceipts, payItems } from "@/portal/payments/ParentTransfers";
import { ChildProgressView } from "@/portal/parents/ChildProgress";
import { asset } from "@/lib/asset";

type Section = "pay" | "children" | "progress" | "payments" | "wallet";
const TITLES: Record<Section, string> = { pay: "Fees and WAEC/NECO", children: "My children", progress: "School progress", payments: "Payments & receipts", wallet: "School wallet" };

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

/** The signed-out welcome: what parents can do here and how to sign in, in three steps. */
export function ParentWelcome() {
  const steps: [string, string][] = [
    ["Sign in with your email", "Use the email address the school has on your child's record."],
    ["See all your children", "Every child registered with that email, with their name, student ID and class."],
    ["Pay by bank transfer", "See the school account for each fee, transfer, and upload the screenshot. Your receipt follows."],
  ];
  const perks: [typeof Receipt, string][] = [[Receipt, "An official receipt for every payment, emailed and kept here"], [LineChart, "Report cards, results, attendance and homework for each child"], [ShieldCheck, "Only you see your children: the school links them to your email"]];
  return (
    <main className="portal min-h-screen lg:grid lg:grid-cols-[1.05fr_1fr]">
      <section className="portal-hero flex flex-col justify-between gap-10 px-6 py-10 sm:px-10 lg:min-h-screen lg:px-14 lg:py-14" aria-labelledby="parent-welcome-title">
        <div className="flex items-center gap-3">
          <img src={asset("/logo.jpg")} alt="" className="h-12 w-12 rounded-full bg-white object-contain p-0.5" />
          <div><p className="font-serif text-lg font-semibold leading-tight">New World Emerald</p><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[hsl(var(--p-gold))]">Parent portal</p></div>
        </div>
        <div>
          <h1 id="parent-welcome-title" className="max-w-lg font-serif text-4xl font-semibold leading-[1.1] sm:text-5xl">Your children's school life, in one place.</h1>
          <p className="mt-4 max-w-md text-base text-white/80">See how each child is doing, what is owed, pay by bank transfer and keep every receipt.</p>
          <ul className="mt-8 grid max-w-lg gap-3">
            {perks.map(([Icon, text]) => <li key={text} className="flex items-center gap-3 text-sm text-white/90"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10"><Icon size={15} aria-hidden="true" /></span>{text}</li>)}
          </ul>
        </div>
        <p className="text-xs text-white/60">Questions about fees? Call the school office on <a className="underline" href="tel:+2348136037074">+234 813 603 7074</a>.</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12 sm:px-10" aria-labelledby="parent-signin-title">
        <div className="w-full max-w-md">
          <h2 id="parent-signin-title" className="font-serif text-3xl font-semibold">Sign in</h2>
          <p className="mt-2 text-sm text-[hsl(var(--p-ink)/0.7)]">Three simple steps.</p>
          <ol className="mt-6 space-y-4">
            {steps.map(([title, body], i) => (
              <li key={title} className="flex gap-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[hsl(var(--p-emerald))] font-serif text-lg font-semibold text-white" aria-hidden="true">{i + 1}</span>
                <div><p className="font-semibold">{title}</p><p className="text-sm text-[hsl(var(--p-ink)/0.65)]">{body}</p></div>
              </li>
            ))}
          </ol>
          <Link href="/sign-in?returnTo=parents" className="portal-btn mt-8 w-full justify-center !py-3.5 text-base" data-testid="link-parent-signin"><Mail size={17} aria-hidden="true" /> Sign in with email</Link>
          <div className="mt-4 rounded-2xl border border-[hsl(var(--p-line))] bg-[hsl(var(--p-surface)/0.8)] p-4 text-sm" data-testid="text-parent-first-time">
            <p className="flex items-center gap-2 font-semibold"><LockKeyhole size={15} aria-hidden="true" className="text-[hsl(var(--p-emerald))]" /> First time here?</p>
            <p className="mt-1 text-[hsl(var(--p-ink)/0.7)]">Enter your email and press Continue. Choose a password once and type the 6-digit code we email you. After that, you sign in with your email and a code.</p>
          </div>
          <p className="mt-4 text-xs text-[hsl(var(--p-ink)/0.6)]">Not seeing your children after signing in? Ask the school office to add your email to your child's record.</p>
          <div className="mt-8"><BackToWebsite /></div>
        </div>
      </section>
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
  const [progressChild, setProgressChild] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<ParentPayment | null>(null);
  const q = useGetParentOverview({ query: { queryKey: [...getGetParentOverviewQueryKey(), user?.id ?? "anon"], enabled: signedIn, retry: 1, refetchInterval: 60_000 } });
  const back = useReturnFromPaystack(signedIn && q.isSuccess);

  if (!isLoaded) return <div className="portal p-10"><Skeleton className="mx-auto h-40 max-w-md" /></div>;
  if (!signedIn) return <ParentWelcome />;
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

  const owing = payItems(data).filter((i) => i.status === "due").length;
  const hasWallet = data.wallet.balanceKobo > 0 || data.wallet.entries.length > 0;
  const nav: NavItem<Section>[] = [
    { key: "pay", label: "Pay fees", icon: CreditCard, badge: owing, testId: "tab-parent-pay" },
    { key: "children", label: "My children", icon: Users, testId: "tab-parent-children" },
    { key: "progress", label: "School progress", icon: LineChart, testId: "tab-parent-progress" },
    { key: "payments", label: "Receipts", icon: Receipt, testId: "tab-parent-payments" },
    ...(hasWallet ? [{ key: "wallet" as const, label: "Wallet", icon: Wallet, testId: "tab-parent-wallet" }] : []),
  ];
  const groups: NavGroup<Section>[] = [{ items: nav }];
  const ok = back.payment?.status === "success";
  return (
    <AppShell subtitle="Parent portal" groups={groups} active={section} onNavigate={(k) => setSection(k as Section)}
      title={TITLES[section]} eyebrow={data.children.map((c) => c.name.split(" ")[0]).join(" · ")}
      user={{ name: user?.fullName || data.email, detail: data.email }} theme={theme.theme} onTheme={theme.setTheme}
      onSignOut={leave} bottomNav={nav.filter((n) => n.key !== "wallet").map((n) => n.key === "progress" ? { ...n, label: "Progress" } : n)}>
      <IdleSignOut enabled onSignOut={leave} />
      <div className="px-4 pb-6 pt-4 lg:px-0 lg:pt-0">
        {section === "pay" && <TransferFees data={data} />}
        {section === "children" && <ChildrenView children={data.children} onProgress={(id) => { setProgressChild(id); setSection("progress"); }} />}
        {section === "progress" && <ChildProgressView children={data.children} selected={progressChild} onSelect={setProgressChild} />}
        {section === "payments" && <div className="space-y-6">
          <TransferReceipts transfers={data.transfers} />
          {data.payments.length > 0 && <section className="space-y-2"><h2 className="font-serif text-lg font-semibold">Earlier card payments</h2><PaymentsView payments={data.payments} onOpen={setReceipt} /></section>}
        </div>}
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
