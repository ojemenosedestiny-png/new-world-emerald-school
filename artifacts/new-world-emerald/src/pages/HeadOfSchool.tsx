import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useAuth, useClerk, useUser } from "@clerk/react";
import { ApiError, getGetSchoolEmailQueryKey, useGetSchoolEmail } from "@workspace/api-client-react";
import { ArrowRight, BarChart3, ClipboardCheck, CreditCard, PenLine, Globe, GraduationCap, LayoutDashboard, Mail, School, ShieldCheck, Users } from "lucide-react";
import "@/portal/portal.css";
import { AppShell, type NavItem } from "@/portal/shell/AppShell";
import { usePortalTheme } from "@/portal/shell/theme";
import { BackToWebsite, ErrorPanel, Skeleton } from "@/portal/ui";
import { errorMessage, usePortalMeta } from "@/portal/lib";
import { IdleSignOut } from "@/components/IdleSignOut";
import { SchoolEmail } from "@/portal/messaging/SchoolEmail";
import { ParentLinksPanel } from "@/portal/manage/ParentLinksPanel";
import { FeePayments } from "@/portal/payments/OfficePayments";
import { RegistrationAdmin } from "@/portal/exam-registration/RegistrationAdmin";
import { MySignatures } from "@/portal/reports/MySignatures";
import { asset } from "@/lib/asset";

type Tab = "home" | "email" | "parents" | "payments" | "waec" | "signature";
const TITLES: Record<Tab, string> = { home: "Head of School", email: "Email teachers and parents", parents: "Parents and children", payments: "Fee payments", waec: "WAEC / NECO registration", signature: "My signature for report cards" };

const PORTALS: { href: string; title: string; body: string; icon: typeof School }[] = [
  { href: "/portal/manage", title: "Staff portal", body: "Every class, student, exam, report card, register, fee and payment.", icon: School },
  { href: "/principal", title: "Secondary principal", body: "JSS 1 to SS 3: teachers, exams by term, results and signing, daily activity.", icon: Users },
  { href: "/principal/primary", title: "Primary principal", body: "Year 1 to Year 6: teachers, exams by term, results and signing, daily activity.", icon: Users },
  { href: "/exam-officer", title: "Exam officer", body: "Publish exams to students and see who did what with exam papers.", icon: ClipboardCheck },
  { href: "/director", title: "Director's dashboard", body: "Enrolment, fees, attendance and results across the school, and the weekly report.", icon: BarChart3 },
  { href: "/admin", title: "Website", body: "The school website's pages, news, admissions and the shop.", icon: Globe },
];

function Gate({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <main className="portal grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <img src={asset("/logo.jpg")} alt="New World Emerald Private School" className="mx-auto h-16 w-16 object-contain" />
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--p-gold-ink))]">Head of School</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--p-ink)/0.7)]">{body}</p>
        <div className="mt-7 space-y-3">{children}</div>
        <div className="mt-8"><BackToWebsite /></div>
      </div>
    </main>
  );
}

export default function HeadOfSchool() {
  usePortalMeta("Head of School");
  const theme = usePortalTheme();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const signedIn = isLoaded && isSignedIn === true;
  const [tab, setTab] = useState<Tab>("home");
  // Right after signing up, the server needs a few seconds to confirm the new account.
  const q = useGetSchoolEmail({ query: { queryKey: [...getGetSchoolEmailQueryKey(), user?.id ?? "anon"], enabled: signedIn, retry: (n, e) => e instanceof ApiError && e.status === 403 && n < 6, retryDelay: 5000 } });
  const leave = () => void signOut({ redirectUrl: import.meta.env.BASE_URL + "head" });

  if (!isLoaded) return <div className="portal p-10"><Skeleton className="mx-auto h-40 max-w-md" /></div>;
  if (!signedIn) return <Gate title="Head of School's portal" body="Every portal in one place, and private emails to teachers and parents. Sign in with the Head of School's email."><Link href="/sign-in?returnTo=head" className="portal-btn w-full justify-center !py-3.5" data-testid="link-head-signin">Sign in with email</Link></Gate>;
  const denied = (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 401)) || (q.data && q.data.sender.role !== "head");
  if (denied) return <Gate title="For the Head of School only" body="This page is for the Head of School. If that is you, sign in with the email the school registered for you."><button type="button" className="portal-btn-ghost w-full justify-center" onClick={leave} data-testid="button-head-switch">Use another account</button></Gate>;
  if (q.isLoading) return <div className="portal p-10"><Skeleton className="mx-auto h-60 max-w-3xl" /></div>;
  if (q.isError || !q.data) return <div className="portal grid min-h-screen place-items-center px-4"><div className="w-full max-w-md"><ErrorPanel title="The Head of School's portal did not load" message={errorMessage(q.error)} onRetry={() => void q.refetch()} /></div></div>;

  const nav: NavItem<Tab>[] = [
    { key: "home", label: "Home", icon: LayoutDashboard, testId: "tab-head-home" },
    { key: "email", label: "Email teachers and parents", icon: Mail, testId: "tab-head-email" },
    { key: "parents", label: "Parents and children", icon: Users, testId: "tab-head-parents" },
    { key: "payments", label: "Fee payments", icon: CreditCard, testId: "tab-head-payments" },
    { key: "waec", label: "WAEC / NECO", icon: GraduationCap, testId: "tab-head-waec" },
    { key: "signature", label: "My signature", icon: PenLine, testId: "tab-head-signature" },
  ];
  const first = (user?.firstName ?? "").trim();
  const teachers = q.data.people.filter((p) => p.kind === "teacher").length, parents = q.data.people.filter((p) => p.kind === "parent").length;
  return (
    <AppShell subtitle="Head of School" groups={[{ items: nav }]} active={tab} onNavigate={(k) => setTab(k as Tab)}
      title={TITLES[tab]} eyebrow="New World Emerald Private School"
      user={{ name: user?.fullName || "Head of School", detail: user?.primaryEmailAddress?.emailAddress ?? "" }} theme={theme.theme} onTheme={theme.setTheme}
      onSignOut={leave} bottomNav={[nav[0], { ...nav[1], label: "Email" }, { ...nav[2], label: "Parents" }]}>
      <IdleSignOut enabled onSignOut={leave} />
      <div className="px-4 pb-6 pt-4 lg:px-0 lg:pt-0">
        {tab === "home" && (
          <div className="space-y-6">
            <section className="portal-hero rounded-3xl p-6 sm:p-8" aria-labelledby="head-title">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--p-gold))]"><ShieldCheck size={14} aria-hidden="true" /> Head of School</p>
              <h2 id="head-title" className="mt-2 font-serif text-3xl font-semibold sm:text-4xl">Welcome{first ? `, ${first}` : ""}</h2>
              <p className="mt-1 max-w-xl text-sm text-white/75">Every part of the school is one click away, and you can write to any teacher or parent privately.</p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {([["Teachers", teachers], ["Parents", parents], ["Emails left today", Math.max(0, q.data.dailyLimit - q.data.sentToday)]] as const).map(([label, n]) => (
                  <div key={label} className="rounded-2xl border border-white/15 bg-white/[0.07] p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">{label}</p><p className="mt-1.5 font-serif text-3xl font-semibold tabular-nums">{n}</p></div>
                ))}
              </div>
              <button type="button" className="portal-btn portal-btn-gold mt-5" onClick={() => setTab("email")} data-testid="button-head-write"><Mail size={15} aria-hidden="true" /> Write to teachers or parents</button>
            </section>
            <section aria-labelledby="portals-title">
              <h2 id="portals-title" className="mb-3 font-serif text-xl font-semibold">Portals</h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {PORTALS.map((p) => (
                  <li key={p.href}>
                    <Link href={p.href} className="portal-card group flex h-full flex-col gap-2 p-5 transition hover:-translate-y-0.5" data-testid={`link-head-portal-${p.href.replace(/\//g, "-").replace(/^-/, "")}`}>
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-[hsl(var(--p-emerald-soft))] text-[hsl(var(--p-emerald))]"><p.icon size={18} aria-hidden="true" /></span>
                      <span className="font-serif text-lg font-semibold">{p.title}</span>
                      <span className="text-sm text-[hsl(var(--p-ink)/0.65)]">{p.body}</span>
                      <span className="mt-auto flex items-center gap-1 text-sm font-semibold text-[hsl(var(--p-emerald))]">Open <ArrowRight size={14} aria-hidden="true" className="transition group-hover:translate-x-0.5" /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
        {tab === "email" && <SchoolEmail />}
        {tab === "parents" && <ParentLinksPanel />}
        {tab === "payments" && <FeePayments />}
        {tab === "waec" && <RegistrationAdmin />}
        {tab === "signature" && <MySignatures />}
      </div>
    </AppShell>
  );
}
