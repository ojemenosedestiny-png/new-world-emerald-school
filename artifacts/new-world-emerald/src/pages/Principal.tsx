import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useAuth, useClerk, useUser } from "@clerk/react";
import { ApiError, useGetPrincipalOverview, getGetPrincipalOverviewQueryKey } from "@workspace/api-client-react";
import { Activity, School, Users } from "lucide-react";
import "@/portal/portal.css";
import { AppShell, type NavItem } from "@/portal/shell/AppShell";
import { usePortalTheme } from "@/portal/shell/theme";
import { BackToWebsite, ErrorPanel, Skeleton } from "@/portal/ui";
import { errorMessage, usePortalMeta } from "@/portal/lib";
import { IdleSignOut } from "@/components/IdleSignOut";
import { ActivityView, ClassesView, TeachersView } from "@/portal/principal/PrincipalViews";
import { asset } from "@/lib/asset";

type Section = "classes" | "teachers" | "activity";
export type SchoolSection = "primary" | "secondary";
const TITLES: Record<Section, string> = { classes: "Classes & teachers", teachers: "Teachers", activity: "Daily activity" };

// The two principals' portals: the same tools, each over their own classes.
const SECTIONS = {
  secondary: { label: "Secondary school principal", classes: "JSS 1 to SS 3", path: "principal", signIn: "principal", other: "primary" },
  primary: { label: "Primary school principal", classes: "Year 1 to Year 6", path: "principal/primary", signIn: "primary-principal", other: "secondary" },
} as const;

function Gate({ eyebrow, title, body, children }: { eyebrow: string; title: string; body: string; children?: ReactNode }) {
  return (
    <main className="portal grid min-h-screen place-items-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <img src={asset("/logo.jpg")} alt="New World Emerald Private School" className="mx-auto h-16 w-16 object-contain" />
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--p-gold-ink))]">{eyebrow}</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--p-ink)/0.7)]">{body}</p>
        <div className="mt-7 space-y-3">{children}</div>
        <div className="mt-8"><BackToWebsite /></div>
      </div>
    </main>
  );
}

export default function Principal({ section: school = "secondary" }: { section?: SchoolSection }) {
  const info = SECTIONS[school];
  const other = SECTIONS[info.other];
  usePortalMeta(info.label);
  const theme = usePortalTheme();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const signedIn = isLoaded && isSignedIn === true;
  const [section, setSection] = useState<Section>("classes");
  // Right after signing up, the server needs a few seconds to confirm a new administrator account.
  const q = useGetPrincipalOverview({ section: school }, { query: { queryKey: [...getGetPrincipalOverviewQueryKey({ section: school }), user?.id ?? "anon"], enabled: signedIn, retry: (n, e) => e instanceof ApiError && e.status === 403 && n < 6, retryDelay: 5000 } });
  const leave = () => void signOut({ redirectUrl: import.meta.env.BASE_URL + info.path });

  if (!isLoaded) return <div className="portal p-10"><Skeleton className="mx-auto h-40 max-w-md" /></div>;
  if (!signedIn) return <Gate eyebrow={info.label} title="Principal's portal" body={`${info.classes}: assign teachers to classes and see what each teacher did each day. Sign in with the ${info.label.toLowerCase()}'s email.`}><Link href={`/sign-in?returnTo=${info.signIn}`} className="portal-btn w-full justify-center !py-3.5" data-testid="link-principal-signin">Sign in with email</Link></Gate>;
  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 401)) {
    return <Gate eyebrow={info.label} title={`For the ${info.label.toLowerCase()} only`} body={`This page is for the principal of ${info.classes}. If that is you, sign in with the email the school registered for you.`}>
        <Link href={`/${other.path}`} className="portal-btn w-full justify-center" data-testid="link-other-principal">Open the {other.label.toLowerCase()}'s portal ({other.classes})</Link>
        <button type="button" className="portal-btn-ghost w-full justify-center" onClick={leave} data-testid="button-principal-switch">Use another account</button>
      </Gate>;
  }
  if (q.isLoading) return <div className="portal p-10"><Skeleton className="mx-auto h-60 max-w-3xl" /></div>;
  if (q.isError || !q.data) return <div className="portal grid min-h-screen place-items-center px-4"><div className="w-full max-w-md"><ErrorPanel title={`The ${info.label.toLowerCase()}'s portal did not load`} message={errorMessage(q.error)} onRetry={() => void q.refetch()} /></div></div>;

  const nav: NavItem<Section>[] = [
    { key: "classes", label: "Classes & teachers", icon: School, testId: "tab-principal-classes" },
    { key: "teachers", label: "Teachers", icon: Users, testId: "tab-principal-teachers" },
    { key: "activity", label: "Daily activity", icon: Activity, testId: "tab-principal-activity" },
  ];
  return (
    <AppShell subtitle={`${school === "primary" ? "Primary" : "Secondary"} principal · ${info.classes}`} groups={[{ items: nav }]} active={section} onNavigate={(k) => setSection(k as Section)}
      title={TITLES[section]} eyebrow="New World Emerald Private School"
      user={{ name: user?.fullName || info.label, detail: user?.primaryEmailAddress?.emailAddress ?? "" }} theme={theme.theme} onTheme={theme.setTheme}
      onSignOut={leave} bottomNav={nav}>
      <IdleSignOut enabled onSignOut={leave} />
      <div className="px-4 pb-6 pt-4 lg:px-0 lg:pt-0">
        {section === "classes" && <ClassesView data={q.data} classes={info.classes} />}
        {section === "teachers" && <TeachersView data={q.data} />}
        {section === "activity" && <ActivityView today={q.data.today} section={school} />}
      </div>
    </AppShell>
  );
}
